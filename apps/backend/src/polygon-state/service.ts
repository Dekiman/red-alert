import {
  DEFAULT_POLYGON_STATE_ALERT_LIMIT,
  DEFAULT_POLYGON_REPLAY_RANGE_MINUTES,
  DEFAULT_POLYGON_STATE_WINDOW_MINUTES,
  MAX_POLYGON_REPLAY_RANGE_MINUTES,
  MAX_POLYGON_STATE_ALERT_LIMIT,
  MAX_POLYGON_STATE_WINDOW_MINUTES,
  MIN_POLYGON_REPLAY_RANGE_MINUTES,
  MIN_POLYGON_STATE_ALERT_LIMIT,
  MIN_POLYGON_STATE_WINDOW_MINUTES
} from "./constants.js";
import { inferCurrentPolygonStates } from "./inference.js";
import type {
  CurrentPolygonStatesPayload,
  PolygonReplayTimelinePayload,
  PolygonStateInferenceQuery
} from "./types.js";

interface PolygonStateServiceOptions {
  getDatabase: () => {
    getAlertsForPolygonStateInference: (
      fromUnix: number,
      toUnix: number,
      alertLimit: number
    ) => Array<{
      notificationId: string;
      source: string;
      threat: number;
      isDrill: boolean;
      alertTimestampUnix: number;
      alertTimestampIso: string;
      receivedAtIso: string;
      locationNames: string[];
    }>;
  } | null;
  getLocalityMapIdsForLocations: (locations: string[]) => number[];
  logger?: {
    debug?: (message: string, context?: Record<string, unknown>) => void;
  };
}

function clampWindowMinutes(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_POLYGON_STATE_WINDOW_MINUTES;
  }
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, MIN_POLYGON_STATE_WINDOW_MINUTES), MAX_POLYGON_STATE_WINDOW_MINUTES);
}

function clampAlertLimit(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_POLYGON_STATE_ALERT_LIMIT;
  }
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, MIN_POLYGON_STATE_ALERT_LIMIT), MAX_POLYGON_STATE_ALERT_LIMIT);
}

function clampReplayRangeMinutes(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_POLYGON_REPLAY_RANGE_MINUTES;
  }
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, MIN_POLYGON_REPLAY_RANGE_MINUTES), MAX_POLYGON_REPLAY_RANGE_MINUTES);
}

function uniqueSortedNumbers(values: unknown[]) {
  const normalized = new Set<number>();
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      normalized.add(numeric);
    }
  }
  return Array.from(normalized).sort((a, b) => a - b);
}

export function createPolygonStateService(options: PolygonStateServiceOptions) {
  const { getDatabase, getLocalityMapIdsForLocations, logger } = options;

  async function getCurrentPolygonStates(query: PolygonStateInferenceQuery = {}): Promise<CurrentPolygonStatesPayload | null> {
    const database = getDatabase();
    if (!database) {
      return null;
    }

    const windowMinutes = clampWindowMinutes(query.windowMinutes);
    const alertLimit = clampAlertLimit(query.alertLimit);
    const nowMs = Number.isFinite(Number(query.nowMs)) ? Number(query.nowMs) : Date.now();
    const windowSeconds = windowMinutes * 60;
    const windowToUnix = Math.floor(nowMs / 1000);
    const windowFromUnix = Math.max(0, windowToUnix - windowSeconds);

    const alerts = await database.getAlertsForPolygonStateInference(windowFromUnix, windowToUnix, alertLimit);
    const payload = inferCurrentPolygonStates({
      alerts,
      nowMs,
      windowMinutes,
      windowFromUnix,
      windowToUnix,
      getLocalityMapIdsForLocations
    });

    logger?.debug?.("inferred current polygon states", {
      windowMinutes,
      alertLimit,
      alertsAnalyzed: payload.alertsAnalyzed,
      localitiesWithState: payload.localitiesWithState
    });

    return payload;
  }

  async function getPolygonReplayTimeline(query: {
    rangeMinutes?: number;
    stateWindowMinutes?: number;
    alertLimit?: number;
    nowMs?: number;
  } = {}): Promise<PolygonReplayTimelinePayload | null> {
    const database = getDatabase();
    if (!database) {
      return null;
    }

    const rangeMinutes = clampReplayRangeMinutes(query.rangeMinutes);
    const stateWindowMinutes = clampWindowMinutes(query.stateWindowMinutes);
    const nowMs = Number.isFinite(Number(query.nowMs)) ? Number(query.nowMs) : Date.now();
    const rangeToUnix = Math.floor(nowMs / 1000);
    const rangeFromUnix = Math.max(0, rangeToUnix - rangeMinutes * 60);
    const adaptiveDefaultLimit = Math.max(
      MIN_POLYGON_STATE_ALERT_LIMIT,
      Math.min(MAX_POLYGON_STATE_ALERT_LIMIT, Math.ceil(rangeMinutes * 30))
    );
    const alertLimit = clampAlertLimit(
      Number.isFinite(Number(query.alertLimit)) ? query.alertLimit : adaptiveDefaultLimit
    );

    const alerts = await database.getAlertsForPolygonStateInference(rangeFromUnix, rangeToUnix, alertLimit);
    const events = alerts
      .map((alert) => {
        const localityIds = uniqueSortedNumbers(getLocalityMapIdsForLocations(alert.locationNames));
        return {
          notificationId: alert.notificationId,
          source: alert.source,
          threat: alert.threat,
          isDrill: alert.isDrill,
          alertTimestampUnix: alert.alertTimestampUnix,
          alertTimestampIso: alert.alertTimestampIso,
          localityIds,
          locationNames: Array.from(new Set(alert.locationNames.map((name) => String(name).trim()).filter(Boolean)))
        };
      })
      .filter((event) => event.localityIds.length > 0)
      .sort((a, b) => {
        if (a.alertTimestampUnix !== b.alertTimestampUnix) {
          return a.alertTimestampUnix - b.alertTimestampUnix;
        }
        return a.notificationId.localeCompare(b.notificationId);
      });

    logger?.debug?.("built polygon replay timeline", {
      rangeMinutes,
      stateWindowMinutes,
      alertLimit,
      alertsAnalyzed: alerts.length,
      eventsReturned: events.length
    });

    return {
      generatedAtIso: new Date(nowMs).toISOString(),
      rangeMinutes,
      stateWindowMinutes,
      rangeFromUnix,
      rangeToUnix,
      alertsAnalyzed: alerts.length,
      events
    };
  }

  return {
    getCurrentPolygonStates,
    getPolygonReplayTimeline
  };
}
