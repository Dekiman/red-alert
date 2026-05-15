import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspect } from "node:util";

type CliOptions = {
  dbPath: string;
  baseUrl: string;
  notificationId: string | null;
  offset: number;
  dryRun: boolean;
  keepOriginalId: boolean;
  includeMockRows: boolean;
};

type AlertRow = {
  id: number;
  notification_id: string;
  source: string;
  threat: number;
  is_drill: number;
  raw_payload_json: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.RED_ALERT_DB_PATH ?? path.join(process.cwd(), "data", "red_alerts.sqlite"),
    baseUrl: "http://127.0.0.1:3030",
    notificationId: null,
    offset: 0,
    dryRun: false,
    keepOriginalId: false,
    includeMockRows: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--db") {
      options.dbPath = argv[i + 1] ?? options.dbPath;
      i += 1;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = argv[i + 1] ?? options.baseUrl;
      i += 1;
      continue;
    }
    if (arg === "--notification-id") {
      options.notificationId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--offset") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.offset = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--keep-original-id") {
      options.keepOriginalId = true;
      continue;
    }
    if (arg === "--include-mock-rows") {
      options.includeMockRows = true;
      continue;
    }
  }

  return options;
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function extractLocationsFromRaw(rawPayload: any): string[] {
  const candidates = [
    rawPayload?.cities,
    rawPayload?.locations,
    rawPayload?.localities,
    rawPayload?.data?.cities,
    rawPayload?.data?.locations
  ];
  for (const candidate of candidates) {
    const parsed = coerceStringArray(candidate);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

function getTargetAlertRow(db: DatabaseSync, options: CliOptions): AlertRow | null {
  if (options.notificationId) {
    return db
      .prepare(
        `SELECT id, notification_id, source, threat, is_drill, raw_payload_json
         FROM alerts
         WHERE notification_id = ?
         LIMIT 1`
      )
      .get(options.notificationId) as AlertRow | null;
  }

  const sourceFilterSql = options.includeMockRows ? "" : "WHERE source <> 'mock_api'";
  return db
    .prepare(
      `SELECT id, notification_id, source, threat, is_drill, raw_payload_json
       FROM alerts
       ${sourceFilterSql}
       ORDER BY id DESC
       LIMIT 1 OFFSET ?`
    )
    .get(options.offset) as AlertRow | null;
}

function getAlertLocationsFromTable(db: DatabaseSync, alertId: number): string[] {
  const rows = db
    .prepare(
      `SELECT location_name
       FROM alert_locations
       WHERE alert_id = ?
       ORDER BY location_index ASC`
    )
    .all(alertId) as Array<{ location_name: string }>;

  return rows.map((row) => String(row.location_name || "").trim()).filter(Boolean);
}

function normalizeLocationText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/["'`’]/g, "")
    .replace(/[.,/#!$%^&*;:{}=_~()\-+[\]\\|?<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadEnglishLocationMap() {
  const candidatePaths = [
    path.join(process.cwd(), "tmp_tzevaadom_cities_v10.json"),
    path.join(process.cwd(), "dist", "frontend", "assets", "cities.json")
  ];

  const englishByAlias = new Map<string, string>();
  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(readFileSync(candidatePath, "utf8"));
    } catch {
      continue;
    }

    const cities = parsed?.cities && typeof parsed.cities === "object" ? parsed.cities : parsed;
    if (!cities || typeof cities !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(cities)) {
      const item = value as any;
      const englishName = String(item?.en ?? "").trim();
      if (!englishName) {
        continue;
      }
      const aliases = [key, item?.he, item?.en, item?.ru, item?.ar, item?.es];
      for (const alias of aliases) {
        const normalized = normalizeLocationText(alias);
        if (normalized) {
          englishByAlias.set(normalized, englishName);
        }
      }
    }

    if (englishByAlias.size > 0) {
      break;
    }
  }

  return englishByAlias;
}

function translateLocationsToEnglish(locations: string[], englishByAlias: Map<string, string>) {
  if (!Array.isArray(locations) || locations.length === 0 || englishByAlias.size === 0) {
    return { translated: locations, changed: false };
  }

  let changed = false;
  const translated = locations.map((location) => {
    const normalized = normalizeLocationText(location);
    const mapped = englishByAlias.get(normalized);
    if (mapped && mapped !== location) {
      changed = true;
      return mapped;
    }
    return location;
  });
  return { translated, changed };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolvedDbPath = path.resolve(options.dbPath);
  if (!existsSync(resolvedDbPath)) {
    process.stderr.write(`Database file not found: ${resolvedDbPath}\n`);
    process.exit(1);
    return;
  }

  const db = new DatabaseSync(resolvedDbPath);
  try {
    const row = getTargetAlertRow(db, options);
    if (!row) {
      process.stderr.write("No matching alert row found in database.\n");
      process.exit(1);
      return;
    }

    let rawPayload: any = null;
    try {
      rawPayload = JSON.parse(String(row.raw_payload_json || "{}"));
    } catch {
      rawPayload = {};
    }

    const locationsFromRaw = extractLocationsFromRaw(rawPayload);
    const locationsFromTable = getAlertLocationsFromTable(db, row.id);
    const initialLocations = locationsFromRaw.length > 0 ? locationsFromRaw : locationsFromTable;
    const englishByAlias = loadEnglishLocationMap();

    if (initialLocations.length === 0) {
      process.stderr.write("Could not derive locations from raw payload or alert_locations table.\n");
      process.exit(1);
      return;
    }

    const replayNotificationIdBase = options.keepOriginalId
      ? row.notification_id
      : `debug-replay-${row.notification_id}-${Date.now()}`;
    const requestBase = `${options.baseUrl.replace(/\/+$/, "")}/api/mock-alert`;

    const buildRequestUrl = (locations: string[], attemptLabel: string) => {
      const safeAttemptLabel = String(attemptLabel || "attempt")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "attempt";
      const replayNotificationId = options.keepOriginalId
        ? replayNotificationIdBase
        : `${replayNotificationIdBase}-${safeAttemptLabel}`;
      const searchParams = new URLSearchParams();
      searchParams.set("locations", locations.join(","));
      searchParams.set("threat", String(row.threat));
      searchParams.set("isDrill", row.is_drill ? "true" : "false");
      searchParams.set("notificationId", replayNotificationId);
      return `${requestBase}?${searchParams.toString()}`;
    };

    process.stdout.write(
      `Using DB row id=${row.id}, source=${row.source}, notification_id=${row.notification_id}\n`
    );
    process.stdout.write(
      `Initial location source: ${locationsFromRaw.length > 0 ? "raw_payload_json" : "alert_locations"}\n`
    );
    process.stdout.write(
      `Location aliases loaded for EN mapping: ${englishByAlias.size > 0 ? englishByAlias.size : 0}\n`
    );

    const attemptedLocationSets: Array<{ label: string; locations: string[] }> = [
      { label: "initial", locations: initialLocations }
    ];
    if (locationsFromTable.length > 0 && locationsFromTable.join("|") !== initialLocations.join("|")) {
      attemptedLocationSets.push({ label: "alert_locations", locations: locationsFromTable });
    }

    const translatedInitial = translateLocationsToEnglish(initialLocations, englishByAlias);
    if (translatedInitial.changed) {
      attemptedLocationSets.push({ label: "initial_translated_en", locations: translatedInitial.translated });
    }

    if (locationsFromTable.length > 0) {
      const translatedTable = translateLocationsToEnglish(locationsFromTable, englishByAlias);
      if (
        translatedTable.changed &&
        translatedTable.translated.join("|") !== translatedInitial.translated.join("|")
      ) {
        attemptedLocationSets.push({ label: "alert_locations_translated_en", locations: translatedTable.translated });
      }
    }

    const uniqueAttemptedLocationSets: Array<{ label: string; locations: string[] }> = [];
    const seenLocationCsv = new Set<string>();
    for (const attempt of attemptedLocationSets) {
      const csv = attempt.locations.join("|");
      if (!csv || seenLocationCsv.has(csv)) {
        continue;
      }
      seenLocationCsv.add(csv);
      uniqueAttemptedLocationSets.push(attempt);
    }

    process.stdout.write(`Replay attempts prepared: ${uniqueAttemptedLocationSets.length}\n`);

    if (options.dryRun) {
      for (const attempt of uniqueAttemptedLocationSets) {
        process.stdout.write(`[dry-run] ${attempt.label}: ${buildRequestUrl(attempt.locations, attempt.label)}\n`);
      }
      process.stdout.write("Dry run mode: requests not sent.\n");
      return;
    }

    const sendReplay = async (targetUrl: string) => {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });
      const responseText = await response.text();
      let parsedResponse: unknown = responseText;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch {
        // Keep raw response text.
      }
      return { response, parsedResponse };
    };

    let result: Awaited<ReturnType<typeof sendReplay>> | null = null;
    for (let attemptIndex = 0; attemptIndex < uniqueAttemptedLocationSets.length; attemptIndex += 1) {
      const attempt = uniqueAttemptedLocationSets[attemptIndex];
      const targetUrl = buildRequestUrl(attempt.locations, attempt.label);
      process.stdout.write(`\nAttempt ${attemptIndex + 1}/${uniqueAttemptedLocationSets.length} (${attempt.label})\n`);
      process.stdout.write(`Replay URL: ${targetUrl}\n`);
      result = await sendReplay(targetUrl);
      process.stdout.write(`HTTP ${result.response.status} ${result.response.statusText}\n`);
      process.stdout.write(`${inspect(result.parsedResponse, { depth: null, colors: true })}\n`);
      if (result.response.ok) {
        break;
      }
    }

    if (!result || !result.response.ok) {
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

void main();
