import { createHash } from "node:crypto";
import path from "node:path";
import { initDatabase } from "../backend/src/db.js";
import { createLogger } from "../backend/src/logger.js";
import { isEnglishNewsCandidate, resolveNewsSourceLanguage } from "../backend/src/news/language-filter.js";
import { clampSeverity, dedupeStrings, normalizeWhitespace, toIsoTimestamp } from "../backend/src/news/collector/provider-helpers.js";

const DEFAULT_DB_PATH = process.env.RED_ALERT_DB_PATH ?? path.join(process.cwd(), "data", "red_alerts.sqlite");
const DEFAULT_QUERY =
  process.env.RED_ALERT_NEWS_GDELT_QUERY ??
  "(conflict OR missile OR strike OR earthquake OR flood OR wildfire) sourcelang:english";
const DEFAULT_API_URL = process.env.RED_ALERT_NEWS_GDELT_API_URL ?? "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_FROM_ISO = "2026-02-01T00:00:00Z";
const DEFAULT_TO_ISO = "2026-04-01T00:00:00Z";
const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_MIN_WINDOW_MINUTES = 180;
const DEFAULT_REQUEST_DELAY_MS = 6000;
const DEFAULT_FETCH_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 6;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const logger = createLogger("import-gdelt-news");

type CliOptions = {
  apiUrl: string;
  dbPath: string;
  query: string;
  fromMs: number;
  toMs: number;
  fixedWindowMinutes: number | null;
  maxRecords: number;
  minWindowMinutes: number;
  requestDelayMs: number;
  fetchTimeoutMs: number;
  maxRetries: number;
  dryRun: boolean;
  help: boolean;
};

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  sourcecountry?: unknown;
  domain?: unknown;
  language?: unknown;
  lang?: unknown;
};

type RequestStats = {
  apiRequests: number;
  windowsVisited: number;
  splitWindows: number;
  saturatedWindows: number;
  articlesSeen: number;
  outOfRangeArticles: number;
  skippedNonEnglish: number;
  eventsChanged: number;
  signalsInserted: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiUrl: DEFAULT_API_URL,
    dbPath: DEFAULT_DB_PATH,
    query: DEFAULT_QUERY,
    fromMs: requireIsoDate(DEFAULT_FROM_ISO, "--from"),
    toMs: requireIsoDate(DEFAULT_TO_ISO, "--to"),
    fixedWindowMinutes: null,
    maxRecords: DEFAULT_MAX_RECORDS,
    minWindowMinutes: DEFAULT_MIN_WINDOW_MINUTES,
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    fetchTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--api-url") {
      options.apiUrl = argv[index + 1] ?? options.apiUrl;
      index += 1;
      continue;
    }
    if (arg === "--db") {
      options.dbPath = argv[index + 1] ?? options.dbPath;
      index += 1;
      continue;
    }
    if (arg === "--query") {
      options.query = argv[index + 1] ?? options.query;
      index += 1;
      continue;
    }
    if (arg === "--from") {
      options.fromMs = requireIsoDate(argv[index + 1] ?? "", "--from");
      index += 1;
      continue;
    }
    if (arg === "--to") {
      options.toMs = requireIsoDate(argv[index + 1] ?? "", "--to");
      index += 1;
      continue;
    }
    if (arg === "--maxrecords") {
      options.maxRecords = requirePositiveInteger(argv[index + 1] ?? "", "--maxrecords");
      index += 1;
      continue;
    }
    if (arg === "--window-minutes") {
      options.fixedWindowMinutes = requirePositiveInteger(argv[index + 1] ?? "", "--window-minutes");
      index += 1;
      continue;
    }
    if (arg === "--min-window-minutes") {
      options.minWindowMinutes = requirePositiveInteger(argv[index + 1] ?? "", "--min-window-minutes");
      index += 1;
      continue;
    }
    if (arg === "--delay-ms") {
      options.requestDelayMs = requireNonNegativeInteger(argv[index + 1] ?? "", "--delay-ms");
      index += 1;
      continue;
    }
    if (arg === "--fetch-timeout-ms") {
      options.fetchTimeoutMs = requirePositiveInteger(argv[index + 1] ?? "", "--fetch-timeout-ms");
      index += 1;
      continue;
    }
    if (arg === "--max-retries") {
      options.maxRetries = requirePositiveInteger(argv[index + 1] ?? "", "--max-retries");
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
  }

  if (options.toMs <= options.fromMs) {
    throw new Error("--to must be later than --from");
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run import:historical-gdelt-news",
      "  npm run import:historical-gdelt-news -- --from 2026-02-01T00:00:00Z --to 2026-04-01T00:00:00Z",
      "",
      "Flags:",
      `  --db <path>                 Database path (default: ${DEFAULT_DB_PATH})`,
      `  --api-url <url>             GDELT DOC API URL (default: ${DEFAULT_API_URL})`,
      `  --query <string>            Search query (default: ${DEFAULT_QUERY})`,
      `  --from <iso>                Inclusive UTC start (default: ${DEFAULT_FROM_ISO})`,
      `  --to <iso>                  Exclusive UTC end (default: ${DEFAULT_TO_ISO})`,
      `  --maxrecords <n>            Per-request result cap (default: ${DEFAULT_MAX_RECORDS})`,
      "  --window-minutes <n>        Fixed request window size; disables adaptive splitting",
      `  --min-window-minutes <n>    Smallest split window (default: ${DEFAULT_MIN_WINDOW_MINUTES})`,
      `  --delay-ms <n>              Base delay between requests (default: ${DEFAULT_REQUEST_DELAY_MS})`,
      `  --fetch-timeout-ms <n>      Per-request timeout (default: ${DEFAULT_FETCH_TIMEOUT_MS})`,
      `  --max-retries <n>           Retry count for 429/5xx (default: ${DEFAULT_MAX_RETRIES})`,
      "  --dry-run                   Do not write to the database"
    ].join("\n") + "\n"
  );
}

