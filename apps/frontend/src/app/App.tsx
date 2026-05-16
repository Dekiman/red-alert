import { startTransition, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertMapPanel, type AlertMapControllerHandle } from "./alert-map-panel.js";
import type {
  AlertPayload,
  LiveNewsEventTypeCountPayload,
  LiveNewsFeedPayload,
  LiveNewsSeverityCountPayload,
  NewsEventPayload,
  PolygonReplayEventPayload
} from "./contracts.js";
import { sanitizeNewsEventLocationFields } from "./news-event-location.js";
import { categorizeNewsTitleType } from "./news-categorizer.js";
import { formatNewsTime, formatTime, hasHebrew } from "./text-utils.js";
import { getUiSocketPath } from "./ui-config.js";
import { useDashboardSocket } from "./use-dashboard-socket.js";
import { LiveClockValue } from "./live-clock-value.js";
import { TimelineReplayCard, type ReplayTimelineState } from "./timeline-replay-card.js";

const LIVE_NEWS_FEED_API_URL = "/api/live-news";
const REPLAY_NEWS_FEED_LIMIT = 20_000;
const LIVE_NEWS_BACKFILL_LIMIT = 20_000;
const LIVE_NEWS_BACKFILL_DAYS = 30;
const LIVE_NEWS_BACKFILL_REFRESH_MS = 5 * 60_000;
const GLOBE_NEWS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_NEWS_CLOCK_TICK_MS = 60_000;
const ALERT_PANEL_LIMIT = 150;
const NEWS_TYPE_ORDER = [
  "Incident Ongoing",
  "Public Advisory",
  "Weather Alert",
  "Casualties Update",
  "Investigation",
  "Recovery",
  "Political Update",
  "Incident Ended",
  "General Update"
];

const NEWS_SEVERITY_LABELS: Record<number, string> = {
  1: "Severity 1",
  2: "Severity 2",
  3: "Severity 3",
  4: "Severity 4",
  5: "Severity 5"
};

function getNewsEventType(newsEvent: NewsEventPayload) {
  return categorizeNewsTitleType(newsEvent);
}

function compareNewsTypes(left: string, right: string) {
  const leftIndex = NEWS_TYPE_ORDER.indexOf(left);
  const rightIndex = NEWS_TYPE_ORDER.indexOf(right);
  const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeftIndex !== normalizedRightIndex) {
    return normalizedLeftIndex - normalizedRightIndex;
  }
  return left.localeCompare(right);
}

function compareNewsSeverities(left: number, right: number) {
  return left - right;
}

function getNewsSeverityLabel(severity: number) {
  return NEWS_SEVERITY_LABELS[severity] ?? `Severity ${severity}`;
}

function getNewsSeverityValue(newsEvent: NewsEventPayload) {
  const severity = Number(newsEvent.severity);
  return Number.isFinite(severity) ? Math.floor(severity) : null;
}

function toOptionalFiniteNumber(value: unknown) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getNewsEventTimestampUnix(newsEvent: NewsEventPayload) {
  const timestampIso = String(newsEvent.updatedAtIso ?? newsEvent.createdAtIso ?? "").trim();
  if (!timestampIso) {
    return null;
  }

  const timestampMs = Date.parse(timestampIso);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return Math.floor(timestampMs / 1000);
}

function compareNewsEventsByRecency(left: NewsEventPayload, right: NewsEventPayload) {
  const leftTimestampUnix = getNewsEventTimestampUnix(left) ?? 0;
  const rightTimestampUnix = getNewsEventTimestampUnix(right) ?? 0;
  if (rightTimestampUnix !== leftTimestampUnix) {
    return rightTimestampUnix - leftTimestampUnix;
  }
  return String(right.eventId ?? "").localeCompare(String(left.eventId ?? ""));
}

function mergeNewsEventLists(...newsEventLists: NewsEventPayload[][]) {
  const mergedById = new Map<string, NewsEventPayload>();
  for (const newsEvents of newsEventLists) {
    for (const newsEvent of newsEvents) {
      const eventId = String(newsEvent?.eventId ?? "").trim();
      if (!eventId) {
        continue;
      }

      const existing = mergedById.get(eventId);
      if (!existing) {
        mergedById.set(eventId, newsEvent);
        continue;
      }

      const existingTimestampUnix = getNewsEventTimestampUnix(existing) ?? Number.NEGATIVE_INFINITY;
      const nextTimestampUnix = getNewsEventTimestampUnix(newsEvent) ?? Number.NEGATIVE_INFINITY;
      if (nextTimestampUnix >= existingTimestampUnix) {
        mergedById.set(eventId, newsEvent);
      }
    }
  }

  return Array.from(mergedById.values()).sort(compareNewsEventsByRecency);
}

function filterNewsEventsByMaxAge(newsEvents: NewsEventPayload[], referenceTimeMs: number, maxAgeMs: number) {
  return newsEvents.filter((newsEvent) => {
    const eventTimestampUnix = getNewsEventTimestampUnix(newsEvent);
    if (eventTimestampUnix == null) {
      return false;
    }

    const eventAgeMs = referenceTimeMs - eventTimestampUnix * 1000;
    return eventAgeMs <= maxAgeMs;
  });
}

