export interface AlertPayload {
  source: string;
  notificationId: string;
  threat: number;
  isDrill: boolean;
  locations: string[];
  locationCount: number;
  locationIds?: number[];
  alertTimestampIso?: string;
  receivedAtIso?: string;
}

export interface InferredPolygonStatePayload {
  localityId: number;
  stage: "active_siren" | "post_siren_unsafe" | string;
  stageStartedAtUnix?: number;
  latestAlertTimestampUnix?: number;
}

export interface CurrentPolygonStatesPayload {
  generatedAtIso?: string;
  windowMinutes?: number;
  windowFromUnix?: number;
  windowToUnix?: number;
  alertsAnalyzed?: number;
  localitiesWithState?: number;
  states?: InferredPolygonStatePayload[];
}

export interface PolygonReplayEventPayload {
  notificationId: string;
  source?: string;
  threat?: number;
  isDrill?: boolean;
  alertTimestampUnix: number;
  alertTimestampIso?: string;
  localityIds: number[];
  locationNames?: string[];
}

export interface PolygonReplayTimelinePayload {
  generatedAtIso?: string;
  rangeMinutes?: number;
  stateWindowMinutes?: number;
  rangeFromUnix?: number;
  rangeToUnix?: number;
  alertsAnalyzed?: number;
  events?: PolygonReplayEventPayload[];
}

export interface NewsEventPayload {
  eventId: string;
  title: string;
  summary?: string | null;
  category?: string | null;
  eventType?: string | null;
  severity?: number | null;
  signalCount?: number;
  sourceTypes?: string[];
  sourceTypesRaw?: string;
  locationName?: string | null;
  country?: string | null;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  createdAtIso?: string | null;
  updatedAtIso?: string | null;
  primarySignalUrl?: string | null;
  primarySourceName?: string | null;
}

export interface LiveNewsEventTypeCountPayload {
  eventType: string;
  count: number;
}

export interface LiveNewsSeverityCountPayload {
  severity: number;
  count: number;
}

export interface LiveNewsFeedPayload {
  limit?: number;
  matchingCount?: number;
  selectedEventTypes?: string[];
  selectedSeverities?: number[];
  availableEventTypes?: LiveNewsEventTypeCountPayload[];
  availableSeverities?: LiveNewsSeverityCountPayload[];
  events?: NewsEventPayload[];
}

export interface SystemMessagePayload {
  kind?: string | null;
  instruction?: string | null;
  instructionType?: string | null;
  title?: string | null;
  body?: string | null;
  textParts?: string[];
  locationNames?: string[];
  locationIds?: number[];
}

export interface UiStatsPayload {
  type: "stats";
  connectedClients?: number;
  bufferedAlerts?: number;
  bufferedNewsEvents?: number;
}

export interface UiSnapshotPayload {
  type: "snapshot";
  alerts?: AlertPayload[];
  newsEvents?: NewsEventPayload[];
}

export interface UiAlertEventPayload {
  type: "alert";
  alert?: AlertPayload;
}

export interface UiNewsEventPayload {
  type: "news_event";
  newsEvent?: NewsEventPayload;
}

export interface UiSystemMessageEventPayload {
  type: "system_message";
  systemMessage?: SystemMessagePayload;
}

export type UiSocketPayload =
  | UiStatsPayload
  | UiSnapshotPayload
  | UiAlertEventPayload
  | UiNewsEventPayload
  | UiSystemMessageEventPayload;
