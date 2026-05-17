import { createLogger } from "./logger.js";
import { createKVPersistence } from "./persistence/kv-persistence.js";
import type { Persistence } from "./persistence/index.js";

const dbLogger = createLogger("db");

export function initDatabase(
  options: { kv: KVNamespace; includeWeatherNews?: boolean; englishOnlyNews?: boolean }
) {
  const persistence = createKVPersistence({
    kv: options.kv,
    includeWeatherNews: options.includeWeatherNews,
    englishOnlyNews: options.englishOnlyNews
  });

  dbLogger.info("initializing persistence layer", {
    path: "kv:ALERTS_KV",
    includeWeatherNews: options.includeWeatherNews,
    englishOnlyNews: options.englishOnlyNews
  });

  return {
    path: "kv:ALERTS_KV",
    
    // Legacy mapping for backward compatibility
    saveAlert: (normalizedAlert: any, rawPayload: any) => persistence.alerts.save(normalizedAlert, rawPayload),
    saveLiveNewsEvent: (normalizedEvent: any, rawPayload: any) => persistence.news.saveEvent(normalizedEvent, rawPayload),
    saveLiveNewsSignals: (eventId: string, normalizedSignals: any[], rawSignals: any[] = []) => 
      persistence.news.saveSignals(eventId, normalizedSignals, rawSignals),
    getRecentLiveNewsEvents: (limit = 50) => persistence.news.getFeed({ limit }).then(f => f.events),
    getLiveNewsFeed: (options: any) => persistence.news.getFeed(options),
    getAlertsForPolygonStateInference: (fromUnix: number, toUnix: number, alertLimit = 1200) => 
      persistence.alerts.getForInference(fromUnix, toUnix, alertLimit),
    
    // New deep interface
    alerts: persistence.alerts,
    news: persistence.news,
    
    close() {
      dbLogger.info("closing database", { path: "kv:ALERTS_KV" });
      return persistence.close();
    }
  };
}