const DEFAULT_REPLAY_TIMELINE_STATE: ReplayTimelineState = {
  active: false,
  rangeKey: "10m",
  rangeMinutes: 10,
  stateWindowMinutes: 15,
  rangeFromUnix: null,
  rangeToUnix: null,
  replayUnix: null
};

function buildLocalNewsTypeCounts(
  newsEvents: NewsEventPayload[],
  selectedNewsTypes: string[],
  selectedNewsSeverities: number[]
) {
  const types = new Set<string>();
  const counts = new Map<string, number>();
  for (const newsEvent of newsEvents) {
    const eventType = getNewsEventType(newsEvent);
    types.add(eventType);
    if (!matchesNewsSeverityFilter(newsEvent, selectedNewsSeverities)) {
      continue;
    }
    counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
  }
  for (const selectedType of selectedNewsTypes) {
    types.add(selectedType);
  }
  return Array.from(types)
    .sort(compareNewsTypes)
    .map((eventType) => ({
      eventType,
      count: counts.get(eventType) ?? 0
    }));
}

function buildLocalNewsSeverityCounts(
  newsEvents: NewsEventPayload[],
  selectedNewsTypes: string[],
  selectedNewsSeverities: number[]
) {
  const severities = new Set<number>();
  const counts = new Map<number, number>();
  for (const newsEvent of newsEvents) {
    const severity = getNewsSeverityValue(newsEvent);
    if (severity == null) {
      continue;
    }
    severities.add(severity);
    if (!matchesNewsTypeFilter(newsEvent, selectedNewsTypes)) {
      continue;
    }
    counts.set(severity, (counts.get(severity) ?? 0) + 1);
  }
  for (const selectedSeverity of selectedNewsSeverities) {
    severities.add(selectedSeverity);
  }
  return Array.from(severities)
    .sort(compareNewsSeverities)
    .map((severity) => ({
      severity,
      count: counts.get(severity) ?? 0
    }));
}

function toLiveNewsEventTypeCounts(input: unknown): LiveNewsEventTypeCountPayload[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const eventType = String((item as LiveNewsEventTypeCountPayload).eventType ?? "").trim();
      const count = Number((item as LiveNewsEventTypeCountPayload).count);
      if (!eventType || !Number.isFinite(count)) {
        return null;
      }
      return {
        eventType,
        count: Math.max(0, Math.floor(count))
      } satisfies LiveNewsEventTypeCountPayload;
    })
    .filter((item): item is LiveNewsEventTypeCountPayload => item != null)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return compareNewsTypes(left.eventType, right.eventType);
    });
}

function toLiveNewsSeverityCounts(input: unknown): LiveNewsSeverityCountPayload[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const severity = Number((item as LiveNewsSeverityCountPayload).severity);
      const count = Number((item as LiveNewsSeverityCountPayload).count);
      if (!Number.isFinite(severity) || !Number.isFinite(count)) {
        return null;
      }
      return {
        severity: Math.floor(severity),
        count: Math.max(0, Math.floor(count))
      } satisfies LiveNewsSeverityCountPayload;
    })
    .filter((item): item is LiveNewsSeverityCountPayload => item != null)
    .sort((left, right) => compareNewsSeverities(left.severity, right.severity));
}

function normalizeNewsEventPayload(input: unknown): NewsEventPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const event = input as Partial<NewsEventPayload>;
  const eventId = String(event.eventId ?? "").trim();
  if (!eventId) {
    return null;
  }

  return sanitizeNewsEventLocationFields({
    eventId,
    title: String(event.title ?? "Untitled news event"),
    summary: event.summary != null ? String(event.summary) : null,
    category: event.category != null ? String(event.category) : null,
    eventType: event.eventType != null ? String(event.eventType) : null,
    severity: Number.isFinite(Number(event.severity)) ? Number(event.severity) : null,
    signalCount: Number.isFinite(Number(event.signalCount)) ? Number(event.signalCount) : 0,
    sourceTypes: Array.isArray(event.sourceTypes)
      ? event.sourceTypes.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    sourceTypesRaw: event.sourceTypesRaw != null ? String(event.sourceTypesRaw) : "",
    locationName: event.locationName != null ? String(event.locationName) : null,
    country: event.country != null ? String(event.country) : null,
    region: event.region != null ? String(event.region) : null,
    lat: toOptionalFiniteNumber(event.lat),
    lng: toOptionalFiniteNumber(event.lng),
    createdAtIso: event.createdAtIso != null ? String(event.createdAtIso) : null,
    updatedAtIso: event.updatedAtIso != null ? String(event.updatedAtIso) : null,
    primarySignalUrl: event.primarySignalUrl != null ? String(event.primarySignalUrl) : null,
    primarySourceName: event.primarySourceName != null ? String(event.primarySourceName) : null
  });
}

function normalizeLiveNewsFeedPayload(input: unknown): LiveNewsFeedPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as LiveNewsFeedPayload;
  return {
    limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : undefined,
    matchingCount: Number.isFinite(Number(payload.matchingCount)) ? Number(payload.matchingCount) : undefined,
    selectedEventTypes: Array.isArray(payload.selectedEventTypes)
      ? payload.selectedEventTypes.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    selectedSeverities: Array.isArray(payload.selectedSeverities)
      ? payload.selectedSeverities
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item))
          .map((item) => Math.floor(item))
      : [],
    availableEventTypes: toLiveNewsEventTypeCounts(payload.availableEventTypes),
    availableSeverities: toLiveNewsSeverityCounts(payload.availableSeverities),
    events: Array.isArray(payload.events)
      ? payload.events
          .map((item) => normalizeNewsEventPayload(item))
          .filter((item): item is NewsEventPayload => item != null)
          .sort(compareNewsEventsByRecency)
      : []
  };
}

