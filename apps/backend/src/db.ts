import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "./logger.js";
import { categorizeNewsEventType, compareNewsEventTypes, isWeatherNewsEvent } from "./news/event-type.js";
import { isEnglishNewsCandidate, resolveNewsSourceLanguage } from "./news/language-filter.js";
import type { PolygonStateAlertHistoryEntry } from "./polygon-state/types.js";

const DEFAULT_DB_PATH =
  process.env.RED_ALERT_DB_PATH ?? path.join(process.cwd(), "data", "red_alerts.sqlite");
const dbLogger = createLogger("db");

export function initDatabase(
  options: string | { dbPath?: string; includeWeatherNews?: boolean; englishOnlyNews?: boolean } = {}
) {
  const resolvedOptions =
    typeof options === "string" ? { dbPath: options, includeWeatherNews: false, englishOnlyNews: true } : options;
  const dbPath = resolvedOptions?.dbPath ?? DEFAULT_DB_PATH;
  const includeWeatherNews = Boolean(resolvedOptions?.includeWeatherNews);
  const englishOnlyNews = resolvedOptions?.englishOnlyNews !== false;
  const resolvedPath = path.resolve(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  dbLogger.info("initializing database", {
    path: resolvedPath,
    includeWeatherNews,
    englishOnlyNews
  });

  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      threat INTEGER NOT NULL,
      is_drill INTEGER NOT NULL CHECK (is_drill IN (0, 1)),
      alert_timestamp_unix INTEGER NOT NULL,
      alert_timestamp_iso TEXT NOT NULL,
      alert_date_utc TEXT NOT NULL,
      alert_time_utc TEXT NOT NULL,
      alert_date_israel TEXT NOT NULL,
      alert_time_israel TEXT NOT NULL,
      received_at_iso TEXT NOT NULL,
      has_source_time INTEGER NOT NULL CHECK (has_source_time IN (0, 1)),
      location_count INTEGER NOT NULL,
      raw_payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      location_index INTEGER NOT NULL,
      location_name TEXT NOT NULL,
      UNIQUE(alert_id, location_index)
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp_unix ON alerts(alert_timestamp_unix);
    CREATE INDEX IF NOT EXISTS idx_alerts_date_israel ON alerts(alert_date_israel);
    CREATE INDEX IF NOT EXISTS idx_alert_locations_name ON alert_locations(location_name);

    CREATE TABLE IF NOT EXISTS live_news_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_event_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT,
      category TEXT,
      severity INTEGER,
      source_types TEXT NOT NULL,
      signal_count INTEGER NOT NULL,
      is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      location_name TEXT,
      country TEXT,
      region TEXT,
      lat REAL,
      lng REAL,
      created_at_iso TEXT,
      updated_at_iso TEXT,
      fetched_at_iso TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_news_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_signal_id TEXT NOT NULL UNIQUE,
      event_external_id TEXT NOT NULL,
      source_type TEXT,
      source_name TEXT,
      source_reliability INTEGER,
      title TEXT,
      content TEXT,
      url TEXT,
      timestamp_iso TEXT,
      created_at_iso TEXT,
      account_handle TEXT,
      tweet_id TEXT,
      media_urls_json TEXT NOT NULL,
      fetched_at_iso TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      FOREIGN KEY (event_external_id) REFERENCES live_news_events(external_event_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_live_news_events_updated_at ON live_news_events(updated_at_iso DESC);
    CREATE INDEX IF NOT EXISTS idx_live_news_events_source_types ON live_news_events(source_types);
    CREATE INDEX IF NOT EXISTS idx_live_news_signals_event ON live_news_signals(event_external_id);
    CREATE INDEX IF NOT EXISTS idx_live_news_signals_timestamp ON live_news_signals(timestamp_iso DESC);
  `);
  dbLogger.info("database schema ready");

  const insertAlertStatement = db.prepare(`
    INSERT OR IGNORE INTO alerts (
      notification_id,
      source,
      threat,
      is_drill,
      alert_timestamp_unix,
      alert_timestamp_iso,
      alert_date_utc,
      alert_time_utc,
      alert_date_israel,
      alert_time_israel,
      received_at_iso,
      has_source_time,
      location_count,
      raw_payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getAlertIdStatement = db.prepare(`
    SELECT id FROM alerts
    WHERE notification_id = ?
  `);

  const insertLocationStatement = db.prepare(`
    INSERT OR IGNORE INTO alert_locations (
      alert_id,
      location_index,
      location_name
    )
    VALUES (?, ?, ?)
  `);

  const upsertLiveNewsEventStatement = db.prepare(`
    INSERT INTO live_news_events (
      external_event_id,
      title,
      summary,
      category,
      severity,
      source_types,
      signal_count,
      is_active,
      location_name,
      country,
      region,
      lat,
      lng,
      created_at_iso,
      updated_at_iso,
      fetched_at_iso,
      raw_payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_event_id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      category = excluded.category,
      severity = excluded.severity,
      source_types = excluded.source_types,
      signal_count = excluded.signal_count,
      is_active = excluded.is_active,
      location_name = excluded.location_name,
      country = excluded.country,
      region = excluded.region,
      lat = excluded.lat,
      lng = excluded.lng,
      created_at_iso = excluded.created_at_iso,
      updated_at_iso = excluded.updated_at_iso,
      fetched_at_iso = excluded.fetched_at_iso,
      raw_payload_json = excluded.raw_payload_json
    WHERE
      COALESCE(excluded.updated_at_iso, '') > COALESCE(live_news_events.updated_at_iso, '')
      OR COALESCE(excluded.signal_count, -1) != COALESCE(live_news_events.signal_count, -1)
      OR COALESCE(excluded.is_active, -1) != COALESCE(live_news_events.is_active, -1)
  `);

  const insertLiveNewsSignalStatement = db.prepare(`
    INSERT OR IGNORE INTO live_news_signals (
      external_signal_id,
      event_external_id,
      source_type,
      source_name,
      source_reliability,
      title,
      content,
      url,
      timestamp_iso,
      created_at_iso,
      account_handle,
      tweet_id,
      media_urls_json,
      fetched_at_iso,
      raw_payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectLiveNewsEventsPageStatement = db.prepare(`
    SELECT
      id,
      external_event_id,
      title,
      summary,
      category,
      severity,
      source_types,
      signal_count,
      is_active,
      location_name,
      country,
      region,
      lat,
      lng,
      created_at_iso,
      updated_at_iso,
      fetched_at_iso,
      raw_payload_json,
      (
        SELECT signals.url
        FROM live_news_signals AS signals
        WHERE signals.event_external_id = live_news_events.external_event_id
          AND COALESCE(signals.url, '') != ''
        ORDER BY COALESCE(signals.timestamp_iso, signals.created_at_iso, signals.fetched_at_iso) DESC, signals.id DESC
        LIMIT 1
      ) AS primary_signal_url,
      (
        SELECT signals.source_name
        FROM live_news_signals AS signals
        WHERE signals.event_external_id = live_news_events.external_event_id
          AND COALESCE(signals.url, '') != ''
        ORDER BY COALESCE(signals.timestamp_iso, signals.created_at_iso, signals.fetched_at_iso) DESC, signals.id DESC
        LIMIT 1
      ) AS primary_source_name
    FROM live_news_events
    ORDER BY COALESCE(updated_at_iso, fetched_at_iso) DESC, id DESC
    LIMIT ? OFFSET ?
  `);

  const selectAlertsForPolygonStateInferenceStatement = db.prepare(`
    WITH recent_alerts AS (
      SELECT
        id,
        notification_id,
        source,
        threat,
        is_drill,
        alert_timestamp_unix,
        alert_timestamp_iso,
        received_at_iso
      FROM alerts
      WHERE alert_timestamp_unix >= ? AND alert_timestamp_unix <= ?
      ORDER BY alert_timestamp_unix DESC, id DESC
      LIMIT ?
    )
    SELECT
      recent_alerts.id AS alert_id,
      recent_alerts.notification_id,
      recent_alerts.source,
      recent_alerts.threat,
      recent_alerts.is_drill,
      recent_alerts.alert_timestamp_unix,
      recent_alerts.alert_timestamp_iso,
      recent_alerts.received_at_iso,
      alert_locations.location_index,
      alert_locations.location_name
    FROM recent_alerts
    LEFT JOIN alert_locations ON alert_locations.alert_id = recent_alerts.id
    ORDER BY
      recent_alerts.alert_timestamp_unix DESC,
      recent_alerts.id DESC,
      alert_locations.location_index ASC
  `);

  function saveAlert(normalizedAlert, rawPayload) {
    db.exec("BEGIN");
    try {
      const insertResult = insertAlertStatement.run(
        normalizedAlert.notificationId,
        normalizedAlert.source,
        normalizedAlert.threat,
        Number(normalizedAlert.isDrill),
        normalizedAlert.alertTimestampUnix,
        normalizedAlert.alertTimestampIso,
        normalizedAlert.alertDateUtc,
        normalizedAlert.alertTimeUtc,
        normalizedAlert.alertDateIsrael,
        normalizedAlert.alertTimeIsrael,
        normalizedAlert.receivedAtIso,
        Number(normalizedAlert.hasSourceTime),
        normalizedAlert.locationCount,
        JSON.stringify(rawPayload)
      );

      const alertIdRow = getAlertIdStatement.get(normalizedAlert.notificationId);
      const alertId = alertIdRow?.id ?? null;

      if (alertId) {
        normalizedAlert.locations.forEach((locationName, index) => {
          insertLocationStatement.run(alertId, index, locationName);
        });
      }

      db.exec("COMMIT");
      if (insertResult.changes > 0) {
        dbLogger.debug("saved alert", {
          notificationId: normalizedAlert.notificationId,
          source: normalizedAlert.source,
          locations: normalizedAlert.locationCount
        });
      } else {
        dbLogger.debug("alert already exists, skipped insert", {
          notificationId: normalizedAlert.notificationId
        });
      }
      return { inserted: insertResult.changes > 0, alertId };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        dbLogger.warn("rollback failed after save error");
      }
      dbLogger.error("save alert failed", {
        notificationId: normalizedAlert?.notificationId,
        error: error?.message
      });
      throw error;
    }
  }

  function saveLiveNewsEvent(normalizedEvent, rawPayload) {
    const result = upsertLiveNewsEventStatement.run(
      normalizedEvent.eventId,
      normalizedEvent.title,
      normalizedEvent.summary,
      normalizedEvent.category,
      normalizedEvent.severity,
      normalizedEvent.sourceTypesRaw,
      normalizedEvent.signalCount,
      Number(normalizedEvent.isActive),
      normalizedEvent.locationName,
      normalizedEvent.country,
      normalizedEvent.region,
      normalizedEvent.lat,
      normalizedEvent.lng,
      normalizedEvent.createdAtIso,
      normalizedEvent.updatedAtIso,
      normalizedEvent.fetchedAtIso,
      JSON.stringify(rawPayload)
    );

    if (result.changes > 0) {
      dbLogger.debug("saved live news event", {
        eventId: normalizedEvent.eventId,
        title: normalizedEvent.title
      });
    }
    return { changed: result.changes > 0 };
  }

  function saveLiveNewsSignals(eventId, normalizedSignals, rawSignals = []) {
    if (!Array.isArray(normalizedSignals) || normalizedSignals.length === 0) {
      return { inserted: 0 };
    }

    let inserted = 0;
    db.exec("BEGIN");
    try {
      normalizedSignals.forEach((signal, index) => {
        const rawPayload = rawSignals[index] ?? signal;
        const result = insertLiveNewsSignalStatement.run(
          signal.signalId,
          eventId,
          signal.sourceType,
          signal.sourceName,
          signal.sourceReliability,
          signal.title,
          signal.content,
          signal.url,
          signal.timestampIso,
          signal.createdAtIso,
          signal.accountHandle,
          signal.tweetId,
          JSON.stringify(signal.mediaUrls ?? []),
          signal.fetchedAtIso,
          JSON.stringify(rawPayload)
        );
        inserted += Number(result.changes);
      });

      db.exec("COMMIT");
      if (inserted > 0) {
        dbLogger.debug("saved live news signals", {
          eventId,
          inserted
        });
      }
      return { inserted };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        dbLogger.warn("rollback failed after live news signal save error");
      }
      dbLogger.error("save live news signals failed", {
        eventId,
        error: error?.message
      });
      throw error;
    }
  }

  function mapLiveNewsEventRow(row) {
    return {
      eventId: row.external_event_id,
      title: row.title,
      summary: row.summary,
      category: row.category,
      eventType: categorizeNewsEventType(row),
      severity: row.severity,
      sourceTypesRaw: row.source_types,
      sourceTypes: String(row.source_types ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
      signalCount: row.signal_count,
      isActive: Boolean(row.is_active),
      locationName: row.location_name,
      country: row.country,
      region: row.region,
      lat: row.lat,
      lng: row.lng,
      createdAtIso: row.created_at_iso,
      updatedAtIso: row.updated_at_iso,
      fetchedAtIso: row.fetched_at_iso,
      sourceLanguage: resolveNewsSourceLanguage(row.raw_payload_json),
      primarySignalUrl: row.primary_signal_url,
      primarySourceName: row.primary_source_name,
      signals: []
    };
  }

  function getLiveNewsEventTimestampUnix(candidate) {
    const timestampIso = String(
      candidate?.updated_at_iso ??
        candidate?.updatedAtIso ??
        candidate?.created_at_iso ??
        candidate?.createdAtIso ??
        candidate?.fetched_at_iso ??
        candidate?.fetchedAtIso ??
        ""
    ).trim();
    if (!timestampIso) {
      return null;
    }

    const timestampMs = Date.parse(timestampIso);
    if (!Number.isFinite(timestampMs)) {
      return null;
    }

    return Math.floor(timestampMs / 1000);
  }

  function eventPassesLiveNewsVisibilityFilter(newsEvent) {
    if (!includeWeatherNews && isWeatherNewsEvent(newsEvent)) {
      return false;
    }

    if (
      englishOnlyNews &&
      !isEnglishNewsCandidate({
        title: newsEvent?.title,
        summary: newsEvent?.summary,
        sourceLanguage: newsEvent?.sourceLanguage
      })
    ) {
      return false;
    }

    return true;
  }

  function getRecentLiveNewsEvents(limit = 50) {
    const requestedLimit = Number(limit);
    const boundedLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : 50;
    const recentEvents = [];
    let offset = 0;
    const batchSize = Math.max(200, boundedLimit);

    while (recentEvents.length < boundedLimit) {
      const rows = selectLiveNewsEventsPageStatement.all(batchSize, offset);
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }

      offset += rows.length;
      for (const row of rows) {
        const mapped = mapLiveNewsEventRow(row);
        if (!eventPassesLiveNewsVisibilityFilter(mapped)) {
          continue;
        }

        recentEvents.push(mapped);
        if (recentEvents.length >= boundedLimit) {
          break;
        }
      }
    }

    return recentEvents;
  }

  function getLiveNewsFeed(
    options: { limit?: number; fromUnix?: number; toUnix?: number; eventTypes?: string[]; severities?: number[] } = {}
  ) {
    const requestedLimit = Number(options?.limit);
    const fromUnix = Number.isFinite(Number(options?.fromUnix)) ? Math.floor(Number(options?.fromUnix)) : null;
    const toUnix = Number.isFinite(Number(options?.toUnix)) ? Math.floor(Number(options?.toUnix)) : null;
    const maxLimit = fromUnix != null || toUnix != null ? 20_000 : 300;
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), maxLimit)
      : 100;
    const selectedEventTypes = Array.isArray(options?.eventTypes)
      ? options.eventTypes.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const selectedSeverities = Array.isArray(options?.severities)
      ? options.severities
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.floor(value))
      : [];
    const selectedEventTypeSet = new Set(selectedEventTypes);
    const selectedSeveritySet = new Set(selectedSeverities);
    const matchingEvents = [];
    const availableEventTypeCounts = new Map<string, number>();
    const availableSeverityCounts = new Map<number, number>();
    let matchingCount = 0;
    let offset = 0;
    const batchSize = 400;

    while (true) {
      const rows = selectLiveNewsEventsPageStatement.all(batchSize, offset);
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }

      offset += rows.length;
      for (const row of rows) {
        const timestampUnix = getLiveNewsEventTimestampUnix(row);
        if (fromUnix != null && (timestampUnix == null || timestampUnix < fromUnix)) {
          continue;
        }
        if (toUnix != null && (timestampUnix == null || timestampUnix > toUnix)) {
          continue;
        }

        const mapped = mapLiveNewsEventRow(row);
        if (!eventPassesLiveNewsVisibilityFilter(mapped)) {
          continue;
        }
        const eventType = mapped.eventType;
        const severity =
          Number.isFinite(Number(mapped.severity)) && mapped.severity != null ? Math.floor(Number(mapped.severity)) : null;
        availableEventTypeCounts.set(eventType, (availableEventTypeCounts.get(eventType) ?? 0) + 1);
        if (severity != null) {
          availableSeverityCounts.set(severity, (availableSeverityCounts.get(severity) ?? 0) + 1);
        }

        if (selectedEventTypeSet.size > 0 && !selectedEventTypeSet.has(eventType)) {
          continue;
        }
        if (selectedSeveritySet.size > 0 && (severity == null || !selectedSeveritySet.has(severity))) {
          continue;
        }

        matchingCount += 1;

        if (matchingEvents.length < limit) {
          matchingEvents.push(mapped);
        }
      }
    }

    const availableEventTypes = Array.from(availableEventTypeCounts.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return compareNewsEventTypes(left[0], right[0]);
      })
      .map(([eventType, count]) => ({
        eventType,
        count
      }));
    const availableSeverities = Array.from(availableSeverityCounts.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([severity, count]) => ({
        severity,
        count
      }));

    return {
      limit,
      matchingCount,
      selectedEventTypes,
      selectedSeverities,
      availableEventTypes,
      availableSeverities,
      events: matchingEvents
    };
  }

  function getAlertsForPolygonStateInference(fromUnix: number, toUnix: number, alertLimit = 1200) {
    const rows = selectAlertsForPolygonStateInferenceStatement.all(
      fromUnix,
      toUnix,
      alertLimit
    ) as Array<{
      alert_id: number;
      notification_id: string;
      source: string;
      threat: number;
      is_drill: number;
      alert_timestamp_unix: number;
      alert_timestamp_iso: string;
      received_at_iso: string;
      location_index: number | null;
      location_name: string | null;
    }>;

    const byAlertId = new Map<number, PolygonStateAlertHistoryEntry>();
    for (const row of rows) {
      let entry = byAlertId.get(row.alert_id);
      if (!entry) {
        entry = {
          notificationId: row.notification_id,
          source: row.source,
          threat: Number(row.threat),
          isDrill: Boolean(row.is_drill),
          alertTimestampUnix: Number(row.alert_timestamp_unix),
          alertTimestampIso: row.alert_timestamp_iso,
          receivedAtIso: row.received_at_iso,
          locationNames: []
        };
        byAlertId.set(row.alert_id, entry);
      }

      const locationName = String(row.location_name ?? "").trim();
      if (locationName.length > 0) {
        entry.locationNames.push(locationName);
      }
    }

    return Array.from(byAlertId.values());
  }

  return {
    path: resolvedPath,
    saveAlert,
    saveLiveNewsEvent,
    saveLiveNewsSignals,
    getRecentLiveNewsEvents,
    getLiveNewsFeed,
    getAlertsForPolygonStateInference,
    close() {
      dbLogger.info("closing database", { path: resolvedPath });
      db.close();
    }
  };
}
