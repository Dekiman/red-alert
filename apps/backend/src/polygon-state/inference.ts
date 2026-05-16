import { ACTIVE_SIREN_DURATION_MS, UNSAFE_AUTO_CLEAR_DURATION_MS } from "./constants.js";
import type {
  CurrentPolygonStatesPayload,
  InferredPolygonState,
  PolygonStateAlertHistoryEntry
} from "./types.js";

interface InferCurrentPolygonStatesInput {
  alerts: PolygonStateAlertHistoryEntry[];
  nowMs: number;
  windowMinutes: number;
  windowFromUnix: number;
  windowToUnix: number;
  getLocalityMapIdsForLocations: (locations: string[]) => number[];
}

interface LocalityLatestAlert {
  localityId: number;
  alert: PolygonStateAlertHistoryEntry;
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

function toIsoFromUnixSeconds(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toISOString();
}

function shouldReplaceLocalityAlert(
  existing: PolygonStateAlertHistoryEntry | undefined,
  candidate: PolygonStateAlertHistoryEntry
) {
  if (!existing) {
    return true;
  }

  if (candidate.alertTimestampUnix !== existing.alertTimestampUnix) {
    return candidate.alertTimestampUnix > existing.alertTimestampUnix;
  }

  if (candidate.receivedAtIso !== existing.receivedAtIso) {
    return candidate.receivedAtIso > existing.receivedAtIso;
  }

  return candidate.notificationId > existing.notificationId;
}

function createInferredPolygonState(localityId: number, alert: PolygonStateAlertHistoryEntry, nowMs: number) {
  const alertMs = alert.alertTimestampUnix * 1000;
  const ageMs = Math.max(0, nowMs - alertMs);
  if (ageMs > UNSAFE_AUTO_CLEAR_DURATION_MS) {
    return null;
  }

  const ageSeconds = Math.floor(ageMs / 1000);
  const isActiveSiren = ageMs <= ACTIVE_SIREN_DURATION_MS;
  const stage = isActiveSiren ? "active_siren" : "post_siren_unsafe";
  const stageStartedAtUnix = isActiveSiren
    ? alert.alertTimestampUnix
    : alert.alertTimestampUnix + Math.floor(ACTIVE_SIREN_DURATION_MS / 1000);

  const normalizedLocations = Array.from(
    new Set(
      (alert.locationNames ?? [])
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );

  const state: InferredPolygonState = {
    localityId,
    stage,
    stageStartedAtUnix,
    stageStartedAtIso: toIsoFromUnixSeconds(stageStartedAtUnix),
    latestNotificationId: alert.notificationId,
    latestSource: alert.source,
    latestThreat: alert.threat,
    latestIsDrill: alert.isDrill,
    latestAlertTimestampUnix: alert.alertTimestampUnix,
    latestAlertTimestampIso: alert.alertTimestampIso,
    ageSeconds,
    locationNames: normalizedLocations
  };
  return state;
}

export function inferCurrentPolygonStates(input: InferCurrentPolygonStatesInput): CurrentPolygonStatesPayload {
  const {
    alerts,
    nowMs,
    windowMinutes,
    windowFromUnix,
    windowToUnix,
    getLocalityMapIdsForLocations
  } = input;
  const latestByLocalityId = new Map<number, LocalityLatestAlert>();

  for (const alert of alerts) {
    if (!Array.isArray(alert?.locationNames) || alert.locationNames.length === 0) {
      continue;
    }

    const localityIds = uniqueSortedNumbers(getLocalityMapIdsForLocations(alert.locationNames));
    if (localityIds.length === 0) {
      continue;
    }

    for (const localityId of localityIds) {
      const existing = latestByLocalityId.get(localityId)?.alert;
      if (!shouldReplaceLocalityAlert(existing, alert)) {
        continue;
      }
      latestByLocalityId.set(localityId, {
        localityId,
        alert
      });
    }
  }

  const states = Array.from(latestByLocalityId.values())
    .map((entry) => createInferredPolygonState(entry.localityId, entry.alert, nowMs))
    .filter((state): state is InferredPolygonState => state != null)
    .sort((a, b) => {
      if (b.latestAlertTimestampUnix !== a.latestAlertTimestampUnix) {
        return b.latestAlertTimestampUnix - a.latestAlertTimestampUnix;
      }
      return a.localityId - b.localityId;
    });

  return {
    generatedAtIso: new Date(nowMs).toISOString(),
    windowMinutes,
    windowFromUnix,
    windowToUnix,
    alertsAnalyzed: alerts.length,
    localitiesWithState: states.length,
    states
  };
}