function requireIsoDate(rawValue: string, label: string) {
  const parsedMs = Date.parse(String(rawValue ?? "").trim());
  if (!Number.isFinite(parsedMs)) {
    throw new Error(`invalid ISO date for ${label}: ${rawValue}`);
  }
  return parsedMs;
}

function requirePositiveInteger(rawValue: string, label: string) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`invalid positive integer for ${label}: ${rawValue}`);
  }
  return Math.floor(numeric);
}

function requireNonNegativeInteger(rawValue: string, label: string) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`invalid non-negative integer for ${label}: ${rawValue}`);
  }
  return Math.floor(numeric);
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function formatCompactGdeltDate(timestampMs: number) {
  const iso = new Date(timestampMs).toISOString();
  return iso.replace(/[-:TZ]/g, "").replace(/\.\d{3}$/, "");
}

function formatIso(timestampMs: number) {
  return new Date(timestampMs).toISOString();
}

function buildEventId(article: GdeltArticle) {
  const eventKey = `${normalizeWhitespace(article?.url)}|${normalizeWhitespace(article?.seendate)}|${normalizeWhitespace(
    article?.title
  )}`;
  const hash = createHash("sha1").update(eventKey).digest("hex").slice(0, 20);
  return `gdelt-${hash}`;
}

function categorizeFromHeadline(headline: string) {
  const lower = headline.toLowerCase();
  if (
    lower.includes("strike") ||
    lower.includes("missile") ||
    lower.includes("attack") ||
    lower.includes("war") ||
    lower.includes("conflict")
  ) {
    return "conflict";
  }
  if (
    lower.includes("earthquake") ||
    lower.includes("flood") ||
    lower.includes("wildfire") ||
    lower.includes("storm") ||
    lower.includes("hurricane") ||
    lower.includes("eruption")
  ) {
    return "disaster";
  }
  return "news";
}

function severityFromHeadline(headline: string) {
  const lower = headline.toLowerCase();
  if (lower.includes("kills") || lower.includes("dead") || lower.includes("massive")) {
    return 4;
  }
  if (lower.includes("war") || lower.includes("missile") || lower.includes("earthquake")) {
    return 3;
  }
  return clampSeverity(2);
}

