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
  historyUrl: string;
  citiesUrl: string;
};

type HistoricalRow = [number, number, string[], number];

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

function parseArgs(argv: string[]): CliOptions {
  const nowMs = Date.now();
  const options: CliOptions = {
    dbPath: process.env.RED_ALERT_DB_PATH ?? path.join(process.cwd(), "data", "red_alerts.sqlite"),
    fromMs: nowMs - 14 * 24 * 60 * 60 * 1000,
    toMs: nowMs,
    dryRun: false,
    historyUrl: "https://www.tzevaadom.co.il/static/historical/all.json",
    citiesUrl: "https://www.tzevaadom.co.il/static/cities.json"
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
    if (arg === "--cities-url") {
      options.citiesUrl = argv[index + 1] ?? options.citiesUrl;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
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
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.tzevaadom.co.il/"
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
      if (!normalizedAlias) {
        continue;
      }

      if (Number.isFinite(localityId)) {
        const existingIds = aliasToIds.get(normalizedAlias) ?? [];
        if (!existingIds.includes(localityId)) {
          existingIds.push(localityId);
          aliasToIds.set(normalizedAlias, existingIds);
        }
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

function sanitizeLocations(locations: unknown) {
  const sanitizedLocations: string[] = [];
  const seenLocations = new Set<string>();

  const sourceLocations = Array.isArray(locations) ? locations : [];
  for (const rawLocation of sourceLocations) {
    const normalizedSource = normalizeLocationText(rawLocation);
    if (!normalizedSource) {
      continue;
    }

    const sanitized = String(rawLocation).trim();
    if (!sanitized || seenLocations.has(sanitized)) {
      continue;
    }

    seenLocations.add(sanitized);
    sanitizedLocations.push(sanitized);
  }

  return sanitizedLocations;
}

function buildAlertSignature(unixSeconds: number, threat: number, locations: string[]) {
  const normalizedLocations = [...locations]
    .map((location) => normalizeLocationText(location))
    .filter(Boolean)
    .sort();
  return `${unixSeconds}|${threat}|${normalizedLocations.join("|")}`;
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
    const existingAlerts = db.getAlertsForPolygonStateInference(fromUnix, toUnix, 250000);
    const existingSignatures = new Set(
      existingAlerts.map((alert) =>
        buildAlertSignature(alert.alertTimestampUnix, alert.threat, alert.locationNames)
      )
    );

    const historyRows = await fetchJson<unknown[]>(options.historyUrl);
    const candidateRows = historyRows
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

    let inserted = 0;
    let skippedExisting = 0;
    let skippedEmpty = 0;
    let skippedDuplicateInFeed = 0;
    const importedSignatures = new Set<string>();

    for (const row of candidateRows) {
      const sanitizedLocations = sanitizeLocations(row[2]);
      if (sanitizedLocations.length === 0) {
        skippedEmpty += 1;
        continue;
      }

      const rawAlert = {
        historicalRowId: Number(row[0]),
        threat: Number(row[1]),
        time: Number(row[3]),
        cities: sanitizedLocations
      };

      const normalizedAlert = alertNormalizer.normalizeAlert(rawAlert, "historical_tzevaadom");
      const signature = buildAlertSignature(
        normalizedAlert.alertTimestampUnix,
        normalizedAlert.threat,
        normalizedAlert.locations
      );

      if (existingSignatures.has(signature)) {
        skippedExisting += 1;
        continue;
      }
      if (importedSignatures.has(signature)) {
        skippedDuplicateInFeed += 1;
        continue;
      }

      importedSignatures.add(signature);

      if (options.dryRun) {
        inserted += 1;
        continue;
      }

      const result = db.saveAlert(normalizedAlert, {
        ...rawAlert,
        sourceUrl: options.historyUrl
      });
      if (result.inserted) {
        inserted += 1;
        existingSignatures.add(signature);
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
          candidateRows: candidateRows.length,
          existingAlertsInRange: existingAlerts.length,
          inserted,
          skippedExisting,
          skippedDuplicateInFeed,
          skippedEmpty
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
