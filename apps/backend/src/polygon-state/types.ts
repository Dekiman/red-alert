export type PolygonStateStage = "active_siren" | "post_siren_unsafe";

export interface PolygonStateAlertHistoryEntry {
  notificationId: string;
  source: string;
  threat: number;
  isDrill: boolean;
  alertTimestampUnix: number;
  alertTimestampIso: string;
  receivedAtIso: string;
  locationNames: string[];
}

export interface PolygonStateInferenceQuery {
  windowMinutes?: number;
  alertLimit?: number;
  nowMs?: number;
}

export interface InferredPolygonState {
  localityId: number;
  stage: PolygonStateStage;
  stageStartedAtUnix: number;
  stageStartedAtIso: string;
  latestNotificationId: string;
  latestSource: string;
  latestThreat: number;
  latestIsDrill: boolean;
  latestAlertTimestampUnix: number;
  latestAlertTimestampIso: string;
  ageSeconds: number;
  locationNames: string[];
}

export interface CurrentPolygonStatesPayload {
  generatedAtIso: string;
  windowMinutes: number;
  windowFromUnix: number;
  windowToUnix: number;
  alertsAnalyzed: number;
  localitiesWithState: number;
  states: InferredPolygonState[];
}

export interface PolygonReplayEvent {
  notificationId: string;
  source: string;
  threat: number;
  isDrill: boolean;
  alertTimestampUnix: number;
  alertTimestampIso: string;
  localityIds: number[];
  locationNames: string[];
}

export interface PolygonReplayTimelinePayload {
  generatedAtIso: string;
  rangeMinutes: number;
  stateWindowMinutes: number;
  rangeFromUnix: number;
  rangeToUnix: number;
  alertsAnalyzed: number;
  events: PolygonReplayEvent[];
}
