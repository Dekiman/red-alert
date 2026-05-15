import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { initDatabase } from "../backend/src/db.js";
import { createAlertNormalizer } from "../backend/src/alerts/normalizer.js";
import { createLogger } from "../backend/src/logger.js";
import { normalizeLocationText } from "../backend/src/locality-map/shared.js";

type CliOptions = {
  dbPath: string;
  fromMs: number;
  toMs: number;
  dryRun: boolean;
  failOnPartialFeed: boolean;
  enableNonOfficialFallback: boolean;
  historyUrl: string;
  fallbackHistoryUrl: string;
  citiesUrl: string;
  matchWindowSeconds: number;
};

type OrefHistoryRow = {
  alertDate?: string;
  date?: string;
  time?: string;
  title?: string;
  category_desc?: string;
  data?: string;
  category?: number;
};

type HistoricalRow = [number, number, string[], number];

type GroupedAlert = {
  alertDate: string;
  title: string;
  category: number;
  unixSeconds: number;
  locations: string[];
  rows: OrefHistoryRow[];
};

type HistoryCoverageSummary = {
  earliestRowUnix: number | null;
  latestRowUnix: number | null;
  earliestMissileAlertUnix: number | null;
  latestMissileAlertUnix: number | null;
};

type CitiesPayload = {
  cities?: Record<
    string,
    {
      id?: number;
      he?: string;
      en?: string;
      ru?: string;
      ar?: string;
      es?: string;
    }
  >;
};

const OFFICIAL_OREF_MISSILE_ALERT_CATEGORY = 1;

function parseArgs(argv: string[]): CliOptions {
  const nowMs = Date.now();
  const options: CliOptions = {
    dbPath: process.env.RED_ALERT_DB_PATH ?? path.join(process.cwd(), "data", "red_alerts.sqlite"),
    fromMs: nowMs - 24 * 60 * 60 * 1000,
    toMs: nowMs,
    dryRun: false,
    failOnPartialFeed: false,
    enableNonOfficialFallback: false,
    historyUrl: "https://alerts-history.oref.org.il//Shared/Ajax/GetAlarmsHistory.aspx?lang=he",
    fallbackHistoryUrl: "https://www.tzevaadom.co.il/static/historical/all.json",
    citiesUrl: "https://www.tzevaadom.co.il/static/cities.json",
    matchWindowSeconds: 2
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      options.dbPath = argv[index + 1] ?? options.dbPath;
      index += 1;
      continue;
    }
    if (arg === "--from") {
      options.fromMs = parseDateArgument(argv[index + 1], false) ?? options.fromMs;
      index += 1;
      continue;
    }
    if (arg === "--to") {
      options.toMs = parseDateArgument(argv[index + 1], true) ?? options.toMs;
      index += 1;
      continue;
    }
    if (arg === "--history-url") {
      options.historyUrl = argv[index + 1] ?? options.historyUrl;
      index += 1;
      continue;
    }
    if (arg === "--fallback-history-url") {
      options.fallbackHistoryUrl = argv[index + 1] ?? options.fallbackHistoryUrl;
      index += 1;
      continue;
    }
    if (arg === "--cities-url") {
      options.citiesUrl = argv[index + 1] ?? options.citiesUrl;
      index += 1;
      continue;
    }
    if (arg === "--match-window-seconds") {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.matchWindowSeconds = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--fail-on-partial-feed") {
      options.failOnPartialFeed = true;
      continue;
    }
    if (arg === "--enable-non-official-fallback") {
      options.enableNonOfficialFallback = true;
    }
  }

  if (!Number.isFinite(options.fromMs) || !Number.isFinite(options.toMs)) {
    throw new Error("Invalid --from/--to values");
  }
  if (options.fromMs > options.toMs) {
    throw new Error("--from must be earlier than --to");
  }

  return options;
}

function parseDateArgument(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const localDateTime = endOfDay ? `${trimmed}T23:59:59.999` : `${trimmed}T00:00:00.000`;
    const parsedLocal = new Date(localDateTime).getTime();
    return Number.isFinite(parsedLocal) ? parsedLocal : null;
  }

  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const parsedUrl = new URL(url);
  const isOfficialOrefHost = parsedUrl.hostname.endsWith("oref.org.il");
  const isTzevaAdomHost = parsedUrl.hostname.endsWith("tzevaadom.co.il");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*",
      ...(isOfficialOrefHost ? { Referer: "https://www.oref.org.il/", "X-Requested-With": "XMLHttpRequest" } : {}),
      ...(isTzevaAdomHost ? { Referer: "https://www.tzevaadom.co.il/" } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function loadCitiesPayloadFromDisk(): CitiesPayload | null {
  const candidates = [
    path.join(process.cwd(), "tmp_tzevaadom_cities_v10.json")
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as CitiesPayload;
    } catch {
      // Ignore broken fallback file and keep trying.
    }
  }

  return null;
}

