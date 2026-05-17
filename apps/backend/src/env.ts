import { z } from "zod";

const booleanSchema = (defaultValue: boolean) =>
  z.preprocess((val) => {
    if (typeof val === "string") {
      const lower = val.toLowerCase();
      if (lower === "true" || lower === "1" || lower === "yes") return true;
      if (lower === "false" || lower === "0" || lower === "no") return false;
    }
    return val;
  }, z.boolean().default(defaultValue));

const numberSchema = (defaultValue: number, minValue = 0) =>
  z.coerce.number().min(minValue).default(defaultValue);

const csvSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return val;
}, z.array(z.string()).optional());

export const envSchema = z.object({
  // Basic Config
  RED_ALERT_WS_URL: z.string().default("wss://ws.tzevaadom.co.il/socket?platform=WEB"),
  RED_ALERT_NOTIFICATIONS_URL: z.string().default("https://api.tzevaadom.co.il/notifications?"),
  RED_ALERT_RECONNECT_MS: numberSchema(5000),
  RED_ALERT_BACKUP_POLL_MS: numberSchema(3000),
  RED_ALERT_WS_ORIGIN: z.string().default("https://www.tzevaadom.co.il"),
  RED_ALERT_WS_USER_AGENT: z.string().default("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"),
  RED_ALERT_TIMEZONE: z.string().default("Asia/Jerusalem"),
  RED_ALERT_MAX_SEEN_IDS: numberSchema(500, 100),
  RED_ALERT_ENGLISH_ONLY: booleanSchema(false),
  RED_ALERT_UI_HISTORY_SIZE: numberSchema(100, 1),
  RED_ALERT_UI_NEWS_HISTORY_SIZE: numberSchema(100, 1),

  // News Config
  RED_ALERT_NEWS_ENABLED: booleanSchema(true),
  RED_ALERT_NEWS_INCLUDE_WEATHER: booleanSchema(false),
  RED_ALERT_NEWS_ENGLISH_ONLY: booleanSchema(false),
  RED_ALERT_NEWS_POLL_MS: numberSchema(15000, 1000),
  RED_ALERT_NEWS_FETCH_TIMEOUT_MS: numberSchema(10000, 1000),
  RED_ALERT_NEWS_MAX_SIGNALS_PER_EVENT: numberSchema(3, 1),
  RED_ALERT_NEWS_PROVIDERS: csvSchema,
  RED_ALERT_NEWS_SOURCE_TYPES: csvSchema,
  RED_ALERT_NEWS_MAX_EVENTS_PER_PROVIDER: numberSchema(80, 1),

  // Provider URLs
  RED_ALERT_NEWS_GDACS_API_URL: z.string().default("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"),
  RED_ALERT_NEWS_GDACS_LOOKBACK_DAYS: numberSchema(14, 1),
  RED_ALERT_NEWS_USGS_API_URL: z.string().default("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"),
  RED_ALERT_NEWS_GDELT_API_URL: z.string().default("https://api.gdeltproject.org/api/v2/doc/doc"),
  RED_ALERT_NEWS_GDELT_QUERY: z.string().default("(conflict OR missile OR strike OR earthquake OR flood OR wildfire)"),
  RED_ALERT_NEWS_GDELT_MAX_RECORDS: numberSchema(60, 1),
  RED_ALERT_NEWS_NWS_API_URL: z.string().default("https://api.weather.gov/alerts/active"),
  RED_ALERT_NEWS_WEATHER_CANADA_API_URL: z.string().default("https://api.weather.gc.ca/collections/weather-alerts/items?f=json"),
  RED_ALERT_NEWS_METEOALARM_API_URL: z.string().default("https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-rss-europe"),

  // Locality Map Config
  RED_ALERT_LOCALITY_MAP_ENABLED: booleanSchema(true),
  RED_ALERT_LOCALITY_MAP_LISTS_VERSIONS_URL: z.string().default("https://api.tzevaadom.co.il/lists-versions"),
  RED_ALERT_LOCALITY_MAP_CITIES_URL: z.string().default("https://www.tzevaadom.co.il/static/cities.json"),
  RED_ALERT_LOCALITY_MAP_POLYGONS_URL: z.string().default("https://www.tzevaadom.co.il/static/polygons.json"),
  RED_ALERT_LOCALITY_MAP_FETCH_TIMEOUT_MS: numberSchema(15000, 1000),
  RED_ALERT_LOCALITY_MAP_REFRESH_MS: numberSchema(21600000, 60000),
  RED_ALERT_LOCALITY_MAP_DEFAULT_CITIES_VERSION: numberSchema(10, 1),
  RED_ALERT_LOCALITY_MAP_DEFAULT_POLYGONS_VERSION: numberSchema(5, 1),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema> & {
  ALERTS_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  ALERT_BROADCASTER: DurableObjectNamespace;
};

export function parseEnv(env: any): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return {
    ...result.data,
    ALERTS_KV: env.ALERTS_KV,
    CACHE_KV: env.CACHE_KV,
    ALERT_BROADCASTER: env.ALERT_BROADCASTER,
  };
}
