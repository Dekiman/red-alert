import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type {
  AlertPayload,
  CurrentPolygonStatesPayload,
  InferredPolygonStatePayload,
  NewsEventPayload,
  SystemMessagePayload,
  UiSocketPayload
} from "./contracts.js";
import type { AlertMapControllerHandle } from "./alert-map-panel.js";
import { sanitizeNewsEventLocationFields } from "./news-event-location.js";

const MAX_VISIBLE_ALERTS = 150;
const MAX_VISIBLE_NEWS = 150;
const MAX_BUFFERED_SYSTEM_MESSAGES = 32;
const SOCKET_RECONNECT_MS = 1500;
const INITIAL_POLYGON_STATES_API_URL = "/api/polygon-states/current?windowMinutes=15";

export type ConnectionState = "live" | "down" | "connecting";

interface DashboardSocketState {
  connectionState: ConnectionState;
  connectionText: string;
  updatedAt: string;
  alerts: AlertPayload[];
  newsEvents: NewsEventPayload[];
  uiClients: number;
  bufferedAlerts: number;
  bufferedNewsEvents: number;
}

interface DashboardSocketOptions {
  pauseMapUpdates?: boolean;
  mapController?: AlertMapControllerHandle | null;
}

function resolveSocketUrl(socketPath: string) {
  if (socketPath.startsWith("ws://") || socketPath.startsWith("wss://")) {
    return socketPath;
  }

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const normalizedSocketPath = socketPath.startsWith("/") ? socketPath : `/${socketPath}`;
  return `${wsProtocol}//${window.location.host}${normalizedSocketPath}`;
}

function nextUpdatedAtValue() {
  return new Date().toLocaleTimeString();
}

function toUiPayload(input: unknown): UiSocketPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const payload = input as UiSocketPayload;
  if (!("type" in payload) || typeof payload.type !== "string") {
    return null;
  }
  return payload;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
      .map((item) => Math.floor(item));
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

function toAlertPayload(input: unknown): AlertPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const alert = input as Partial<AlertPayload>;
  const notificationId = String(alert.notificationId ?? "").trim();
  if (!notificationId) {
    return null;
  }

  const locations = toStringArray(alert.locations);
  const threatRaw = Number(alert.threat);
  const threat = Number.isFinite(threatRaw) ? threatRaw : 8;
  const locationCountRaw = Number(alert.locationCount);
  const locationCount = Number.isFinite(locationCountRaw) ? locationCountRaw : locations.length;
  return {
    source: String(alert.source ?? "unknown"),
    notificationId,
    threat,
    isDrill: Boolean(alert.isDrill),
    locations,
    locationCount,
    locationIds: toNumberArray(alert.locationIds),
    alertTimestampIso: alert.alertTimestampIso ? String(alert.alertTimestampIso) : undefined,
    receivedAtIso: alert.receivedAtIso ? String(alert.receivedAtIso) : undefined
  };
}

function toNewsEventPayload(input: unknown): NewsEventPayload | null {
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
    sourceTypes: toStringArray(event.sourceTypes),
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

function toSystemMessagePayload(input: unknown): SystemMessagePayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const message = input as Partial<SystemMessagePayload>;
  return {
    kind: message.kind != null ? String(message.kind) : null,
    instruction: message.instruction != null ? String(message.instruction) : null,
    instructionType: message.instructionType != null ? String(message.instructionType) : null,
    title: message.title != null ? String(message.title) : null,
    body: message.body != null ? String(message.body) : null,
    textParts: toStringArray(message.textParts),
    locationNames: toStringArray(message.locationNames),
    locationIds: toNumberArray(message.locationIds)
  };
}

function limitAlerts(list: AlertPayload[]) {
  return list.slice(0, MAX_VISIBLE_ALERTS);
}

function limitNews(list: NewsEventPayload[]) {
  return list.slice(0, MAX_VISIBLE_NEWS);
}

function toInferredPolygonStates(input: unknown): InferredPolygonStatePayload[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const payload = input as CurrentPolygonStatesPayload;
  if (!Array.isArray(payload.states)) {
    return [];
  }

  return payload.states.filter((stateItem) => stateItem && typeof stateItem === "object");
}