function buildCityLookup(citiesPayload: CitiesPayload) {
  const aliasToIds = new Map<string, number[]>();

  for (const [cityKey, cityValue] of Object.entries(citiesPayload?.cities ?? {})) {
    const localityId = Number(cityValue?.id);
    const aliases = [cityKey, cityValue?.he, cityValue?.en, cityValue?.ru, cityValue?.ar, cityValue?.es];

    for (const alias of aliases) {
      const normalizedAlias = normalizeLocationText(alias);
      if (!normalizedAlias || !Number.isFinite(localityId)) {
        continue;
      }

      const existingIds = aliasToIds.get(normalizedAlias) ?? [];
      if (!existingIds.includes(localityId)) {
        existingIds.push(localityId);
        aliasToIds.set(normalizedAlias, existingIds);
      }
    }
  }

  return {
    findLocalityIdsForLocations(locations: string[]) {
      const resolvedIds = new Set<number>();

      for (const location of locations) {
        const normalizedLocation = normalizeLocationText(location);
        if (!normalizedLocation) {
          continue;
        }

        const ids = aliasToIds.get(normalizedLocation) ?? [];
        for (const id of ids) {
          resolvedIds.add(id);
        }
      }

      return Array.from(resolvedIds).sort((left, right) => left - right);
    }
  };
}

