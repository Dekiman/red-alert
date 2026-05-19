import { createLogger } from "../../logger.js";
import { isWeatherNewsEvent } from "../event-type.js";
import { isEnglishNewsCandidate, resolveNewsSourceLanguage } from "../language-filter.js";
import { normalizeSourceTypeValue } from "./normalizers.js";
import { createOsintProviders } from "./providers.js";
import type { ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";
import type { NewsRepository } from "../../persistence/index.js";

const newsLogger = createLogger("news");
const WEATHER_SOURCE_TYPE_VALUES = ["weather", "nws", "weather_canada", "meteoalarm"];
const RATE_LIMIT_BASE_BACKOFF_MS = 60_000;
const RATE_LIMIT_MAX_BACKOFF_MS = 30 * 60_000;
const TRANSIENT_ERROR_BASE_BACKOFF_MS = 15_000;
const TRANSIENT_ERROR_MAX_BACKOFF_MS = 5 * 60_000;

export type NewsCollectionPipelineOptions = {
  enabled?: boolean;
  englishOnly?: boolean;
  includeWeatherEvents?: boolean;
  pollMs?: number;
  fetchTimeoutMs?: number;
  maxSignalsPerEvent?: number;
  includeSourceTypes?: string[];
  providerNames?: string[];
  maxEventsPerProvider?: number;
  gdacsApiUrl?: string;
  gdacsLookbackDays?: number;
  usgsApiUrl?: string;
  gdeltApiUrl?: string;
  gdeltQuery?: string;
  gdeltMaxRecords?: number;
  nwsApiUrl?: string;
  weatherCanadaApiUrl?: string;
  meteoalarmApiUrl?: string;
  database: {
    news: NewsRepository;
  };
  onNewsEvent: (event: any) => void;
};

type ProviderBackoffState = {
  backoffUntilMs: number;
  rateLimitCount: number;
  transientErrorCount: number;
};

class HttpResponseError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(status: number, statusText: string, retryAfterMs: number | null) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpResponseError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterHeader(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000);
  }

  const parsedDateMs = Date.parse(value);
  if (!Number.isFinite(parsedDateMs)) {
    return null;
  }

  const delayMs = parsedDateMs - Date.now();
  return delayMs > 0 ? delayMs : null;
}

