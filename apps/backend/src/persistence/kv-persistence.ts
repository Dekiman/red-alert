import { createLogger } from "../logger.js";
import { categorizeNewsEventType, compareNewsEventTypes, isWeatherNewsEvent } from "../news/event-type.js";
import { isEnglishNewsCandidate } from "../news/language-filter.js";
import type { Alert, NewsEvent } from "../../../../packages/shared/src/schemas.js";
import type { Persistence, AlertRepository, NewsRepository, NewsFeedOptions, NewsFeed } from "./index.js";

const logger = createLogger("persistence:kv");

export interface KVPersistenceOptions {
  kv: KVNamespace;
  includeWeatherNews?: boolean;
  englishOnlyNews?: boolean;
  maxAlerts?: number;
  maxNewsEvents?: number;
}

export function createKVPersistence(options: KVPersistenceOptions): Persistence {
  const { kv } = options;
  const includeWeatherNews = !!options.includeWeatherNews;
  const englishOnlyNews = options.englishOnlyNews !== false;
  const maxAlerts = options.maxAlerts ?? 5000;
  const maxNewsEvents = options.maxNewsEvents ?? 1000;

  const alertsRepo: AlertRepository = {
    async save(normalizedAlert, rawPayload) {
      const alerts = await this.getRecent(maxAlerts);
      
      if (alerts.some((a: any) => a.notificationId === normalizedAlert.notificationId)) {
        return { inserted: false, id: null };
      }

      const entry = { ...normalizedAlert, rawPayload, id: Date.now() };
      alerts.unshift(entry as any);
      await kv.put("alerts", JSON.stringify(alerts.slice(0, maxAlerts)));

      return { inserted: true, id: entry.id };
    },

    async getRecent(limit = 100) {
      const data = await kv.get("alerts", "json");
      const alerts = Array.isArray(data) ? data : [];
      return alerts.slice(0, limit) as Alert[];
    },

    async getForInference(fromUnix, toUnix, limit = 1200) {
      const alerts = await this.getRecent(maxAlerts);
      return alerts
        .filter((a: any) => a.alertTimestampUnix >= fromUnix && a.alertTimestampUnix <= toUnix)
        .slice(0, limit)
        .map((a: any) => ({
          notificationId: a.notificationId,
          source: a.source,
          threat: Number(a.threat),
          isDrill: Boolean(a.isDrill),
          alertTimestampUnix: Number(a.alertTimestampUnix),
          alertTimestampIso: a.alertTimestampIso,
          receivedAtIso: a.receivedAtIso,
          locationNames: a.locations || []
        })) as any;
    }
  };

  const newsRepo: NewsRepository = {
    async getEvent(eventId) {
      const events = await this._getAllRaw();
      return events.find((e: any) => e.eventId === eventId) || null;
    },

    async saveEvent(normalizedEvent, rawPayload) {
      console.log(`[KVPersistence] Saving news event: ${normalizedEvent.eventId}`);
      const events = await this._getAllRaw();
      const index = events.findIndex((e: any) => e.eventId === normalizedEvent.eventId);
      const existing = events[index] as any;
      const entry = {
        ...normalizedEvent,
        rawPayload,
        signals: existing?.signals ?? [],
        // Preserve URL fields if the incoming event has them; fall back to existing
        primarySignalUrl: (normalizedEvent as any).primarySignalUrl ?? existing?.primarySignalUrl ?? null,
        primarySourceName: (normalizedEvent as any).primarySourceName ?? existing?.primarySourceName ?? null,
      };

      if (index >= 0) {
        events[index] = { ...existing, ...entry };
      } else {
        events.unshift(entry as any);
      }
      
      const slice = events.slice(0, maxNewsEvents);
      await kv.put("news_events", JSON.stringify(slice));
      console.log(`[KVPersistence] Successfully saved news_events to KV. Total count: ${slice.length}`);

      return { changed: true };
    },

    async saveSignals(eventId, normalizedSignals, rawSignals) {
      if (normalizedSignals.length === 0) return { inserted: 0 };

      const events = await this._getAllRaw();
      const event = events.find((e: any) => e.eventId === eventId) as any;
      if (!event) return { inserted: 0 };

      let inserted = 0;
      for (let i = 0; i < normalizedSignals.length; i++) {
        const signal = normalizedSignals[i];
        if (!event.signals.some((s: any) => s.signalId === signal.signalId)) {
          event.signals.push({ ...signal, rawPayload: rawSignals[i] || signal });
          inserted++;
        }
      }
      if (inserted > 0) {
        await kv.put("news_events", JSON.stringify(events.slice(0, maxNewsEvents)));
      }
      return { inserted };
    },

    async getFeed(options: NewsFeedOptions = {}): Promise<NewsFeed> {
      const events = await this._getAllRaw();
      const fromUnix = options.fromUnix ?? null;
      const toUnix = options.toUnix ?? null;
      const requestedLimit = options.limit ?? 100;

      const filtered = events.filter(e => this._passesFilter(e));
      
      let matchingEvents: NewsEvent[] = [];
      const availableEventTypeCounts = new Map<string, number>();
      const availableSeverityCounts = new Map<number, number>();
      let matchingCount = 0;

      const selectedEventTypes = new Set(options.eventTypes ?? []);
      const selectedSeverities = new Set(options.severities ?? []);

      for (const event of filtered) {
        const ts = this._getTimestampUnix(event);
        if (fromUnix !== null && (ts === null || ts < fromUnix)) continue;
        if (toUnix !== null && (ts === null || ts > toUnix)) continue;

        const eventType = (event as any).eventType;
        const severity = (event as any).severity;

        availableEventTypeCounts.set(eventType, (availableEventTypeCounts.get(eventType) ?? 0) + 1);
        if (severity != null) {
          availableSeverityCounts.set(severity, (availableSeverityCounts.get(severity) ?? 0) + 1);
        }

        if (selectedEventTypes.size > 0 && !selectedEventTypes.has(eventType)) continue;
        if (selectedSeverities.size > 0 && (severity == null || !selectedSeverities.has(severity))) continue;

        matchingCount++;
        if (matchingEvents.length < requestedLimit) {
          // Derive primarySignalUrl/primarySourceName from stored signals if not already on the event
          const enriched = event as any;
          if (!enriched.primarySignalUrl) {
            const firstSignal = enriched.signals?.[0];
            if (firstSignal?.url) enriched.primarySignalUrl = firstSignal.url;
            if (firstSignal?.sourceName && !enriched.primarySourceName) enriched.primarySourceName = firstSignal.sourceName;
          }
          matchingEvents.push(enriched);
        }
      }

      return {
        limit: requestedLimit,
        matchingCount,
        selectedEventTypes: Array.from(selectedEventTypes),
        selectedSeverities: Array.from(selectedSeverities),
        availableEventTypes: this._formatCounts(availableEventTypeCounts, compareNewsEventTypes),
        availableSeverities: this._formatCounts(availableSeverityCounts, (a, b) => a - b),
        events: matchingEvents
      };
    },

    async getProviderBackoff(providerName) {
      const allBackoffs = await kv.get("news_provider_backoffs", "json") as Record<string, any> | null;
      return allBackoffs?.[providerName] || null;
    },

    async setProviderBackoff(providerName, state) {
      const allBackoffs = (await kv.get("news_provider_backoffs", "json") as Record<string, any> | null) || {};
      allBackoffs[providerName] = state;
      await kv.put("news_provider_backoffs", JSON.stringify(allBackoffs));
    },

    async _getAllRaw(): Promise<NewsEvent[]> {
      const data = await kv.get("news_events", "json");
      return Array.isArray(data) ? data : [];
    },

    _passesFilter(event: any): boolean {
      if (!includeWeatherNews && isWeatherNewsEvent(event)) return false;
      if (englishOnlyNews && !isEnglishNewsCandidate({
        title: event.title,
        summary: event.summary,
        sourceLanguage: event.sourceLanguage
      })) return false;
      return true;
    },

    _getTimestampUnix(event: any): number | null {
      const iso = event.updatedAtIso || event.createdAtIso || event.fetchedAtIso || "";
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    },

    _formatCounts(map: Map<any, number>, sortFn: (a: any, b: any) => number) {
      return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || sortFn(a[0], b[0]))
        .map(([key, count]) => ({ [typeof key === 'string' ? 'eventType' : 'severity']: key, count } as any));
    }
  };

  return {
    alerts: alertsRepo,
    news: newsRepo,
    async close() {
      logger.info("closing kv persistence");
    }
  };
}