async function loadCitiesPayload(citiesUrl: string) {
  try {
    return await fetchJson<CitiesPayload>(citiesUrl);
  } catch (error) {
    const fallback = loadCitiesPayloadFromDisk();
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

function sanitizeLocationName(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function sanitizeLocations(locations: unknown) {
  const sanitizedLocations: string[] = [];
  const seenLocations = new Set<string>();

  for (const rawLocation of Array.isArray(locations) ? locations : []) {
    const sanitized = sanitizeLocationName(rawLocation);
    const normalized = normalizeLocationText(sanitized);
    if (!sanitized || !normalized || seenLocations.has(normalized)) {
      continue;
    }

    seenLocations.add(normalized);
    sanitizedLocations.push(sanitized);
  }

  return sanitizedLocations;
}

function buildLocationSignature(locations: string[]) {
  return [...locations]
    .map((location) => normalizeLocationText(location))
    .filter(Boolean)
    .sort()
    .join("|");
}

function parseOrefAlertDateToUnixSeconds(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed.replace(" ", "T")).getTime();
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

function parseOrefRowToUnixSeconds(row: OrefHistoryRow) {
  const date = String(row?.date ?? "").trim();
  const time = String(row?.time ?? "").trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(date) && /^\d{2}:\d{2}:\d{2}$/.test(time)) {
    const [day, month, year] = date.split(".");
    return parseOrefAlertDateToUnixSeconds(`${year}-${month}-${day} ${time}`);
  }

  return parseOrefAlertDateToUnixSeconds(row?.alertDate);
}

function groupOfficialHistoryRows(rows: OrefHistoryRow[], fromUnix: number, toUnix: number) {
  const groupedAlerts = new Map<string, GroupedAlert>();
  let skippedEmptyLocation = 0;
  let skippedInvalidTime = 0;
  let skippedNonAlertCategory = 0;

  for (const row of rows) {
    const category = Number(row?.category);
    if (category !== OFFICIAL_OREF_MISSILE_ALERT_CATEGORY) {
      skippedNonAlertCategory += 1;
      continue;
    }

    const unixSeconds = parseOrefRowToUnixSeconds(row);
    if (!Number.isFinite(unixSeconds)) {
      skippedInvalidTime += 1;
      continue;
    }
    if (unixSeconds < fromUnix || unixSeconds > toUnix) {
      continue;
    }

    const sanitizedLocation = sanitizeLocationName(row?.data);
    if (!sanitizedLocation) {
      skippedEmptyLocation += 1;
      continue;
    }

    const title = String(row?.title ?? row?.category_desc ?? "").trim() || "ירי רקטות וטילים";
    const key = `${unixSeconds}|${category}|${normalizeLocationText(title)}`;
    const existingGroup = groupedAlerts.get(key);
    if (existingGroup) {
      const normalizedLocation = normalizeLocationText(sanitizedLocation);
      const alreadyIncluded = existingGroup.locations.some(
        (location) => normalizeLocationText(location) === normalizedLocation
      );
      if (!alreadyIncluded) {
        existingGroup.locations.push(sanitizedLocation);
      }
      existingGroup.rows.push(row);
      continue;
    }

    groupedAlerts.set(key, {
      alertDate: String(row?.alertDate ?? "").trim(),
      title,
      category,
      unixSeconds,
      locations: [sanitizedLocation],
      rows: [row]
    });
  }

  return {
    groupedAlerts: Array.from(groupedAlerts.values()).sort(
      (left, right) => left.unixSeconds - right.unixSeconds
    ),
    skippedEmptyLocation,
    skippedInvalidTime,
    skippedNonAlertCategory
  };
}

function summarizeHistoryCoverage(rows: OrefHistoryRow[]): HistoryCoverageSummary {
  let earliestRowUnix: number | null = null;
  let latestRowUnix: number | null = null;
  let earliestMissileAlertUnix: number | null = null;
  let latestMissileAlertUnix: number | null = null;

  for (const row of rows) {
    const unixSeconds = parseOrefRowToUnixSeconds(row);
    if (!Number.isFinite(unixSeconds)) {
      continue;
    }

    if (earliestRowUnix == null || unixSeconds < earliestRowUnix) {
      earliestRowUnix = unixSeconds;
    }
    if (latestRowUnix == null || unixSeconds > latestRowUnix) {
      latestRowUnix = unixSeconds;
    }

    if (Number(row?.category) !== OFFICIAL_OREF_MISSILE_ALERT_CATEGORY) {
      continue;
    }

    if (earliestMissileAlertUnix == null || unixSeconds < earliestMissileAlertUnix) {
      earliestMissileAlertUnix = unixSeconds;
    }
    if (latestMissileAlertUnix == null || unixSeconds > latestMissileAlertUnix) {
      latestMissileAlertUnix = unixSeconds;
    }
  }

  return {
    earliestRowUnix,
    latestRowUnix,
    earliestMissileAlertUnix,
    latestMissileAlertUnix
  };
}

function formatUnixIso(unixSeconds: number | null) {
  if (!Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function buildExistingAlertLookup(existingAlerts: Array<{
  alertTimestampUnix: number;
  locationNames: string[];
}>) {
  const alertEntries: Array<{ unixSeconds: number; normalizedLocations: string[] }> = [];
  const alertsByLocationSignature = new Map<string, number[]>();

  for (const alert of existingAlerts) {
    const normalizedLocations = alert.locationNames
      .map((location) => normalizeLocationText(location))
      .filter((location): location is string => Boolean(location));
    const signature = [...normalizedLocations].sort().join("|");
    if (!signature) {
      continue;
    }

    alertEntries.push({
      unixSeconds: Number(alert.alertTimestampUnix),
      normalizedLocations
    });

    const existingTimestamps = alertsByLocationSignature.get(signature) ?? [];
    existingTimestamps.push(Number(alert.alertTimestampUnix));
    alertsByLocationSignature.set(signature, existingTimestamps);
  }

  return {
    hasEquivalentAlert(locations: string[], unixSeconds: number, matchWindowSeconds: number) {
      const normalizedLocations = locations
        .map((location) => normalizeLocationText(location))
        .filter((location): location is string => Boolean(location));
      const signature = [...normalizedLocations].sort().join("|");
      if (!signature) {
        return false;
      }

      const timestamps = alertsByLocationSignature.get(signature) ?? [];
      if (timestamps.some((existingUnix) => Math.abs(existingUnix - unixSeconds) <= matchWindowSeconds)) {
        return true;
      }

      const coveredLocations = new Set<string>();
      for (const alertEntry of alertEntries) {
        if (Math.abs(alertEntry.unixSeconds - unixSeconds) > matchWindowSeconds) {
          continue;
        }

        for (const location of alertEntry.normalizedLocations) {
          coveredLocations.add(location);
        }
      }

      return normalizedLocations.every((location) => coveredLocations.has(location));
    },
    add(locations: string[], unixSeconds: number) {
      const normalizedLocations = locations
        .map((location) => normalizeLocationText(location))
        .filter((location): location is string => Boolean(location));
      const signature = [...normalizedLocations].sort().join("|");
      if (!signature) {
        return;
      }

      alertEntries.push({
        unixSeconds,
        normalizedLocations
      });

      const timestamps = alertsByLocationSignature.get(signature) ?? [];
      timestamps.push(unixSeconds);
      alertsByLocationSignature.set(signature, timestamps);
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const importerLogger = createLogger("import");
  const db = initDatabase(options.dbPath);

  try {
    const citiesPayload = await loadCitiesPayload(options.citiesUrl);
    const { findLocalityIdsForLocations } = buildCityLookup(citiesPayload);
    const alertNormalizer = createAlertNormalizer({
      timezone: process.env.RED_ALERT_TIMEZONE ?? "Asia/Jerusalem",
      englishOnly: false,
      warnOnce() {},
      getLocalityMapIdsForLocations: findLocalityIdsForLocations,
      maxSeenIds: 1,
      logger: importerLogger
    });

    const fromUnix = Math.floor(options.fromMs / 1000);
    const toUnix = Math.floor(options.toMs / 1000);
    const historyRows = await fetchJson<OrefHistoryRow[]>(options.historyUrl);
    const coverage = summarizeHistoryCoverage(historyRows);
    const coverageWarnings: string[] = [];
    const earliestFeedRowIso = formatUnixIso(coverage.earliestRowUnix);
    const latestFeedRowIso = formatUnixIso(coverage.latestRowUnix);
    const earliestMissileAlertIso = formatUnixIso(coverage.earliestMissileAlertUnix);
    const latestMissileAlertIso = formatUnixIso(coverage.latestMissileAlertUnix);

    if (coverage.earliestRowUnix == null) {
      coverageWarnings.push("The official OREF history feed did not return any timestamped rows.");
    } else if (coverage.earliestRowUnix > fromUnix) {
      coverageWarnings.push(
        `The official OREF history feed begins at ${earliestFeedRowIso}. Requested import starts at ${new Date(
          options.fromMs
        ).toISOString()}.`
      );
    }

    if (coverage.earliestMissileAlertUnix == null) {
      coverageWarnings.push("The official OREF history feed did not return any missile-alert rows (category 1).");
    } else if (coverage.earliestMissileAlertUnix > fromUnix) {
      coverageWarnings.push(
        `Official missile-alert rows begin at ${earliestMissileAlertIso}. Earlier missile alerts, if any, are not available from this feed at import time.`
      );
    }

    if (coverageWarnings.length > 0) {
      process.stderr.write(coverageWarnings.map((warning) => `[official-oref-history] ${warning}`).join("\n") + "\n");
      if (options.failOnPartialFeed && !options.enableNonOfficialFallback) {
        throw new Error("Official OREF history feed does not fully cover the requested range.");
      }
    }

    const groupedHistory = groupOfficialHistoryRows(historyRows, fromUnix, toUnix);
    const existingAlerts = db.getAlertsForPolygonStateInference(
      fromUnix - options.matchWindowSeconds,
      toUnix + options.matchWindowSeconds,
      250000
    );
    const existingAlertLookup = buildExistingAlertLookup(existingAlerts);

    let inserted = 0;
    let skippedExistingEquivalent = 0;
    let skippedDuplicateInFeed = 0;
    const importedSignatures = new Set<string>();

    for (const groupedAlert of groupedHistory.groupedAlerts) {
      const signature = `${groupedAlert.unixSeconds}|${buildLocationSignature(groupedAlert.locations)}`;
      if (importedSignatures.has(signature)) {
        skippedDuplicateInFeed += 1;
        continue;
      }

      if (
        existingAlertLookup.hasEquivalentAlert(
          groupedAlert.locations,
          groupedAlert.unixSeconds,
          options.matchWindowSeconds
        )
      ) {
        skippedExistingEquivalent += 1;
        continue;
      }

      importedSignatures.add(signature);

      const rawAlert = {
        alertDate: groupedAlert.alertDate,
        category: groupedAlert.category,
        title: groupedAlert.title,
        threat: 0,
        time: groupedAlert.unixSeconds,
        cities: groupedAlert.locations,
        sourceUrl: options.historyUrl,
        sourceRows: groupedAlert.rows,
        sourceKind: "official_oref_history"
      };

      const normalizedAlert = alertNormalizer.normalizeAlert(rawAlert, "official_oref_history");

      if (options.dryRun) {
        inserted += 1;
        existingAlertLookup.add(groupedAlert.locations, groupedAlert.unixSeconds);
        continue;
      }

      const result = db.saveAlert(normalizedAlert, rawAlert);
      if (result.inserted) {
        inserted += 1;
        existingAlertLookup.add(groupedAlert.locations, groupedAlert.unixSeconds);
      }
    }

    let fallbackCandidateRows = 0;
    let fallbackInserted = 0;
    let fallbackSkippedExistingEquivalent = 0;
    let fallbackSkippedDuplicateInFeed = 0;
    let fallbackSkippedEmpty = 0;

    if (options.enableNonOfficialFallback) {
      const fallbackRows = await fetchJson<unknown[]>(options.fallbackHistoryUrl);
      const candidateRows = fallbackRows
        .filter(
          (row): row is HistoricalRow =>
            Array.isArray(row) &&
            row.length >= 4 &&
            Number.isFinite(Number(row[1])) &&
            Array.isArray(row[2]) &&
            Number.isFinite(Number(row[3]))
        )
        .filter((row) => Number(row[3]) >= fromUnix && Number(row[3]) <= toUnix)
        .sort((left, right) => Number(left[3]) - Number(right[3]));

      fallbackCandidateRows = candidateRows.length;
      const fallbackImportedSignatures = new Set<string>();

      for (const row of candidateRows) {
        const sanitizedFallbackLocations = sanitizeLocations(row[2]);
        if (sanitizedFallbackLocations.length === 0) {
          fallbackSkippedEmpty += 1;
          continue;
        }

        const signature = `${Number(row[3])}|${Number(row[1])}|${buildLocationSignature(sanitizedFallbackLocations)}`;
        if (fallbackImportedSignatures.has(signature)) {
          fallbackSkippedDuplicateInFeed += 1;
          continue;
        }

        if (
          existingAlertLookup.hasEquivalentAlert(
            sanitizedFallbackLocations,
            Number(row[3]),
            options.matchWindowSeconds
          )
        ) {
          fallbackSkippedExistingEquivalent += 1;
          continue;
        }

        fallbackImportedSignatures.add(signature);

        const rawAlert = {
          historicalRowId: Number(row[0]),
          threat: Number(row[1]),
          time: Number(row[3]),
          cities: sanitizedFallbackLocations,
          sourceUrl: options.fallbackHistoryUrl,
          sourceKind: "historical_tzevaadom_fallback"
        };

        const normalizedAlert = alertNormalizer.normalizeAlert(rawAlert, "historical_tzevaadom");

        if (options.dryRun) {
          fallbackInserted += 1;
          existingAlertLookup.add(normalizedAlert.locations, normalizedAlert.alertTimestampUnix);
          continue;
        }

        const result = db.saveAlert(normalizedAlert, rawAlert);
        if (result.inserted) {
          fallbackInserted += 1;
          existingAlertLookup.add(normalizedAlert.locations, normalizedAlert.alertTimestampUnix);
        }
      }
    }

    process.stdout.write(
      JSON.stringify(
        {
          source: options.historyUrl,
          dbPath: path.resolve(options.dbPath),
          dryRun: options.dryRun,
          fromIso: new Date(options.fromMs).toISOString(),
          toIso: new Date(options.toMs).toISOString(),
          failOnPartialFeed: options.failOnPartialFeed,
          enableNonOfficialFallback: options.enableNonOfficialFallback,
          sourceEarliestRowIso: earliestFeedRowIso,
          sourceLatestRowIso: latestFeedRowIso,
          sourceEarliestMissileAlertIso: earliestMissileAlertIso,
          sourceLatestMissileAlertIso: latestMissileAlertIso,
          coverageWarnings,
          historyRows: historyRows.length,
          groupedAlerts: groupedHistory.groupedAlerts.length,
          existingAlertsInWindow: existingAlerts.length,
          matchWindowSeconds: options.matchWindowSeconds,
          inserted,
          skippedExistingEquivalent,
          skippedDuplicateInFeed,
          fallbackHistoryUrl: options.enableNonOfficialFallback ? options.fallbackHistoryUrl : null,
          fallbackCandidateRows,
          fallbackInserted,
          fallbackSkippedExistingEquivalent,
          fallbackSkippedDuplicateInFeed,
          fallbackSkippedEmpty,
          skippedEmptyLocation: groupedHistory.skippedEmptyLocation,
          skippedInvalidTime: groupedHistory.skippedInvalidTime,
          skippedNonAlertCategory: groupedHistory.skippedNonAlertCategory
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    db.close();
  }
}

void main();