function getRetryDelayMs(attemptIndex: number, baseDelayMs: number, retryAfterHeader: string | null) {
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }
  return Math.min(baseDelayMs * 2 ** attemptIndex, 120_000);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  logger.info("starting historical GDELT news import", {
    dbPath: options.dbPath,
    apiUrl: options.apiUrl,
    fromIso: formatIso(options.fromMs),
      toIso: formatIso(options.toMs),
      fixedWindowMinutes: options.fixedWindowMinutes,
      maxRecords: options.maxRecords,
      minWindowMinutes: options.minWindowMinutes,
      requestDelayMs: options.requestDelayMs,
      fetchTimeoutMs: options.fetchTimeoutMs,
      maxRetries: options.maxRetries,
    dryRun: options.dryRun
  });

  const database = initDatabase({
    dbPath: options.dbPath,
    includeWeatherNews: false,
    englishOnlyNews: true
  });

  const stats: RequestStats = {
    apiRequests: 0,
    windowsVisited: 0,
    splitWindows: 0,
    saturatedWindows: 0,
    articlesSeen: 0,
    outOfRangeArticles: 0,
    skippedNonEnglish: 0,
    eventsChanged: 0,
    signalsInserted: 0
  };
  let lastRequestEndedAtMs = 0;

  async function fetchWindow(startMs: number, endMs: number) {
    const url = new URL(options.apiUrl);
    url.searchParams.set("query", options.query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "DateDesc");
    url.searchParams.set("maxrecords", String(Math.max(1, options.maxRecords)));
    url.searchParams.set("STARTDATETIME", formatCompactGdeltDate(startMs));
    url.searchParams.set("ENDDATETIME", formatCompactGdeltDate(endMs));

    for (let attemptIndex = 0; attemptIndex <= options.maxRetries; attemptIndex += 1) {
      const nowMs = Date.now();
      const waitMs = Math.max(0, lastRequestEndedAtMs + options.requestDelayMs - nowMs);
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.fetchTimeoutMs);
      try {
        stats.apiRequests += 1;
        const response = await fetch(url.toString(), {
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "red-alert-stream/1.0"
          }
        });
        lastRequestEndedAtMs = Date.now();

        if (!response.ok) {
          const status = response.status;
          if (attemptIndex < options.maxRetries && RETRYABLE_STATUS_CODES.has(status)) {
            const retryDelayMs = getRetryDelayMs(
              attemptIndex,
              Math.max(options.requestDelayMs * 2, 3000),
              response.headers.get("retry-after")
            );
            logger.warn("gdelt request retry scheduled", {
              status,
              attempt: attemptIndex + 1,
              retryDelayMs,
              startIso: formatIso(startMs),
              endIso: formatIso(endMs)
            });
            await sleep(retryDelayMs);
            continue;
          }
          throw new Error(`HTTP ${status} ${response.statusText}`);
        }

        const responseText = await response.text();
        try {
          return JSON.parse(responseText);
        } catch {
          throw new Error(
            `unexpected non-JSON response: ${responseText.slice(0, 160).replace(/\s+/g, " ").trim()}`
          );
        }
      } catch (error: any) {
        lastRequestEndedAtMs = Date.now();
        const errorMessage = error?.message ?? String(error ?? "unknown error");
        const isRetryable = attemptIndex < options.maxRetries && /abort|timed out|fetch failed/i.test(errorMessage);
        if (isRetryable) {
          const retryDelayMs = getRetryDelayMs(attemptIndex, Math.max(options.requestDelayMs * 2, 3000), null);
          logger.warn("gdelt request retry scheduled", {
            attempt: attemptIndex + 1,
            retryDelayMs,
            error: errorMessage,
            startIso: formatIso(startMs),
            endIso: formatIso(endMs)
          });
          await sleep(retryDelayMs);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error("request retries exhausted");
  }

  function saveArticle(article: GdeltArticle) {
    stats.articlesSeen += 1;
    const title = normalizeWhitespace(article?.title);
    const articleUrl = normalizeWhitespace(article?.url) || null;
    if (!title && !articleUrl) {
      return;
    }
    if (!isEnglishNewsCandidate({ title, summary: title, sourceLanguage: resolveNewsSourceLanguage(article) })) {
      stats.skippedNonEnglish += 1;
      return;
    }

    const updatedAtIso = toIsoTimestamp(article?.seendate);
    if (!updatedAtIso) {
      stats.outOfRangeArticles += 1;
      return;
    }
    const updatedAtMs = Date.parse(updatedAtIso);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs < options.fromMs || updatedAtMs >= options.toMs) {
      stats.outOfRangeArticles += 1;
      return;
    }

    const nowIso = new Date().toISOString();
    const eventId = buildEventId(article);
    const category = categorizeFromHeadline(title || "news");
    const sourceTypes = dedupeStrings(["gdelt", "osint", "news", category]);
    const createdAtIso = updatedAtIso;
    const country = normalizeWhitespace(article?.sourcecountry) || null;
    const sourceName = normalizeWhitespace(article?.domain) || "GDELT";
    const summary = title || normalizeWhitespace(article?.domain) || "GDELT article";

    const normalizedEvent = {
      eventId,
      title: title || summary,
      summary,
      category,
      severity: severityFromHeadline(title || summary),
      sourceTypes,
      sourceTypesRaw: sourceTypes.join(","),
      signalCount: 1,
      isActive: true,
      locationName: country,
      country,
      region: null,
      lat: null,
      lng: null,
      createdAtIso,
      updatedAtIso,
      fetchedAtIso: nowIso
    };

    const normalizedSignal = {
      signalId: `${eventId}-signal-${Math.floor(updatedAtMs / 1000)}`,
      eventId,
      sourceType: "gdelt",
      sourceName,
      sourceReliability: null,
      title: title || summary,
      content: summary,
      url: articleUrl,
      timestampIso: updatedAtIso,
      createdAtIso,
      accountHandle: null,
      tweetId: null,
      mediaUrls: [],
      fetchedAtIso: nowIso
    };

    if (!options.dryRun) {
      const eventSaveResult = database.saveLiveNewsEvent(normalizedEvent, article);
      if (eventSaveResult.changed) {
        stats.eventsChanged += 1;
      }
      const signalSaveResult = database.saveLiveNewsSignals(eventId, [normalizedSignal], [article]);
      stats.signalsInserted += signalSaveResult.inserted;
      return;
    }

    stats.eventsChanged += 1;
    stats.signalsInserted += 1;
  }

  async function importWindow(startMs: number, endMs: number, depth = 0, allowSplit = true): Promise<void> {
    stats.windowsVisited += 1;
    const payload = await fetchWindow(startMs, endMs);
    const articles = Array.isArray(payload?.articles) ? (payload.articles as GdeltArticle[]) : [];
    const windowMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));

    logger.info("gdelt window fetched", {
      startIso: formatIso(startMs),
      endIso: formatIso(endMs),
      windowMinutes,
      articles: articles.length,
      depth
    });

    const minWindowMs = options.minWindowMinutes * 60000;
    if (allowSplit && articles.length >= options.maxRecords && endMs - startMs > minWindowMs) {
      stats.splitWindows += 1;
      let midpointMs = startMs + Math.floor((endMs - startMs) / 2);
      midpointMs = Math.floor(midpointMs / 60000) * 60000;
      if (midpointMs <= startMs || midpointMs >= endMs) {
        midpointMs = startMs + Math.floor((endMs - startMs) / 2);
      }
      if (midpointMs <= startMs || midpointMs >= endMs) {
        stats.saturatedWindows += 1;
      } else {
        await importWindow(startMs, midpointMs, depth + 1, allowSplit);
        await importWindow(midpointMs, endMs, depth + 1, allowSplit);
        return;
      }
    } else if (articles.length >= options.maxRecords) {
      stats.saturatedWindows += 1;
      logger.warn("gdelt window saturated at minimum size", {
        startIso: formatIso(startMs),
        endIso: formatIso(endMs),
        articles: articles.length,
        maxRecords: options.maxRecords,
        minWindowMinutes: options.minWindowMinutes
      });
    }

    for (const article of articles) {
      saveArticle(article);
    }
  }

  try {
    if (options.fixedWindowMinutes != null) {
      const fixedWindowMs = options.fixedWindowMinutes * 60000;
      for (let windowStartMs = options.fromMs; windowStartMs < options.toMs; windowStartMs += fixedWindowMs) {
        const windowEndMs = Math.min(windowStartMs + fixedWindowMs, options.toMs);
        await importWindow(windowStartMs, windowEndMs, 0, false);
      }
    } else {
      await importWindow(options.fromMs, options.toMs);
    }
    logger.info("historical GDELT news import complete", {
      fromIso: formatIso(options.fromMs),
      toIso: formatIso(options.toMs),
      dryRun: options.dryRun,
      ...stats
    });
  } finally {
    database.close();
  }
}

main().catch((error: any) => {
  logger.error("historical GDELT news import failed", {
    error: error?.message ?? String(error ?? "unknown error")
  });
  process.exitCode = 1;
});
