import { createGdacsProvider } from "./provider-gdacs.js";
import { createGdeltProvider } from "./provider-gdelt.js";
import { createMeteoalarmProvider } from "./provider-meteoalarm.js";
import { createNwsProvider } from "./provider-nws.js";
import { createUsgsProvider } from "./provider-usgs.js";
import { createWeatherCanadaProvider } from "./provider-weather-canada.js";
import { createRssProvider } from "./provider-rss.js";
import type { OsintNewsProvider } from "./provider-types.js";

const DEFAULT_THROTTLES_MS: Record<string, number> = {
  usgs: 300_000, // 5 minutes
  gdacs: 60_000, // 1 minute
  gdelt: 60_000, // 1 minute
  bbc_rss: 60_000, // 1 minute
  the_war_zone: 60_000, // 1 minute
  defense_blog: 60_000, // 1 minute
  un_news: 60_000 // 1 minute
};

type CreateOsintProvidersOptions = {
  providerNames: string[];
  includeWeatherProviders?: boolean;
  fetchJson: (url: string) => Promise<any>;
  fetchText: (url: string) => Promise<string>;
  maxEventsPerProvider: number;
  gdacsApiUrl: string;
  gdacsLookbackDays: number;
  usgsApiUrl: string;
  gdeltApiUrl: string;
  gdeltQuery: string;
  gdeltMaxRecords: number;
  nwsApiUrl: string;
  weatherCanadaApiUrl: string;
  meteoalarmApiUrl: string;
  bbcRssApiUrl: string;
  twzApiUrl: string;
  defenseBlogApiUrl: string;
  unNewsApiUrl: string;
  logger?: {
    warn?: (message: string, context?: Record<string, unknown>) => void;
  };
};

export function createOsintProviders({
  providerNames,
  includeWeatherProviders = false,
  fetchJson,
  fetchText,
  maxEventsPerProvider,
  gdacsApiUrl,
  gdacsLookbackDays,
  usgsApiUrl,
  gdeltApiUrl,
  gdeltQuery,
  gdeltMaxRecords,
  nwsApiUrl,
  weatherCanadaApiUrl,
  meteoalarmApiUrl,
  bbcRssApiUrl,
  twzApiUrl,
  defenseBlogApiUrl,
  unNewsApiUrl,
  logger
}: CreateOsintProvidersOptions): OsintNewsProvider[] {
  const registry = new Map<string, OsintNewsProvider>([
    [
      "gdacs",
      createGdacsProvider({
        fetchJson,
        apiUrl: gdacsApiUrl,
        lookbackDays: gdacsLookbackDays,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.gdacs
      })
    ],
    [
      "usgs",
      createUsgsProvider({
        fetchJson,
        apiUrl: usgsApiUrl,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.usgs
      })
    ],
    [
      "gdelt",
      createGdeltProvider({
        fetchJson,
        apiUrl: gdeltApiUrl,
        query: gdeltQuery,
        maxRecords: gdeltMaxRecords,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.gdelt
      })
    ],
    [
      "nws",
      createNwsProvider({
        fetchJson,
        apiUrl: nwsApiUrl,
        maxEvents: maxEventsPerProvider
      })
    ],
    [
      "weather_canada",
      createWeatherCanadaProvider({
        fetchJson,
        apiUrl: weatherCanadaApiUrl,
        maxEvents: maxEventsPerProvider
      })
    ],
    [
      "meteoalarm",
      createMeteoalarmProvider({
        fetchText,
        apiUrl: meteoalarmApiUrl,
        maxEvents: maxEventsPerProvider
      })
    ],
    [
      "bbc_rss",
      createRssProvider({
        name: "bbc_rss",
        sourceName: "BBC News",
        apiUrl: bbcRssApiUrl,
        fetchText,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.bbc_rss
      })
    ],
    [
      "the_war_zone",
      createRssProvider({
        name: "the_war_zone",
        sourceName: "The War Zone",
        apiUrl: twzApiUrl,
        fetchText,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.the_war_zone
      })
    ],
    [
      "defense_blog",
      createRssProvider({
        name: "defense_blog",
        sourceName: "Defense Blog",
        apiUrl: defenseBlogApiUrl,
        fetchText,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.defense_blog
      })
    ],
    [
      "un_news",
      createRssProvider({
        name: "un_news",
        sourceName: "UN News",
        apiUrl: unNewsApiUrl,
        fetchText,
        maxEvents: maxEventsPerProvider,
        throttleMs: DEFAULT_THROTTLES_MS.un_news
      })
    ]
  ]);

  const resolvedProviders: OsintNewsProvider[] = [];
  const normalizedNames = Array.from(
    new Set(
      (Array.isArray(providerNames) ? providerNames : [])
        .map((providerName) => String(providerName ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

  for (const providerName of normalizedNames) {
    const provider = registry.get(providerName);
    if (!provider) {
      logger?.warn?.("unknown osint provider configured; skipping", { providerName });
      continue;
    }
    resolvedProviders.push(provider);
  }

  const fallbackProviderNames = includeWeatherProviders
    ? ["gdacs", "gdelt", "usgs", "nws", "weather_canada", "meteoalarm", "bbc_rss", "the_war_zone", "defense_blog", "un_news"]
    : ["gdacs", "gdelt", "usgs", "bbc_rss", "the_war_zone", "defense_blog", "un_news"];

  if (resolvedProviders.length > 0) {
    return resolvedProviders;
  }

  logger?.warn?.("no valid osint providers configured; using fallback provider list", {
    fallback: fallbackProviderNames
  });
  return fallbackProviderNames.map((providerName) => registry.get(providerName)).filter(Boolean) as OsintNewsProvider[];
}
