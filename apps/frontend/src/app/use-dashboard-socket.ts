import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type {
  AlertPayload,
  CurrentPolygonStatesPayload,
  InferredPolygonStatePayload,
  NewsEventPayload,
  SystemMessagePayload,
  UiSocketPayload
} from "./contracts.js";
import { sanitizeNewsEventLocationFields } from "./news-event-location.js";
import { dashboardStore } from "../stores/useDashboardStore.js";

const MAX_BUFFERED_SYSTEM_MESSAGES = 32;
const SOCKET_RECONNECT_MS = 1500;
const INITIAL_POLYGON_STATES_API_URL = "/api/polygon-states/current?windowMinutes=15";

export type ConnectionState = "live" | "down" | "connecting";

interface DashboardSocketOptions {
  pauseMapUpdates?: boolean;
}

function resolveSocketUrl(socketPath: string) {
  const backendTarget = import.meta.env.VITE_BACKEND_TARGET;

  if (socketPath.startsWith("ws://") || socketPath.startsWith("wss://")) {
    return socketPath;
  }

  // If VITE_BACKEND_TARGET is a full URL, use it as the base for WebSocket
  if (backendTarget && backendTarget.startsWith("http")) {
    const wsUrl = backendTarget.replace(/^http/, "ws");
    const normalizedSocketPath = socketPath.startsWith("/") ? socketPath : `/${socketPath}`;
    return `${wsUrl}${normalizedSocketPath}`;
  }

  // In production (Vercel), we MUST connect directly to Cloudflare for WebSockets
  // because Vercel rewrites do not support WebSocket protocol upgrades.
  if (import.meta.env.PROD) {
    const productionBackend = "wss://red-alert-backend.red-alert.workers.dev";
    const normalizedSocketPath = socketPath.startsWith("/") ? socketPath : `/${socketPath}`;
    return `${productionBackend}${normalizedSocketPath}`;
  }

  // Local development fallback
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
  options: DashboardSocketOptions = {}
) {
  const { pauseMapUpdates = false } = options;
  const { setAlerts, addAlert, setNewsEvents, addNewsEvent, setConnectionState, setStats, setUpdatedAt } = dashboardStore.getState();

  const reconnectTimerRef = useRef<number | null>(null);
  const hasReceivedSnapshotRef = useRef(false);
  const pauseMapUpdatesRef = useRef(Boolean(pauseMapUpdates));

  useEffect(() => {
    pauseMapUpdatesRef.current = Boolean(pauseMapUpdates);
  }, [pauseMapUpdates]);

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

    const connect = () => {
      if (isDisposed) {
        return;
      }

      hasReceivedSnapshotRef.current = false;
      setConnectionState("connecting");

      const socketUrl = resolveSocketUrl(socketPath);
      socket = new WebSocket(socketUrl);

      socket.addEventListener("open", () => {
        setConnectionState("live");
        markUpdated();
      });

      socket.addEventListener("close", () => {
        if (isDisposed) {
          return;
        }
        setConnectionState("down", "Disconnected, retrying...");
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(connect, SOCKET_RECONNECT_MS);
      });

      socket.addEventListener("error", () => {
        setConnectionState("down", "Socket error");
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
          const alertList = (Array.isArray(payload.alerts) ? payload.alerts : [])
              .map((alertItem) => toAlertPayload(alertItem))
              .filter((alertItem): alertItem is AlertPayload => alertItem != null);
          const newsList = (Array.isArray(payload.newsEvents) ? payload.newsEvents : [])
              .map((newsItem) => toNewsEventPayload(newsItem))
              .filter((newsItem): newsItem is NewsEventPayload => newsItem != null);
          setAlerts(alertList);
          setNewsEvents(newsList);
          return;
        }

        if (payload.type === "alert" && payload.alert) {
          const normalizedAlert = toAlertPayload(payload.alert);
          if (!normalizedAlert) {
            return;
          }

          addAlert(normalizedAlert);
          return;
        }

        if (payload.type === "news_event" && payload.newsEvent) {
          console.log("[Socket] Received news event:", payload.newsEvent.eventId);
          const normalizedNewsEvent = toNewsEventPayload(payload.newsEvent);
          if (!normalizedNewsEvent) {
            console.warn("[Socket] Failed to normalize news event:", payload.newsEvent.eventId);
            return;
          }

          addNewsEvent(normalizedNewsEvent);
          return;
        }

        if (payload.type === "system_message") {
          // No-op for now in pure R3F build unless we add a UI toast system
          return;
        }

        if (payload.type === "stats") {
          setStats({
            uiClients: payload.connectedClients ?? 0,
            bufferedAlerts: payload.bufferedAlerts ?? 0,
            bufferedNewsEvents: payload.bufferedNewsEvents ?? 0
          });
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
  }, [socketPath, setAlerts, addAlert, setNewsEvents, addNewsEvent, setConnectionState, setStats, setUpdatedAt]);
}
