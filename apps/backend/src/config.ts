import type { Env } from "./env.js";

export function createAppConfig(env: Env, _logger: any) {
  const newsIncludeWeather = env.RED_ALERT_NEWS_INCLUDE_WEATHER;
  const defaultNewsProviders = newsIncludeWeather
    ? ["gdacs", "gdelt", "usgs", "nws", "weather_canada", "meteoalarm"]
    : ["gdacs", "gdelt", "usgs"];
  const defaultNewsSourceTypes = newsIncludeWeather
    ? [
        "gdacs",
        "gdelt",
        "usgs",
        "nws",
        "weather_canada",
        "meteoalarm",
        "official",
        "osint",
        "news",
        "disaster",
        "earthquake",
        "weather",
        "warning"
      ]
    : ["gdacs", "gdelt", "usgs", "official", "osint", "news", "disaster", "earthquake"];

  return {
    websocketUrl: env.RED_ALERT_WS_URL,
    notificationsApiUrl: env.RED_ALERT_NOTIFICATIONS_URL,
    reconnectDelayMs: env.RED_ALERT_RECONNECT_MS,
    backupPollMs: env.RED_ALERT_BACKUP_POLL_MS,
    wsOrigin: env.RED_ALERT_WS_ORIGIN,
    wsUserAgent: env.RED_ALERT_WS_USER_AGENT,
    alertTimezone: env.RED_ALERT_TIMEZONE,
    maxSeenIds: env.RED_ALERT_MAX_SEEN_IDS,
    englishOnly: env.RED_ALERT_ENGLISH_ONLY,
    maxParseLogChars: 400,
    uiHistorySize: env.RED_ALERT_UI_HISTORY_SIZE,
    uiNewsHistorySize: env.RED_ALERT_UI_NEWS_HISTORY_SIZE,
    newsEnabled: env.RED_ALERT_NEWS_ENABLED,
    newsIncludeWeather,
    newsEnglishOnly: env.RED_ALERT_NEWS_ENGLISH_ONLY,
    newsPollMs: env.RED_ALERT_NEWS_POLL_MS,
    newsFetchTimeoutMs: env.RED_ALERT_NEWS_FETCH_TIMEOUT_MS,
    newsMaxSignalsPerEvent: env.RED_ALERT_NEWS_MAX_SIGNALS_PER_EVENT,
    newsProviders: env.RED_ALERT_NEWS_PROVIDERS ?? defaultNewsProviders,
    newsSourceTypes: env.RED_ALERT_NEWS_SOURCE_TYPES ?? defaultNewsSourceTypes,
    newsMaxEventsPerProvider: env.RED_ALERT_NEWS_MAX_EVENTS_PER_PROVIDER,
    newsGdacsApiUrl: env.RED_ALERT_NEWS_GDACS_API_URL,
    newsGdacsLookbackDays: env.RED_ALERT_NEWS_GDACS_LOOKBACK_DAYS,
    newsUsgsApiUrl: env.RED_ALERT_NEWS_USGS_API_URL,
    newsGdeltApiUrl: env.RED_ALERT_NEWS_GDELT_API_URL,
    newsGdeltQuery: env.RED_ALERT_NEWS_GDELT_QUERY,
    newsGdeltMaxRecords: env.RED_ALERT_NEWS_GDELT_MAX_RECORDS,
    newsNwsApiUrl: env.RED_ALERT_NEWS_NWS_API_URL,
    newsWeatherCanadaApiUrl: env.RED_ALERT_NEWS_WEATHER_CANADA_API_URL,
    newsMeteoalarmApiUrl: env.RED_ALERT_NEWS_METEOALARM_API_URL,
    localityMapEnabled: env.RED_ALERT_LOCALITY_MAP_ENABLED,
    localityMapListsVersionsUrl: env.RED_ALERT_LOCALITY_MAP_LISTS_VERSIONS_URL,
    localityMapCitiesUrl: env.RED_ALERT_LOCALITY_MAP_CITIES_URL,
    localityMapPolygonsUrl: env.RED_ALERT_LOCALITY_MAP_POLYGONS_URL,
    localityMapFetchTimeoutMs: env.RED_ALERT_LOCALITY_MAP_FETCH_TIMEOUT_MS,
    localityMapRefreshMs: env.RED_ALERT_LOCALITY_MAP_REFRESH_MS,
    localityMapDefaultCitiesVersion: env.RED_ALERT_LOCALITY_MAP_DEFAULT_CITIES_VERSION,
    localityMapDefaultPolygonsVersion: env.RED_ALERT_LOCALITY_MAP_DEFAULT_POLYGONS_VERSION
  };
}