export function useDashboardSocket(
  socketPath: string,
  mapControllerRef: MutableRefObject<AlertMapControllerHandle | null>,
  options: DashboardSocketOptions = {}
): DashboardSocketState {
  const { pauseMapUpdates = false, mapController = null } = options;
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [connectionText, setConnectionText] = useState("Connecting...");
  const [updatedAt, setUpdatedAt] = useState("-");
  const [alerts, setAlerts] = useState<AlertPayload[]>([]);
  const [newsEvents, setNewsEvents] = useState<NewsEventPayload[]>([]);
  const [uiClients, setUiClients] = useState(0);
  const [bufferedAlerts, setBufferedAlerts] = useState(0);
  const [bufferedNewsEvents, setBufferedNewsEvents] = useState(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const hasReceivedSnapshotRef = useRef(false);
  const hasHydratedPolygonStatesRef = useRef(false);
  const inferredPolygonStatesRef = useRef<InferredPolygonStatePayload[] | null>(null);
  const pauseMapUpdatesRef = useRef(Boolean(pauseMapUpdates));
  const currentMapControllerRef = useRef<AlertMapControllerHandle | null>(mapController ?? mapControllerRef.current);
  const queuedSystemMessagesRef = useRef<SystemMessagePayload[]>([]);

  useEffect(() => {
    pauseMapUpdatesRef.current = Boolean(pauseMapUpdates);
  }, [pauseMapUpdates]);

  useEffect(() => {
    currentMapControllerRef.current = mapController ?? mapControllerRef.current;
  }, [mapController, mapControllerRef]);

  useEffect(() => {
    const currentMapController = currentMapControllerRef.current ?? mapControllerRef.current;
    if (
      !currentMapController ||
      pauseMapUpdatesRef.current ||
      queuedSystemMessagesRef.current.length === 0 ||
      !hasReceivedSnapshotRef.current
    ) {
      return;
    }

    const queuedMessages = queuedSystemMessagesRef.current.splice(0, queuedSystemMessagesRef.current.length);
    for (const systemMessage of queuedMessages) {
      currentMapController.handleSystemMessage(systemMessage);
    }
  }, [mapController, pauseMapUpdates, mapControllerRef]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let isDisposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const markUpdated = () => {
      setUpdatedAt(nextUpdatedAtValue());
    };

    const queueSystemMessage = (systemMessage: SystemMessagePayload) => {
      queuedSystemMessagesRef.current.push(systemMessage);
      if (queuedSystemMessagesRef.current.length > MAX_BUFFERED_SYSTEM_MESSAGES) {
        queuedSystemMessagesRef.current.splice(
          0,
          queuedSystemMessagesRef.current.length - MAX_BUFFERED_SYSTEM_MESSAGES
        );
      }
    };

    const flushQueuedSystemMessages = (mapController: AlertMapControllerHandle | null) => {
      if (!mapController || pauseMapUpdatesRef.current || queuedSystemMessagesRef.current.length === 0) {
        return;
      }

      const queuedMessages = queuedSystemMessagesRef.current.splice(0, queuedSystemMessagesRef.current.length);
      for (const systemMessage of queuedMessages) {
        mapController.handleSystemMessage(systemMessage);
      }
    };

    const hydrateInitialPolygonStates = async (mapController: AlertMapControllerHandle | null) => {
      if (!mapController || hasHydratedPolygonStatesRef.current) {
        return;
      }
      hasHydratedPolygonStatesRef.current = true;

      try {
        const response = await fetch(INITIAL_POLYGON_STATES_API_URL, {
          cache: "no-store"
        });
        if (!response.ok) {
          return;
        }

        const parsed = await response.json();
        const inferredStates = toInferredPolygonStates(parsed);
        inferredPolygonStatesRef.current = inferredStates;
        if (inferredStates.length > 0 && !pauseMapUpdatesRef.current) {
          mapController.applyInferredStates(inferredStates);
        }
      } catch {
        // Ignore polygon state hydration failures; live stream updates still apply.
      }
    };

    const connect = () => {
      if (isDisposed) {
        return;
      }

      hasReceivedSnapshotRef.current = false;
      setConnectionState("connecting");
      setConnectionText("Connecting...");

      const socketUrl = resolveSocketUrl(socketPath);
      socket = new WebSocket(socketUrl);

      socket.addEventListener("open", () => {
        setConnectionState("live");
        setConnectionText("Connected");
        markUpdated();
        const currentMapController = currentMapControllerRef.current ?? mapControllerRef.current;
        void hydrateInitialPolygonStates(currentMapController);
      });

      socket.addEventListener("close", () => {
        if (isDisposed) {
          return;
        }
        setConnectionState("down");
        setConnectionText("Disconnected, retrying...");
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(connect, SOCKET_RECONNECT_MS);
      });

      socket.addEventListener("error", () => {
        setConnectionState("down");
        setConnectionText("Socket error");
      });

      socket.addEventListener("message", (event) => {
        markUpdated();

        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }

        const payload = toUiPayload(parsed);
        if (!payload) {
          return;
        }

        if (payload.type === "snapshot") {
          hasReceivedSnapshotRef.current = true;
          const alertList = limitAlerts(
            (Array.isArray(payload.alerts) ? payload.alerts : [])
              .map((alertItem) => toAlertPayload(alertItem))
              .filter((alertItem): alertItem is AlertPayload => alertItem != null)
          );
          const newsList = limitNews(
            (Array.isArray(payload.newsEvents) ? payload.newsEvents : [])
              .map((newsItem) => toNewsEventPayload(newsItem))
              .filter((newsItem): newsItem is NewsEventPayload => newsItem != null)
          );
          setAlerts(alertList);
          setNewsEvents(newsList);

          const mapController = currentMapControllerRef.current ?? mapControllerRef.current;
          if (mapController && !pauseMapUpdatesRef.current) {
            mapController.resetState();
            for (let i = alertList.length - 1; i >= 0; i -= 1) {
              mapController.activateFromAlert(alertList[i]);
            }

            if (Array.isArray(inferredPolygonStatesRef.current) && inferredPolygonStatesRef.current.length > 0) {
              mapController.applyInferredStates(inferredPolygonStatesRef.current);
            } else {
              void hydrateInitialPolygonStates(mapController);
            }
            flushQueuedSystemMessages(mapController);
          }
          return;
        }

        if (payload.type === "alert" && payload.alert) {
          const normalizedAlert = toAlertPayload(payload.alert);
          if (!normalizedAlert) {
            return;
          }

          setAlerts((current) => limitAlerts([normalizedAlert, ...current]));
          if (!pauseMapUpdatesRef.current) {
            mapControllerRef.current?.activateFromAlert(normalizedAlert);
          }
          return;
        }

        if (payload.type === "news_event" && payload.newsEvent) {
          const normalizedNewsEvent = toNewsEventPayload(payload.newsEvent);
          if (!normalizedNewsEvent) {
            return;
          }

          setNewsEvents((current) => {
            const deduped = current.filter((eventItem) => eventItem.eventId !== normalizedNewsEvent.eventId);
            return limitNews([normalizedNewsEvent, ...deduped]);
          });
          return;
        }

        if (payload.type === "system_message") {
          const normalizedSystemMessage = toSystemMessagePayload(payload.systemMessage);
          if (!normalizedSystemMessage) {
            return;
          }

          const mapController = currentMapControllerRef.current ?? mapControllerRef.current;
          if (!mapController || pauseMapUpdatesRef.current) {
            queueSystemMessage(normalizedSystemMessage);
            return;
          }
          mapController.handleSystemMessage(normalizedSystemMessage);
          return;
        }

        if (payload.type === "stats") {
          setUiClients(payload.connectedClients ?? 0);
          setBufferedAlerts(payload.bufferedAlerts ?? 0);
          setBufferedNewsEvents(payload.bufferedNewsEvents ?? 0);
        }
      });
    };

    connect();

    return () => {
      isDisposed = true;
      clearReconnectTimer();
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
      socket = null;
    };
  }, [socketPath, mapControllerRef]);

  return {
    connectionState,
    connectionText,
    updatedAt,
    alerts,
    newsEvents,
    uiClients,
    bufferedAlerts,
    bufferedNewsEvents
  };
}
