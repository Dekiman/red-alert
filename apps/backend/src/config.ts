import path from "node:path";
import { parseBooleanEnv, parseCsvEnv, parseNumberEnv } from "./utils/env.js";

export function createAppConfig(logger) {
  const frontendPublicRoot =
    process.env.RED_ALERT_FRONTEND_PUBLIC_ROOT ?? path.join(process.cwd(), "dist", "frontend");
  const newsIncludeWeather = parseBooleanEnv("RED_ALERT_NEWS_INCLUDE_WEATHER", false, logger);
  const defaultNewsProviders = newsIncludeWeather
    ? "gdacs,gdelt,usgs,nws,weather_canada,meteoalarm"
    : "gdacs,gdelt,usgs";
  const defaultNewsSourceTypes = newsIncludeWeather
    ? "gdacs,gdelt,usgs,nws,weather_canada,meteoalarm,official,osint,news,disaster,earthquake,weather,warning"
    : "gdacs,gdelt,usgs,official,osint,news,disaster,earthquake";

  return {
    frontendPublicRoot,
    frontendAssetsRoot: path.join(frontendPublicRoot, "assets"),
    websocketUrl: process.env.RED_ALERT_WS_URL ?? "wss://ws.tzevaadom.co.il/socket?platform=WEB",
    notificationsApiUrl:
      process.env.RED_ALERT_NOTIFICATIONS_URL ?? "https://api.tzevaadom.co.il/notifications?",
    reconnectDelayMs: parseNumberEnv("RED_ALERT_RECONNECT_MS", 5000, { logger }),
    backupPollMs: parseNumberEnv("RED_ALERT_BACKUP_POLL_MS", 3000, { logger }),
    wsOrigin: process.env.RED_ALERT_WS_ORIGIN ?? "https://www.tzevaadom.co.il",
    wsUserAgent:
      process.env.RED_ALERT_WS_USER_AGENT ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    alertTimezone: process.env.RED_ALERT_TIMEZONE ?? "Asia/Jerusalem",
    maxSeenIds: parseNumberEnv("RED_ALERT_MAX_SEEN_IDS", 500, { minValue: 100, logger }),
    englishOnly: parseBooleanEnv("RED_ALERT_ENGLISH_ONLY", false, logger),
    maxParseLogChars: 400,
    webHost: process.env.RED_ALERT_WEB_HOST ?? "127.0.0.1",
    webPort: parseNumberEnv("RED_ALERT_WEB_PORT", 3030, { minValue: 1, logger }),
    webSocketPath: process.env.RED_ALERT_WEB_SOCKET_PATH ?? "/ui-socket",
    enableMockApi: parseBooleanEnv("RED_ALERT_ENABLE_MOCK_API", true, logger),
    uiHistorySize: parseNumberEnv("RED_ALERT_UI_HISTORY_SIZE", 100, { minValue: 1, logger }),
    uiNewsHistorySize: parseNumberEnv("RED_ALERT_UI_NEWS_HISTORY_SIZE", 100, {
      minValue: 1,
      logger
    }),
    newsEnabled: parseBooleanEnv("RED_ALERT_NEWS_ENABLED", true, logger),
    newsIncludeWeather,
    newsEnglishOnly: parseBooleanEnv("RED_ALERT_NEWS_ENGLISH_ONLY", true, logger),
    newsPollMs: parseNumberEnv("RED_ALERT_NEWS_POLL_MS", 15000, { minValue: 1000, logger }),
    newsFetchTimeoutMs: parseNumberEnv("RED_ALERT_NEWS_FETCH_TIMEOUT_MS", 10000, {
      minValue: 1000,
      logger
    }),
    newsMaxSignalsPerEvent: parseNumberEnv("RED_ALERT_NEWS_MAX_SIGNALS_PER_EVENT", 3, {
      minValue: 1,
      logger
    }),
    newsProviders: parseCsvEnv("RED_ALERT_NEWS_PROVIDERS", defaultNewsProviders),
    newsSourceTypes: parseCsvEnv(
      "RED_ALERT_NEWS_SOURCE_TYPES",
      defaultNewsSourceTypes
    ),
    newsMaxEventsPerProvider: parseNumberEnv("RED_ALERT_NEWS_MAX_EVENTS_PER_PROVIDER", 80, {
      minValue: 1,
      logger
    }),
    newsGdacsApiUrl:
      process.env.RED_ALERT_NEWS_GDACS_API_URL ??
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
    newsGdacsLookbackDays: parseNumberEnv("RED_ALERT_NEWS_GDACS_LOOKBACK_DAYS", 14, {
      minValue: 1,
      logger
    }),
    newsUsgsApiUrl:
      process.env.RED_ALERT_NEWS_USGS_API_URL ??
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    newsGdeltApiUrl:
      process.env.RED_ALERT_NEWS_GDELT_API_URL ?? "https://api.gdeltproject.org/api/v2/doc/doc",
    newsGdeltQuery:
      process.env.RED_ALERT_NEWS_GDELT_QUERY ??
      "(conflict OR missile OR strike OR earthquake OR flood OR wildfire)",
    newsGdeltMaxRecords: parseNumberEnv("RED_ALERT_NEWS_GDELT_MAX_RECORDS", 60, {
      minValue: 1,
      logger
    }),
    newsNwsApiUrl:
      process.env.RED_ALERT_NEWS_NWS_API_URL ?? "https://api.weather.gov/alerts/active",
    newsWeatherCanadaApiUrl:
      process.env.RED_ALERT_NEWS_WEATHER_CANADA_API_URL ??
      "https://api.weather.gc.ca/collections/weather-alerts/items?f=json",
    newsMeteoalarmApiUrl:
      process.env.RED_ALERT_NEWS_METEOALARM_API_URL ??
      "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-rss-europe",
    localityMapEnabled: parseBooleanEnv("RED_ALERT_LOCALITY_MAP_ENABLED", true, logger),
    localityMapListsVersionsUrl:
      process.env.RED_ALERT_LOCALITY_MAP_LISTS_VERSIONS_URL ??
      "https://api.tzevaadom.co.il/lists-versions",
    localityMapCitiesUrl:
      process.env.RED_ALERT_LOCALITY_MAP_CITIES_URL ?? "https://www.tzevaadom.co.il/static/cities.json",
    localityMapPolygonsUrl:
      process.env.RED_ALERT_LOCALITY_MAP_POLYGONS_URL ?? "https://www.tzevaadom.co.il/static/polygons.json",
    localityMapFetchTimeoutMs: parseNumberEnv("RED_ALERT_LOCALITY_MAP_FETCH_TIMEOUT_MS", 15000, {
      minValue: 1000,
      logger
    }),
    localityMapRefreshMs: parseNumberEnv("RED_ALERT_LOCALITY_MAP_REFRESH_MS", 21600000, {
      minValue: 60000,
      logger
    }),
    localityMapDefaultCitiesVersion: parseNumberEnv(
      "RED_ALERT_LOCALITY_MAP_DEFAULT_CITIES_VERSION",
      10,
      {
        minValue: 1,
        logger
      }
    ),
    localityMapDefaultPolygonsVersion: parseNumberEnv(
      "RED_ALERT_LOCALITY_MAP_DEFAULT_POLYGONS_VERSION",
      5,
      {
        minValue: 1,
        logger
      }
    )
  };
}
