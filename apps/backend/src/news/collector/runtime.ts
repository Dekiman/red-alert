import { createLogger } from "../../logger.js";
import { isWeatherNewsEvent } from "../event-type.js";
import { isEnglishNewsCandidate, resolveNewsSourceLanguage } from "../language-filter.js";
import { normalizeSourceTypeValue } from "./normalizers.js";
import { createOsintProviders } from "./providers.js";
import type { ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

const newsLogger = createLogger("news");
const WEATHER_SOURCE_TYPE_VALUES = ["weather", "nws", "weather_canada", "meteoalarm"];
const RATE_LIMIT_BASE_BACKOFF_MS = 60_000;
const RATE_LIMIT_MAX_BACKOFF_MS = 30 * 60_000;
const TRANSIENT_ERROR_BASE_BACKOFF_MS = 15_000;
const TRANSIENT_ERROR_MAX_BACKOFF_MS = 5 * 60_000;

type LiveNewsCollectorOptions = {
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
    saveLiveNewsEvent: (event: any, rawPayload: unknown) => { changed: boolean };
    saveLiveNewsSignals: (eventId: string, signals: any[], rawSignals: unknown[]) => { inserted: number };
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

export function createLiveNewsCollector({
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
  gdacsApiUrl = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH",
  gdacsLookbackDays = 14,
  usgsApiUrl = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  gdeltApiUrl = "https://api.gdeltproject.org/api/v2/doc/doc",
  gdeltQuery = "(conflict OR missile OR strike OR earthquake OR flood OR wildfire)",
  gdeltMaxRecords = 60,
  nwsApiUrl = "https://api.weather.gov/alerts/active",
  weatherCanadaApiUrl = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json",
  meteoalarmApiUrl = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-rss-europe",
  database,
  onNewsEvent
}: LiveNewsCollectorOptions) {
  let running = false;
  let pollingTimer: NodeJS.Timeout | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let refreshInFlight = false;
  let refreshPending = false;

  const knownEventVersion = new Map<string, string>();
  const providerBackoffByName = new Map<string, ProviderBackoffState>();
  const includeSourceTypesSet = new Set(
    (Array.isArray(includeSourceTypes) ? includeSourceTypes : [])
      .map((type) => normalizeSourceTypeValue(type))
      .filter(Boolean)
  );
  const weatherSourceTypesSet = new Set(
    WEATHER_SOURCE_TYPE_VALUES.map((sourceType) => normalizeSourceTypeValue(sourceType))
  );

  function getProviderBackoffState(providerName: string): ProviderBackoffState {
    let state = providerBackoffByName.get(providerName);
    if (!state) {
      state = {
        backoffUntilMs: 0,
        rateLimitCount: 0,
        transientErrorCount: 0
      };
      providerBackoffByName.set(providerName, state);
    }
    return state;
  }

  function clearProviderBackoff(providerName: string) {
    const state = getProviderBackoffState(providerName);
    state.backoffUntilMs = 0;
    state.rateLimitCount = 0;
    state.transientErrorCount = 0;
  }

  function applyProviderBackoff(providerName: string, error: unknown, reason: string) {
    const state = getProviderBackoffState(providerName);
    const nowMs = Date.now();

    if (error instanceof HttpResponseError && error.status === 429) {
      state.rateLimitCount += 1;
      state.transientErrorCount = 0;
      const computedBackoffMs =
        error.retryAfterMs ??
        Math.min(
          Math.max(pollMs, RATE_LIMIT_BASE_BACKOFF_MS) * 2 ** Math.max(0, state.rateLimitCount - 1),
          RATE_LIMIT_MAX_BACKOFF_MS
        );
      state.backoffUntilMs = nowMs + computedBackoffMs;
      newsLogger.warn("osint provider rate limited; backing off", {
        reason,
        providerName,
        status: error.status,
        retryAfterMs: error.retryAfterMs,
        backoffMs: computedBackoffMs,
        nextAttemptAtIso: new Date(state.backoffUntilMs).toISOString()
      });
      return;
    }

    state.transientErrorCount += 1;
    state.rateLimitCount = 0;
    const computedBackoffMs = Math.min(
      Math.max(pollMs, TRANSIENT_ERROR_BASE_BACKOFF_MS) * 2 ** Math.max(0, state.transientErrorCount - 1),
      TRANSIENT_ERROR_MAX_BACKOFF_MS
    );
    state.backoffUntilMs = nowMs + computedBackoffMs;
    newsLogger.warn("osint provider refresh failed", {
      reason,
      providerName,
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
      backoffMs: computedBackoffMs,
      nextAttemptAtIso: new Date(state.backoffUntilMs).toISOString()
    });
  }

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

  async function fetchJson(url: string) {
    const response = await fetchWithTimeout(
      url,
      "application/geo+json, application/ld+json, application/json;q=0.95, text/plain;q=0.5, */*;q=0.1"
    );
    return await response.json();
  }

  async function fetchText(url: string) {
    const response = await fetchWithTimeout(
      url,
      "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.95, text/plain;q=0.7, */*;q=0.1"
    );
    return await response.text();
  }

  const providers = createOsintProviders({
    providerNames,
    includeWeatherProviders: includeWeatherEvents,
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

    if (
      isWeatherNewsEvent(event) &&
      !Array.from(weatherSourceTypesSet).some((sourceType) => includeSourceTypesSet.has(sourceType))
    ) {
      return false;
    }

    return normalizedSourceTypes.some((sourceType) => includeSourceTypesSet.has(sourceType));
  }

  function eventPassesWeatherFilter(event: any) {
    return includeWeatherEvents || !isWeatherNewsEvent(event);
  }

  function eventPassesLanguageFilter(event: any, rawEvent: unknown) {
    return (
      !englishOnly ||
      isEnglishNewsCandidate({
        title: event?.title,
        summary: event?.summary,
        sourceLanguage: resolveNewsSourceLanguage(event, rawEvent)
      })
    );
  }

  function schedulePolling() {
    if (!running) {
      return;
    }
    if (pollingTimer) {
      clearTimeout(pollingTimer);
    }
    pollingTimer = setTimeout(() => {
      triggerRefresh("poll");
    }, pollMs);
  }

  function normalizeSignalPairs(signalPairsRaw: ProviderSignalPair[] | undefined) {
    if (!Array.isArray(signalPairsRaw) || signalPairsRaw.length === 0) {
      return [];
    }

    const normalizedPairs = signalPairsRaw
      .filter((pair) => pair && pair.normalized && pair.normalized.signalId)
      .slice(0, Math.max(1, maxSignalsPerEvent));

    return normalizedPairs;
  }

  function processOneCollectedEvent(collected: ProviderCollectedEvent) {
    const event = collected?.event;
    if (!event?.eventId) {
      return null;
    }
    if (!eventPassesWeatherFilter(event)) {
      return null;
    }
    if (!eventPassesLanguageFilter(event, collected.rawEvent)) {
      return null;
    }
    if (!eventPassesSourceFilter(event)) {
      return null;
    }

    const version = getEventVersion(event);
    const lastVersion = knownEventVersion.get(event.eventId);
    const saveResult = database.saveLiveNewsEvent(event, collected.rawEvent);
    const eventChanged = saveResult.changed || (lastVersion != null && lastVersion !== version);
    knownEventVersion.set(event.eventId, version);
    if (!eventChanged) {
      return null;
    }

    const signalPairs = normalizeSignalPairs(collected.signals);
    const normalizedSignals = signalPairs.map((pair) => pair.normalized);
    if (normalizedSignals.length > 0) {
      database.saveLiveNewsSignals(
        event.eventId,
        normalizedSignals,
        signalPairs.map((pair) => pair.raw)
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

  async function refresh(reason: string) {
    if (!running) {
      return;
    }

    if (refreshInFlight) {
      refreshPending = true;
      return;
    }

    refreshInFlight = true;
    try {
      const nowMs = Date.now();
      const eligibleProviders = providers.filter((provider) => {
        const state = getProviderBackoffState(provider.name);
        return state.backoffUntilMs <= nowMs;
      });

      if (eligibleProviders.length === 0) {
        newsLogger.debug("all osint providers are in backoff; skipping refresh", {
          reason,
          providers: providers.map((provider) => {
            const state = getProviderBackoffState(provider.name);
            return {
              providerName: provider.name,
              nextAttemptAtIso:
                state.backoffUntilMs > nowMs ? new Date(state.backoffUntilMs).toISOString() : null
            };
          })
        });
        return;
      }

      const settledResults = await Promise.all(
        eligibleProviders.map(async (provider) => {
          try {
            const events = await provider.fetchEvents();
            clearProviderBackoff(provider.name);
            return {
              providerName: provider.name,
              events,
              error: null
            };
          } catch (error) {
            return {
              providerName: provider.name,
              events: [] as ProviderCollectedEvent[],
              error
            };
          }
        })
      );

      const mergedEvents: ProviderCollectedEvent[] = [];
      for (const settledResult of settledResults) {
        if (settledResult.error) {
          applyProviderBackoff(settledResult.providerName, settledResult.error, reason);
          continue;
        }

        mergedEvents.push(...settledResult.events);
      }

      mergedEvents.sort((a, b) => String(b?.event?.updatedAtIso ?? "").localeCompare(String(a?.event?.updatedAtIso ?? "")));

      const emittedEventIds = new Set<string>();
      let emitted = 0;
      for (const collected of mergedEvents) {
        const eventId = String(collected?.event?.eventId ?? "").trim();
        if (!eventId || emittedEventIds.has(eventId)) {
          continue;
        }
        emittedEventIds.add(eventId);

        const processedEvent = processOneCollectedEvent(collected);
        if (!processedEvent) {
          continue;
        }
        emitted += 1;
        onNewsEvent(processedEvent);
      }

      newsLogger.debug("osint refresh complete", {
        reason,
        providers: eligibleProviders.map((provider) => provider.name),
        totalEventsSeen: mergedEvents.length,
        emittedUpdates: emitted
      });
    } catch (error: any) {
      newsLogger.error("osint refresh failed", {
        reason,
        error: error?.message
      });
    } finally {
      refreshInFlight = false;
      if (refreshPending) {
        refreshPending = false;
        void refresh("pending");
      } else {
        schedulePolling();
      }
    }
  }

  function triggerRefresh(reason: string, delayMs = 0) {
    if (!running) {
      return;
    }

    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }

    if (delayMs <= 0) {
      void refresh(reason);
      return;
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh(reason);
    }, delayMs);
  }

  return {
    start() {
      if (!enabled) {
        newsLogger.info("live news collector disabled by config");
        return;
      }
      if (running) {
        return;
      }

      running = true;
      newsLogger.info("starting osint global collector", {
        providers: providers.map((provider) => provider.name),
        pollMs,
        fetchTimeoutMs,
        maxSignalsPerEvent,
        maxEventsPerProvider,
        englishOnly,
        includeWeatherEvents,
        includeSourceTypes,
        gdacsApiUrl,
        gdacsLookbackDays,
        usgsApiUrl,
        gdeltApiUrl,
        gdeltMaxRecords,
        nwsApiUrl,
        weatherCanadaApiUrl,
        meteoalarmApiUrl
      });
      triggerRefresh("startup");
    },
    stop() {
      if (!running) {
        return;
      }
      running = false;

      if (pollingTimer) {
        clearTimeout(pollingTimer);
        pollingTimer = undefined;
      }
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      newsLogger.info("stopped osint global collector");
    },
    refreshNow() {
      if (!running) {
        return;
      }
      triggerRefresh("manual");
    }
  };
}