function matchesNewsTypeFilter(newsEvent: NewsEventPayload, selectedNewsTypes: string[]) {
  return selectedNewsTypes.length === 0 || selectedNewsTypes.includes(getNewsEventType(newsEvent));
}

function matchesNewsSeverityFilter(newsEvent: NewsEventPayload, selectedNewsSeverities: number[]) {
  if (selectedNewsSeverities.length === 0) {
    return true;
  }
  const severity = getNewsSeverityValue(newsEvent);
  return severity != null && selectedNewsSeverities.includes(severity);
}

interface StatusDotProps {
  mode: "live" | "down" | "connecting";
}

function StatusDot({ mode }: StatusDotProps) {
  const className = mode === "live" ? "dot live" : mode === "down" ? "dot down" : "dot";
  return <span className={className}></span>;
}

function AlertCard({ alert }: { alert: AlertPayload }) {
  const hasHebrewLocation = alert.locations.some((value) => hasHebrew(value));
  const locationClassName = hasHebrewLocation ? "locations rtl" : "locations";

  return (
    <article className="card alert-card">
      <div className="card-head">
        <strong>
          {alert.locationCount} location{alert.locationCount === 1 ? "" : "s"}
        </strong>
        <span className="card-time">{formatTime(alert.alertTimestampIso)}</span>
      </div>

      <div className="tags">
        <span className="tag">Source: {alert.source}</span>
        <span className="tag">Threat: {alert.threat}</span>
        <span className="tag">Drill: {alert.isDrill ? "Yes" : "No"}</span>
        <span className="tag">ID: {alert.notificationId}</span>
      </div>

      <ul className={locationClassName}>
        {alert.locations.map((locationText, index) => (
          <li
            key={`${alert.notificationId}-${locationText}-${index}`}
            dir={hasHebrew(locationText) ? "rtl" : "ltr"}
            lang={hasHebrew(locationText) ? "he" : "en"}
          >
            {locationText}
          </li>
        ))}
      </ul>
    </article>
  );
}

function NewsCard({ newsEvent }: { newsEvent: NewsEventPayload }) {
  const sourceTypes = Array.isArray(newsEvent.sourceTypes)
    ? newsEvent.sourceTypes.join(", ")
    : String(newsEvent.sourceTypesRaw || "");
  const titleType = categorizeNewsTitleType(newsEvent);
  const titleText = newsEvent.title || "Untitled news event";
  const titleDir = hasHebrew(titleText) ? "rtl" : "ltr";
  const titleLang = hasHebrew(titleText) ? "he" : "en";

  const summaryText =
    newsEvent.summary && newsEvent.summary !== newsEvent.title ? String(newsEvent.summary) : null;
  const locationParts = [newsEvent.locationName, newsEvent.region, newsEvent.country].filter(Boolean);
  const locationText = locationParts.length > 0 ? locationParts.join(" | ") : null;

  return (
    <article className="card news-card">
      <div className="card-head">
        <strong>{(newsEvent.category || "news").toUpperCase()}</strong>
        <span className="card-time">{formatNewsTime(newsEvent.updatedAtIso || newsEvent.createdAtIso)}</span>
      </div>

      {newsEvent.primarySignalUrl ? (
        <a
          className="news-title-link"
          href={newsEvent.primarySignalUrl}
          target="_blank"
          rel="noreferrer"
          dir={titleDir}
          lang={titleLang}
        >
          <span className="news-title">{titleText}</span>
        </a>
      ) : (
        <p className="news-title" dir={titleDir} lang={titleLang}>
          {titleText}
        </p>
      )}

      {summaryText ? (
        <p className="news-summary" dir={hasHebrew(summaryText) ? "rtl" : "ltr"} lang={hasHebrew(summaryText) ? "he" : "en"}>
          {summaryText}
        </p>
      ) : null}

      {locationText ? (
        <p className="news-location" dir={hasHebrew(locationText) ? "rtl" : "ltr"} lang={hasHebrew(locationText) ? "he" : "en"}>
          {locationText}
        </p>
      ) : null}

      <div className="tags">
        <span className="tag">Type: {titleType}</span>
        <span className="tag">Severity: {newsEvent.severity ?? "n/a"}</span>
        <span className="tag">Signals: {newsEvent.signalCount ?? 0}</span>
        <span className="tag">Sources: {sourceTypes || "unknown"}</span>
      </div>

      {newsEvent.primarySignalUrl ? (
        <a className="news-link" href={newsEvent.primarySignalUrl} target="_blank" rel="noreferrer">
          Open source ({newsEvent.primarySourceName || "news"})
        </a>
      ) : null}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      {label}: <span>{value}</span>
    </div>
  );
}