export async function executeNewsCollectionPipeline(options: NewsCollectionPipelineOptions, reason: string) {
  const {
    enabled = true,
    englishOnly = true,
    includeWeatherEvents = false,
    pollMs = 15000,
    fetchTimeoutMs = 10000,
    maxSignalsPerEvent = 3,
    includeSourceTypes = includeWeatherEvents
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
      : ["gdacs", "gdelt", "usgs", "official", "osint", "news", "disaster", "earthquake"],
    providerNames = includeWeatherEvents
      ? ["gdacs", "gdelt", "usgs", "nws", "weather_canada", "meteoalarm"]
      : ["gdacs", "gdelt", "usgs"],
    maxEventsPerProvider = 80,
    gdacsApiUrl,
    gdacsLookbackDays,
    usgsApiUrl,
    gdeltApiUrl,
    gdeltQuery,
    gdeltMaxRecords,
    nwsApiUrl,
    weatherCanadaApiUrl,
    meteoalarmApiUrl,
    database,
    onNewsEvent
  } = options;

  if (!enabled) {
    return;
  }

  const includeSourceTypesSet = new Set(
    (Array.isArray(includeSourceTypes) ? includeSourceTypes : [])
      .map((type) => normalizeSourceTypeValue(type))
      .filter(Boolean)
  );

  async function fetchWithTimeout(url: string, acceptHeader: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: acceptHeader,
          "User-Agent": "red-alert-stream/1.0"
        }
      });
      if (!response.ok) {
        throw new HttpResponseError(
          response.status,
          response.statusText,
          parseRetryAfterHeader(response.headers.get("retry-after"))
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  const providers = createOsintProviders({
    providerNames,
    includeWeatherProviders: includeWeatherEvents,
    fetchJson: async (url) => {
      const response = await fetchWithTimeout(
        url,
        "application/geo+json, application/ld+json, application/json;q=0.95, text/plain;q=0.5, */*;q=0.1"
      );
      return await response.json();
    },
    fetchText: async (url) => {
      const response = await fetchWithTimeout(
        url,
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.95, text/plain;q=0.7, */*;q=0.1"
      );
      return await response.text();
    },
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
    logger: newsLogger
  });

  function getEventVersion(event: any) {
    return `${event.updatedAtIso}|${event.signalCount}|${Number(event.isActive)}|${event.title}`;
  }

  function eventPassesSourceFilter(event: any) {
    if (includeSourceTypesSet.size === 0) {
      return true;
    }

    const sourceTypes = Array.isArray(event?.sourceTypes)
      ? event.sourceTypes
      : String(event?.sourceTypesRaw ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
    if (sourceTypes.length === 0) {
      return true;
    }

    const normalizedSourceTypes = sourceTypes
      .map((sourceType) => normalizeSourceTypeValue(sourceType))
      .filter(Boolean);
    if (normalizedSourceTypes.length === 0) {
      return true;
    }

    const weatherSourceTypesSet = new Set(
      WEATHER_SOURCE_TYPE_VALUES.map((sourceType) => normalizeSourceTypeValue(sourceType))
    );

    if (
      isWeatherNewsEvent(event) &&
      !Array.from(weatherSourceTypesSet).some((sourceType) => includeSourceTypesSet.has(sourceType))
    ) {
      return false;
    }

    return normalizedSourceTypes.some((sourceType) => includeSourceTypesSet.has(sourceType));
  }

  async function processOneCollectedEvent(collected: ProviderCollectedEvent) {
    const event = collected?.event;
    if (!event?.eventId) return null;
    if (!includeWeatherEvents && isWeatherNewsEvent(event)) return null;
    if (englishOnly && !isEnglishNewsCandidate({
      title: event?.title,
      summary: event?.summary,
      sourceLanguage: resolveNewsSourceLanguage(event, collected.rawEvent)
    })) return null;
    if (!eventPassesSourceFilter(event)) return null;

    const storedEvent = await database.news.getEvent(event.eventId);
    const incomingVersion = getEventVersion(event);
    const storedVersion = storedEvent ? getEventVersion(storedEvent) : null;

    if (storedVersion === incomingVersion) {
      return null;
    }

    console.log(`[CollectionPipeline] Event ${event.eventId} changed or is new. Stored version: ${storedVersion}, Incoming version: ${incomingVersion}`);

    await database.news.saveEvent(event, collected.rawEvent);

    const normalizedPairs = (Array.isArray(collected.signals) ? collected.signals : [])
      .filter((pair) => pair && pair.normalized && pair.normalized.signalId)
      .slice(0, Math.max(1, maxSignalsPerEvent));
    
    const normalizedSignals = normalizedPairs.map((pair) => pair.normalized);
    if (normalizedSignals.length > 0) {
      await database.news.saveSignals(
        event.eventId,
        normalizedSignals,
        normalizedPairs.map((pair) => pair.raw)
      );
    }

    const primarySignalUrl = normalizedSignals[0]?.url ?? collected.primarySignalUrl ?? null;
    const primarySourceName = normalizedSignals[0]?.sourceName ?? collected.primarySourceName ?? null;

    return {
      ...event,
      signals: normalizedSignals,
      signalsLoaded: normalizedSignals.length > 0,
      primarySignalUrl,
      primarySourceName
    };
  }

  try {
    const nowMs = Date.now();
    const settledResults = await Promise.all(
      providers.map(async (provider) => {
        const backoff = await database.news.getProviderBackoff(provider.name);
        if (backoff && backoff.backoffUntilMs > nowMs) {
          return { providerName: provider.name, events: [], error: null, skipped: true };
        }

        try {
          console.log(`[CollectionPipeline] Fetching from ${provider.name}`);
          const events = await provider.fetchEvents();
          console.log(`[CollectionPipeline] Provider ${provider.name} returned ${events.length} events`);
          
          await database.news.setProviderBackoff(provider.name, {
            backoffUntilMs: provider.throttleMs ? nowMs + provider.throttleMs : 0,
            rateLimitCount: 0,
            transientErrorCount: 0
          });

          return { providerName: provider.name, events, error: null };
        } catch (error) {
          console.error(`[CollectionPipeline] Provider ${provider.name} failed:`, error);
          
          const state = backoff || { backoffUntilMs: 0, rateLimitCount: 0, transientErrorCount: 0 };
          
          if (error instanceof HttpResponseError && error.status === 429) {
            state.rateLimitCount += 1;
            state.transientErrorCount = 0;
            const backoffMs = error.retryAfterMs ?? Math.min(Math.max(pollMs, RATE_LIMIT_BASE_BACKOFF_MS) * 2 ** (state.rateLimitCount - 1), RATE_LIMIT_MAX_BACKOFF_MS);
            state.backoffUntilMs = nowMs + backoffMs;
          } else {
            state.transientErrorCount += 1;
            state.rateLimitCount = 0;
            const backoffMs = Math.min(Math.max(pollMs, TRANSIENT_ERROR_BASE_BACKOFF_MS) * 2 ** (state.transientErrorCount - 1), TRANSIENT_ERROR_MAX_BACKOFF_MS);
            state.backoffUntilMs = nowMs + backoffMs;
          }

          await database.news.setProviderBackoff(provider.name, state);
          return { providerName: provider.name, events: [], error };
        }
      })
    );

    const mergedEvents: ProviderCollectedEvent[] = [];
    for (const res of settledResults) {
      if (!res.error) mergedEvents.push(...res.events);
    }

    mergedEvents.sort((a, b) => String(b?.event?.updatedAtIso ?? "").localeCompare(String(a?.event?.updatedAtIso ?? "")));

    const emittedEventIds = new Set<string>();
    let emitted = 0;
    
    for (const collected of mergedEvents) {
      const eventId = String(collected?.event?.eventId ?? "").trim();
      if (!eventId || emittedEventIds.has(eventId)) continue;
      emittedEventIds.add(eventId);

      const processedEvent = await processOneCollectedEvent(collected);
      if (processedEvent) {
        emitted++;
        onNewsEvent(processedEvent);
      }
    }

    console.log(`[CollectionPipeline] Process complete. Reason: ${reason}, Events seen: ${mergedEvents.length}, Emitted: ${emitted}`);
  } catch (error: any) {
    newsLogger.error("osint collection pipeline failed", { reason, error: error?.message });
  }
}