function toReplayAlertPayload(event: PolygonReplayEventPayload): AlertPayload | null {
  const notificationId = String(event.notificationId ?? "").trim();
  if (!notificationId) {
    return null;
  }

  const locations = Array.from(
    new Set(
      (Array.isArray(event.locationNames) ? event.locationNames : [])
        .map((location) => String(location ?? "").trim())
        .filter(Boolean)
    )
  );
  const alertTimestampUnix = Number(event.alertTimestampUnix);
  const alertTimestampIso =
    event.alertTimestampIso && String(event.alertTimestampIso).trim()
      ? String(event.alertTimestampIso)
      : Number.isFinite(alertTimestampUnix)
        ? new Date(alertTimestampUnix * 1000).toISOString()
        : undefined;

  return {
    source: String(event.source ?? "replay"),
    notificationId,
    threat: Number.isFinite(Number(event.threat)) ? Number(event.threat) : 8,
    isDrill: Boolean(event.isDrill),
    locations,
    locationCount: locations.length,
    locationIds: Array.isArray(event.localityIds)
      ? event.localityIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.floor(value))
      : [],
    alertTimestampIso
  };
}

export function App() {
  const mapControllerRef = useRef<AlertMapControllerHandle | null>(null);
  const previousReplayActiveRef = useRef(false);
  const newsFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const [mapController, setMapController] = useState<AlertMapControllerHandle | null>(null);
  const [isTimelineReplayActive, setIsTimelineReplayActive] = useState(false);
  const [replayTimelineState, setReplayTimelineState] = useState<ReplayTimelineState>(DEFAULT_REPLAY_TIMELINE_STATE);
  const [isWatchfloorCollapsed, setIsWatchfloorCollapsed] = useState(false);
  const [isNewsFeedCollapsed, setIsNewsFeedCollapsed] = useState(false);
  const [isAlertsPanelCollapsed, setIsAlertsPanelCollapsed] = useState(false);
  const [selectedNewsTypes, setSelectedNewsTypes] = useState<string[]>([]);
  const [selectedNewsSeverities, setSelectedNewsSeverities] = useState<number[]>([]);
  const [isNewsFilterOpen, setIsNewsFilterOpen] = useState(false);
  const [historicalNewsEvents, setHistoricalNewsEvents] = useState<NewsEventPayload[]>([]);
  const [liveNewsReferenceNowMs, setLiveNewsReferenceNowMs] = useState(() => Date.now());
  const [replayNewsEvents, setReplayNewsEvents] = useState<NewsEventPayload[]>([]);
  const [replayAlertEvents, setReplayAlertEvents] = useState<PolygonReplayEventPayload[]>([]);
  const socketPath = getUiSocketPath();
  const dashboard = useDashboardSocket(socketPath, mapControllerRef, {
    pauseMapUpdates: isTimelineReplayActive,
    mapController
  });
  const selectedNewsTypesKey = selectedNewsTypes.join("|");
  const selectedNewsSeveritiesKey = selectedNewsSeverities.join("|");
  const replayRangeFromUnix =
    isTimelineReplayActive && replayTimelineState.active && Number.isFinite(replayTimelineState.rangeFromUnix)
      ? Number(replayTimelineState.rangeFromUnix)
      : null;
  const replayRangeToUnix =
    isTimelineReplayActive && replayTimelineState.active && Number.isFinite(replayTimelineState.rangeToUnix)
      ? Number(replayTimelineState.rangeToUnix)
      : null;
  const replayCursorUnix =
    isTimelineReplayActive && replayTimelineState.active && Number.isFinite(replayTimelineState.replayUnix)
      ? Number(replayTimelineState.replayUnix)
      : null;
  const replayAlertWindowMinutes =
    isTimelineReplayActive && replayTimelineState.active && Number.isFinite(replayTimelineState.stateWindowMinutes)
      ? Math.max(1, Math.floor(Number(replayTimelineState.stateWindowMinutes)))
      : null;
  const isReplaySessionActive = isTimelineReplayActive && replayTimelineState.active;
  const isReplayFeedMode = isReplaySessionActive && replayRangeFromUnix != null && replayRangeToUnix != null;
  const liveNewsEvents = useMemo(
    () => mergeNewsEventLists(historicalNewsEvents, dashboard.newsEvents),
    [historicalNewsEvents, dashboard.newsEvents]
  );
  const liveWindowNewsEvents = useMemo(
    () => filterNewsEventsByMaxAge(liveNewsEvents, liveNewsReferenceNowMs, GLOBE_NEWS_MAX_AGE_MS),
    [liveNewsEvents, liveNewsReferenceNowMs]
  );
  const replayWindowNewsEvents = useMemo(
    () =>
      replayCursorUnix == null
        ? []
        : filterNewsEventsByMaxAge(
            replayNewsEvents.filter((newsEvent) => {
              const eventUnix = getNewsEventTimestampUnix(newsEvent);
              return eventUnix != null && eventUnix >= replayRangeFromUnix! && eventUnix <= replayCursorUnix;
            }),
            replayCursorUnix * 1000,
            GLOBE_NEWS_MAX_AGE_MS
          ),
    [replayCursorUnix, replayNewsEvents, replayRangeFromUnix]
  );
  const replayVisibleAlerts = useMemo(() => {
    if (replayCursorUnix == null || replayAlertEvents.length === 0 || replayAlertWindowMinutes == null) {
      return [];
    }

    const replayAlertWindowFromUnix = replayCursorUnix - replayAlertWindowMinutes * 60;
    const alerts: AlertPayload[] = [];
    for (let index = replayAlertEvents.length - 1; index >= 0; index -= 1) {
      if (alerts.length >= ALERT_PANEL_LIMIT) {
        break;
      }

      const replayEvent = replayAlertEvents[index];
      const eventUnix = Number(replayEvent?.alertTimestampUnix);
      if (!Number.isFinite(eventUnix)) {
        continue;
      }
      if (eventUnix > replayCursorUnix) {
        continue;
      }
      if (eventUnix < replayAlertWindowFromUnix) {
        break;
      }

      const replayAlert = toReplayAlertPayload(replayEvent);
      if (replayAlert) {
        alerts.push(replayAlert);
      }
    }

    return alerts;
  }, [replayAlertEvents, replayCursorUnix, replayAlertWindowMinutes]);
  const visibleAlerts = isReplaySessionActive ? replayVisibleAlerts : dashboard.alerts;
  // Keep the feed, filter counts, and globe markers on the same time window.
  const sourceNewsEventsForFilters = isReplaySessionActive
    ? isReplayFeedMode
      ? replayWindowNewsEvents
      : []
    : liveWindowNewsEvents;
  const matchingNewsEvents = useMemo(
    () =>
      sourceNewsEventsForFilters.filter(
        (newsEvent) =>
          matchesNewsTypeFilter(newsEvent, selectedNewsTypes) &&
          matchesNewsSeverityFilter(newsEvent, selectedNewsSeverities)
      ),
    [selectedNewsSeverities, selectedNewsTypes, sourceNewsEventsForFilters]
  );
  const filteredNewsEvents = matchingNewsEvents.slice(0, 100);
  const globeNewsEvents = filteredNewsEvents;
  const newsFilterOptions = useMemo(
    () => buildLocalNewsTypeCounts(sourceNewsEventsForFilters, selectedNewsTypes, selectedNewsSeverities),
    [selectedNewsSeverities, selectedNewsTypes, sourceNewsEventsForFilters]
  );
  const newsSeverityOptions = useMemo(
    () => buildLocalNewsSeverityCounts(sourceNewsEventsForFilters, selectedNewsTypes, selectedNewsSeverities),
    [selectedNewsSeverities, selectedNewsTypes, sourceNewsEventsForFilters]
  );
  const allNewsFilterTypes = newsFilterOptions.map((item) => item.eventType).sort(compareNewsTypes);
  const allNewsFilterSeverities = newsSeverityOptions.map((item) => item.severity).sort(compareNewsSeverities);
  const effectiveSelectedNewsTypes =
    selectedNewsTypes.length === 0 ? allNewsFilterTypes : selectedNewsTypes.filter((type) => allNewsFilterTypes.includes(type));
  const effectiveSelectedNewsSeverities =
    selectedNewsSeverities.length === 0
      ? allNewsFilterSeverities
      : selectedNewsSeverities.filter((severity) => allNewsFilterSeverities.includes(severity));
  const selectedNewsTypeSet = new Set(effectiveSelectedNewsTypes);
  const selectedNewsSeveritySet = new Set(effectiveSelectedNewsSeverities);
  const isShowingAllNewsTypes = selectedNewsTypes.length === 0;
  const isShowingAllNewsSeverities = selectedNewsSeverities.length === 0;
  const hasActiveNewsFilters = !isShowingAllNewsTypes || !isShowingAllNewsSeverities;
  const latestNewsEvent = filteredNewsEvents[0] ?? null;
  const effectiveMatchingNewsCount = matchingNewsEvents.length;
  const latestHeadline = latestNewsEvent?.title
    ? String(latestNewsEvent.title)
    : effectiveMatchingNewsCount === 0 && hasActiveNewsFilters
      ? "No incidents match the current filters."
      : isReplaySessionActive
        ? "No incidents have appeared yet at this replay point."
        : "Awaiting the next globally indexed incident signal.";
  const latestHeadlineLocation = [latestNewsEvent?.locationName, latestNewsEvent?.region, latestNewsEvent?.country]
    .filter(Boolean)
    .join(" | ");
  const latestHeadlineTime = latestNewsEvent
    ? formatNewsTime(latestNewsEvent.updatedAtIso || latestNewsEvent.createdAtIso)
    : replayCursorUnix != null
      ? formatNewsTime(new Date(replayCursorUnix * 1000).toISOString())
      : dashboard.updatedAt;
  const newsTypeSummary = isShowingAllNewsTypes
    ? "All types"
    : effectiveSelectedNewsTypes.length === 1
      ? effectiveSelectedNewsTypes[0]
      : `${effectiveSelectedNewsTypes.length} types`;
  const newsSeveritySummary = isShowingAllNewsSeverities
    ? "All severities"
    : effectiveSelectedNewsSeverities.length === 1
      ? getNewsSeverityLabel(effectiveSelectedNewsSeverities[0])
      : `${effectiveSelectedNewsSeverities.length} severities`;
  const newsFilterSummary = `${newsTypeSummary} | ${newsSeveritySummary}`;
  const hiddenNewsCount = Math.max(effectiveMatchingNewsCount - filteredNewsEvents.length, 0);
  const newsFeedEmptyText =
    effectiveMatchingNewsCount === 0
      ? hasActiveNewsFilters
        ? "No incidents match the current filters."
        : isReplaySessionActive
          ? "No incidents have appeared yet at this replay point."
          : "Waiting for live news..."
      : "No incidents match the current filters.";

  const toggleNewsType = (newsType: string) => {
    setSelectedNewsTypes((current) => {
      const baseSelection = current.length === 0 ? [...allNewsFilterTypes] : [...current];
      const nextSelection = baseSelection.includes(newsType)
        ? baseSelection.filter((item) => item !== newsType)
        : [...baseSelection, newsType].sort(compareNewsTypes);
      const normalizedSelection = nextSelection.filter((type, index, array) => array.indexOf(type) === index);

      if (normalizedSelection.length === 0 || normalizedSelection.length === allNewsFilterTypes.length) {
        return [];
      }
      return normalizedSelection;
    });
  };

  const toggleNewsSeverity = (severity: number) => {
    setSelectedNewsSeverities((current) => {
      const baseSelection = current.length === 0 ? [...allNewsFilterSeverities] : [...current];
      const nextSelection = baseSelection.includes(severity)
        ? baseSelection.filter((item) => item !== severity)
        : [...baseSelection, severity].sort(compareNewsSeverities);
      const normalizedSelection = nextSelection.filter((value, index, array) => array.indexOf(value) === index);

      if (normalizedSelection.length === 0 || normalizedSelection.length === allNewsFilterSeverities.length) {
        return [];
      }
      return normalizedSelection;
    });
  };

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLiveNewsReferenceNowMs(Date.now());
    }, LIVE_NEWS_CLOCK_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let activeController: AbortController | null = null;

    const loadHistoricalNewsBackfill = () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const nowMs = Date.now();
      const requestUrl = new URL(LIVE_NEWS_FEED_API_URL, window.location.origin);
      requestUrl.searchParams.set("limit", String(LIVE_NEWS_BACKFILL_LIMIT));
      requestUrl.searchParams.set(
        "fromUnix",
        String(Math.floor((nowMs - LIVE_NEWS_BACKFILL_DAYS * 24 * 60 * 60 * 1000) / 1000))
      );
      requestUrl.searchParams.set("toUnix", String(Math.floor(nowMs / 1000)));

      fetch(requestUrl, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`live news backfill HTTP ${response.status}`);
          }
          return normalizeLiveNewsFeedPayload(await response.json());
        })
        .then((payload) => {
          if (!payload) {
            throw new Error("live news backfill payload invalid");
          }
          if (!isDisposed) {
            setHistoricalNewsEvents(payload.events ?? []);
          }
        })
        .catch((error) => {
          if (controller.signal.aborted || isDisposed) {
            return;
          }
          console.warn("live news backfill request failed", error);
        });
    };

    loadHistoricalNewsBackfill();
    const intervalId = window.setInterval(loadHistoricalNewsBackfill, LIVE_NEWS_BACKFILL_REFRESH_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isNewsFilterOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const menuElement = newsFilterMenuRef.current;
      if (menuElement && event.target instanceof Node && !menuElement.contains(event.target)) {
        setIsNewsFilterOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsNewsFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isNewsFilterOpen]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isReplayFeedMode) {
      setReplayNewsEvents([]);
      return () => controller.abort();
    }

    const localFallbackSourceNewsEvents =
      replayRangeFromUnix != null && replayRangeToUnix != null
        ? liveNewsEvents.filter((newsEvent) => {
            const eventUnix = getNewsEventTimestampUnix(newsEvent);
            return eventUnix != null && eventUnix >= replayRangeFromUnix && eventUnix <= replayRangeToUnix;
          })
        : liveNewsEvents;
    const localFallbackFilteredNewsEvents = localFallbackSourceNewsEvents.filter(
      (newsEvent) =>
        matchesNewsTypeFilter(newsEvent, selectedNewsTypes) &&
        matchesNewsSeverityFilter(newsEvent, selectedNewsSeverities)
    );
    const requestUrl = new URL(LIVE_NEWS_FEED_API_URL, window.location.origin);
    requestUrl.searchParams.set("limit", String(REPLAY_NEWS_FEED_LIMIT));
    if (replayRangeFromUnix != null && replayRangeToUnix != null) {
      requestUrl.searchParams.set("fromUnix", String(replayRangeFromUnix));
      requestUrl.searchParams.set("toUnix", String(replayRangeToUnix));
    }
    if (selectedNewsTypes.length > 0) {
      requestUrl.searchParams.set("eventTypes", selectedNewsTypes.join(","));
    }
    if (selectedNewsSeverities.length > 0) {
      requestUrl.searchParams.set("severities", selectedNewsSeverities.join(","));
    }

    fetch(requestUrl, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`live news feed HTTP ${response.status}`);
        }
        return normalizeLiveNewsFeedPayload(await response.json());
      })
      .then((payload) => {
        if (!payload) {
          throw new Error("live news feed payload invalid");
        }
        setReplayNewsEvents(payload.events ?? []);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        console.warn("live news feed request failed", error);
        setReplayNewsEvents(localFallbackFilteredNewsEvents);
      });

    return () => controller.abort();
  }, [
    liveNewsEvents,
    selectedNewsTypesKey,
    selectedNewsSeveritiesKey,
    isReplayFeedMode,
    replayRangeFromUnix,
    replayRangeToUnix
  ]);

  useEffect(() => {
    if (!mapController) {
      return;
    }
    if (isTimelineReplayActive) {
      return;
    }
    for (let i = dashboard.alerts.length - 1; i >= 0; i -= 1) {
      mapController.activateFromAlert(dashboard.alerts[i]);
    }
  }, [mapController, isTimelineReplayActive, dashboard.alerts]);

  useEffect(() => {
    const wasReplayActive = previousReplayActiveRef.current;
    previousReplayActiveRef.current = isTimelineReplayActive;

    if (!mapController || !wasReplayActive || isTimelineReplayActive) {
      return;
    }

    mapController.clearReplayTime();
    mapController.resetState();
    for (let i = dashboard.alerts.length - 1; i >= 0; i -= 1) {
      mapController.activateFromAlert(dashboard.alerts[i]);
    }
  }, [isTimelineReplayActive, mapController, dashboard.alerts]);

  const handleControllerReady = useCallback((controller: AlertMapControllerHandle | null) => {
    mapControllerRef.current = controller;
    setMapController(controller);
  }, []);

  const handleReplayStateChanged = useCallback((nextState: ReplayTimelineState) => {
    startTransition(() => {
      setReplayTimelineState(nextState);
    });
  }, []);

  return (
    <main className={`app-shell${isNewsFeedCollapsed ? " news-feed-collapsed" : ""}`}>
      <AlertMapPanel onControllerReady={handleControllerReady} newsEvents={globeNewsEvents} />

      <div className="interface-overlay">
        <section
          className={`topbar topbar-floating${isWatchfloorCollapsed ? " collapsed" : ""}`}
          aria-label="Live dashboard header"
        >
          {isWatchfloorCollapsed ? (
            <div className="topbar-stripe">
              <p className="topbar-stripe-label">Realtime watchfloor</p>
              <div className="topbar-stripe-meta">
                <span className="topbar-stripe-time">
                  <span className="topbar-stripe-meta-label">Time</span>
                  <strong>
                    <LiveClockValue />
                  </strong>
                </span>
                <span className="topbar-stripe-status">
                  <StatusDot mode={dashboard.connectionState} />
                  <span>{dashboard.connectionText}</span>
                </span>
                <button
                  type="button"
                  className="panel-collapse-btn topbar-toggle-btn"
                  aria-expanded={!isWatchfloorCollapsed}
                  onClick={() => setIsWatchfloorCollapsed(false)}
                >
                  Expand
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="topbar-main">
                <div className="topbar-copy">
                  <p className="topbar-eyebrow">Realtime watchfloor</p>
                  <h1 className="title">Red Alert + Live News</h1>
                  <p className="subtitle">Realtime Israeli alert state and worldwide incident flow on a live 3D globe.</p>
                </div>

                <div className="topbar-side">
                  <div className="topbar-side-head">
                    <div className="status">
                      <StatusDot mode={dashboard.connectionState} />
                      <span>{dashboard.connectionText}</span>
                    </div>
                    <button
                      type="button"
                      className="panel-collapse-btn topbar-toggle-btn"
                      aria-expanded={!isWatchfloorCollapsed}
                      onClick={() => setIsWatchfloorCollapsed(true)}
                    >
                      Collapse
                    </button>
                  </div>
                  <div className="time-stack">
                    <Metric label="Time" value={<LiveClockValue />} />
                    <Metric label="Updated" value={dashboard.updatedAt} />
                  </div>
                </div>
              </div>

              <div className="metrics">
                <Metric label="Alerts Visible" value={visibleAlerts.length} />
                <Metric label="News Visible" value={filteredNewsEvents.length} />
                <Metric label="Buffered Alerts" value={dashboard.bufferedAlerts} />
                <Metric label="Buffered News" value={dashboard.bufferedNewsEvents} />
                <Metric label="UI Clients" value={dashboard.uiClients} />
              </div>

              <div className="headline-strip">
                <div className="headline-strip-head">
                  <p className="headline-label">Latest world signal</p>
                </div>
                <p
                  className="headline-title"
                  dir={hasHebrew(latestHeadline) ? "rtl" : "ltr"}
                  lang={hasHebrew(latestHeadline) ? "he" : "en"}
                >
                  {latestHeadline}
                </p>
                <div className="headline-meta">
                  <span>{latestHeadlineLocation || "Global OSINT stream active"}</span>
                  <span>{latestHeadlineTime}</span>
                </div>
              </div>
            </>
          )}
        </section>

        <aside
          className={`overlay-panel overlay-news-panel${isNewsFeedCollapsed ? " collapsed" : ""}`}
          aria-label="Live news feed"
        >
          <div className="overlay-panel-head">
            <div className="overlay-panel-heading">
              <p className="overlay-panel-kicker">Global stream</p>
              <h2 className="panel-title">Live News Feed</h2>
              <p className="overlay-panel-submeta">
                {!hasActiveNewsFilters
                  ? `${filteredNewsEvents.length} most recent shown`
                  : hiddenNewsCount > 0
                    ? `${filteredNewsEvents.length} shown of ${effectiveMatchingNewsCount} matching`
                    : `${filteredNewsEvents.length} matching shown`}
              </p>
            </div>
            <div className="overlay-panel-actions">
              <button
                type="button"
                className="panel-collapse-btn"
                aria-expanded={!isNewsFeedCollapsed}
                onClick={() => setIsNewsFeedCollapsed((current) => !current)}
              >
                {isNewsFeedCollapsed ? "Show" : "Hide"}
              </button>
              <div className={`news-filter-menu${isNewsFilterOpen ? " open" : ""}`} ref={newsFilterMenuRef}>
                <button
                  type="button"
                  className="news-filter-trigger"
                  aria-haspopup="menu"
                  aria-expanded={isNewsFilterOpen}
                  onClick={() => setIsNewsFilterOpen((current) => !current)}
                >
                  <span>Filters</span>
                  <strong>{newsFilterSummary}</strong>
                </button>
                {isNewsFilterOpen ? (
                  <div className="news-filter-popover" role="menu" aria-label="Live news filters">
                    <div className="news-filter-popover-head">
                      <p className="news-filter-title">Live news filters</p>
                      <button
                        type="button"
                        className="news-filter-reset"
                        onClick={() => {
                          setSelectedNewsTypes([]);
                          setSelectedNewsSeverities([]);
                        }}
                        disabled={isShowingAllNewsTypes && isShowingAllNewsSeverities}
                      >
                        Show all
                      </button>
                    </div>
                    <div className="news-filter-sections">
                      <section className="news-filter-section" aria-label="Event type filters">
                        <p className="news-filter-section-title">Event types</p>
                        <div className="news-filter-options">
                          {newsFilterOptions.length === 0 ? (
                            <p className="news-filter-empty">Type options appear as live news arrives.</p>
                          ) : (
                            newsFilterOptions.map((option) => {
                              const checked = selectedNewsTypeSet.has(option.eventType);
                              return (
                                <label key={option.eventType} className={`news-filter-option${checked ? " selected" : ""}`}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleNewsType(option.eventType)}
                                  />
                                  <span>{option.eventType}</span>
                                  <strong>{option.count}</strong>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </section>

                      <section className="news-filter-section" aria-label="Severity filters">
                        <p className="news-filter-section-title">Severity</p>
                        <div className="news-filter-options">
                          {newsSeverityOptions.length === 0 ? (
                            <p className="news-filter-empty">Severity options appear as live news arrives.</p>
                          ) : (
                            newsSeverityOptions.map((option) => {
                              const checked = selectedNewsSeveritySet.has(option.severity);
                              return (
                                <label key={option.severity} className={`news-filter-option${checked ? " selected" : ""}`}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleNewsSeverity(option.severity)}
                                  />
                                  <span>{getNewsSeverityLabel(option.severity)}</span>
                                  <strong>{option.count}</strong>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </section>
                    </div>
                  </div>
                ) : null}
              </div>
              <span className="overlay-panel-count">{filteredNewsEvents.length}</span>
            </div>
          </div>

          {!isNewsFeedCollapsed ? (
            <div id="newsFeed" className="feed overlay-feed">
              {filteredNewsEvents.length === 0 ? (
                <div className="empty">{newsFeedEmptyText}</div>
              ) : (
                filteredNewsEvents.map((newsEvent: NewsEventPayload) => (
                  <NewsCard key={newsEvent.eventId} newsEvent={newsEvent} />
                ))
              )}
            </div>
          ) : null}
        </aside>

        <section className="overlay-dock" aria-label="Replay and red alert overlays">
          <TimelineReplayCard
            mapController={mapController}
            onReplayModeChanged={setIsTimelineReplayActive}
            onReplayStateChanged={handleReplayStateChanged}
            onReplayTimelineEventsChanged={setReplayAlertEvents}
          />

          <aside
            className={`overlay-panel overlay-alerts-panel${isAlertsPanelCollapsed ? " collapsed" : ""}`}
            aria-label="Recent red alerts"
          >
            <div className="overlay-panel-head">
              <div>
                <p className="overlay-panel-kicker">Local sirens</p>
                <h2 className="panel-title">Recent Red Alerts</h2>
                {isReplaySessionActive && replayCursorUnix != null ? (
                  <p className="overlay-panel-submeta">
                    Last {replayAlertWindowMinutes ?? 15}m through{" "}
                    {formatTime(new Date(replayCursorUnix * 1000).toISOString())}
                  </p>
                ) : null}
              </div>
              <div className="overlay-panel-actions">
                <button
                  type="button"
                  className="panel-collapse-btn"
                  aria-expanded={!isAlertsPanelCollapsed}
                  onClick={() => setIsAlertsPanelCollapsed((current) => !current)}
                >
                  {isAlertsPanelCollapsed ? "Show" : "Hide"}
                </button>
                <span className="overlay-panel-count">{visibleAlerts.length}</span>
              </div>
            </div>

            {!isAlertsPanelCollapsed ? (
              <div id="alertsFeed" className="feed overlay-feed">
                {visibleAlerts.length === 0 ? (
                  <div className="empty">
                    {isReplaySessionActive ? "No alerts have appeared yet at this replay point." : "Waiting for red alerts..."}
                  </div>
                ) : (
                  visibleAlerts.map((alert) => (
                    <AlertCard
                      key={`${alert.notificationId}-${alert.alertTimestampIso || alert.receivedAtIso || "unknown"}`}
                      alert={alert}
                    />
                  ))
                )}
              </div>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
