import WebSocket from "ws";
import { extractAlertsFromPayload, isLikelyAlertPayload } from "../alerts/payload-utils.js";
import { firstDefined, isObjectLike } from "../utils/primitives.js";

export function createRedAlertTransport(options) {
  const {
    config,
    wsLogger,
    backupLogger,
    publishAlert,
    publishAlertsFromPayload,
    publishSystemMessage,
    refreshLocalityMapCatalog,
    onConnectionStateChanged
  } = options;

  let ws;
  let reconnectTimer;
  let backupPollTimer;
  let backupPollInFlight = false;
  let wsConnectAttempts = 0;
  let backupPollFailureCount = 0;
  let isShuttingDown = false;
  let lastMissingSystemLocationLogAtMs = 0;

  type SocketCloseInfo = {
    code?: number;
    reason?: string;
  };

  function isConnected() {
    return Boolean(ws);
  }

  async function backupPoll() {
    backupPollInFlight = true;
    backupLogger.debug("starting backup poll request", { url: config.notificationsApiUrl });
    try {
      const referer = config.wsOrigin.endsWith("/") ? config.wsOrigin : `${config.wsOrigin}/`;
      const response = await fetch(config.notificationsApiUrl, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Origin: config.wsOrigin,
          Referer: referer,
          "User-Agent": config.wsUserAgent
        }
      });
      if (!response.ok) {
        throw new Error(`Polling failed with status ${response.status} (${response.statusText})`);
      }

      const payload = await response.json();
      const alerts = extractAlertsFromPayload(payload);
      if (alerts.length === 0 && !Array.isArray(payload)) {
        backupLogger.warn("backup API payload did not contain alerts array", {
          payloadType: typeof payload,
          keys: isObjectLike(payload) ? Object.keys(payload).slice(0, 10) : []
        });
        return;
      }

      backupPollFailureCount = 0;
      backupLogger.debug("backup poll received payload", { count: alerts.length });
      publishAlertsFromPayload(alerts, "notifications_api");
    } catch (error) {
      backupPollFailureCount += 1;
      backupLogger.error("backup poll failed", {
        consecutiveFailures: backupPollFailureCount,
        error: error?.message
      });
    } finally {
      backupPollInFlight = false;
      if (!isShuttingDown) {
        backupPollTimer = setTimeout(() => {
          backupPollTimer = undefined;
          void backupPoll();
        }, config.backupPollMs);
      }
    }
  }

  function stopBackupPoll() {
    if (backupPollTimer) {
      clearTimeout(backupPollTimer);
      backupPollTimer = undefined;
      backupLogger.info("backup poll stopped");
    }
  }

  function startBackupPoll(reason = "supplemental_poll") {
    if (isShuttingDown) {
      return;
    }

    if (!backupPollTimer && !backupPollInFlight) {
      backupLogger.info("backup poll started", {
        reason,
        pollIntervalMs: config.backupPollMs,
        websocketConnected: Boolean(ws)
      });
      void backupPoll();
    }
  }

  function scheduleReconnect(reason) {
    if (isShuttingDown || reconnectTimer) {
      if (reconnectTimer) {
        wsLogger.debug("reconnect already scheduled; skipping duplicate schedule");
      }
      return;
    }

    wsLogger.info("scheduling websocket reconnect", {
      delayMs: config.reconnectDelayMs,
      reason
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, config.reconnectDelayMs);
  }

  function handleSocketClose(closeInfo: SocketCloseInfo = {}) {
    ws = undefined;
    onConnectionStateChanged(false);

    if (isShuttingDown) {
      wsLogger.info("socket closed during shutdown", closeInfo);
      return;
    }

    startBackupPoll("websocket_unavailable");
    scheduleReconnect(closeInfo.reason ?? "socket_closed");
  }

  function handleSocketMessage(rawMessage) {
    if (typeof rawMessage !== "string") {
      wsLogger.warn("received non-string websocket message", { type: typeof rawMessage });
      return;
    }

    const trimmedMessage = rawMessage.trim();
    if (!trimmedMessage) {
      wsLogger.debug("received empty websocket message");
      return;
    }

    if (trimmedMessage === "ping" || trimmedMessage === "pong") {
      wsLogger.debug("received websocket heartbeat frame", { value: trimmedMessage });
      return;
    }

    if (!trimmedMessage.startsWith("{") && !trimmedMessage.startsWith("[")) {
      wsLogger.debug("ignoring non-json websocket message", {
        sample: trimmedMessage.slice(0, config.maxParseLogChars),
        truncated: trimmedMessage.length > config.maxParseLogChars
      });
      return;
    }

    let message;
    try {
      message = JSON.parse(trimmedMessage);
    } catch {
      wsLogger.error("failed to parse websocket message", {
        sample: trimmedMessage.slice(0, config.maxParseLogChars),
        truncated: trimmedMessage.length > config.maxParseLogChars
      });
      return;
    }

    const envelopes = Array.isArray(message) ? message : [message];
    let handledAny = false;

    for (const envelope of envelopes) {
      if (!isObjectLike(envelope)) {
        continue;
      }

      const rawType = firstDefined(envelope.type, envelope.event, envelope.messageType);
      const type = String(rawType ?? "").toUpperCase();
      const data = firstDefined(envelope.data, envelope.payload, envelope.alert, envelope.notification);

      if ((type === "ALERT" || type === "NOTIFICATION") && data) {
        publishAlertsFromPayload(data, "websocket");
        handledAny = true;
        continue;
      }

      if ((type === "ALERT" || type === "NOTIFICATION") && !data) {
        wsLogger.warn("received alert envelope without data");
        handledAny = true;
        continue;
      }

      if (type === "SYSTEM_MESSAGE") {
        const summarySource = firstDefined(data, envelope.data, envelope.payload, envelope);
        const publishedSystemMessage = publishSystemMessage(summarySource, "websocket");
        wsLogger.warn("system message received", {
          kind: publishedSystemMessage.kind,
          hasInstruction: Boolean(publishedSystemMessage.instruction),
          textParts: publishedSystemMessage.textParts.length,
          locationNames: publishedSystemMessage.locationNames.length,
          locationIds: publishedSystemMessage.locationIds.length
        });

        const hasExplicitLocations =
          publishedSystemMessage.locationNames.length > 0 || publishedSystemMessage.locationIds.length > 0;
        if (!hasExplicitLocations) {
          const nowMs = Date.now();
          const shouldLogDetails = nowMs - lastMissingSystemLocationLogAtMs >= 15000;
          if (shouldLogDetails) {
            lastMissingSystemLocationLogAtMs = nowMs;
            const locationSource = isObjectLike(summarySource) ? summarySource : {};
            const nestedData =
              isObjectLike(locationSource?.data) ? locationSource.data : {};
            wsLogger.warn("system message missing explicit locations in payload", {
              envelopeKeys: Object.keys(envelope).slice(0, 20),
              payloadKeys: Object.keys(locationSource).slice(0, 30),
              nestedDataKeys: Object.keys(nestedData).slice(0, 30),
              sample: trimmedMessage.slice(0, config.maxParseLogChars),
              truncated: trimmedMessage.length > config.maxParseLogChars
            });
          }
        }

        handledAny = true;
        continue;
      }

      if (type === "LISTS_VERSIONS") {
        const versionsPayload = isObjectLike(data) ? data : envelope;
        wsLogger.info("lists versions update received", {
          hasCitiesVersion: versionsPayload?.cities != null,
          hasPolygonsVersion: versionsPayload?.polygons != null
        });
        void refreshLocalityMapCatalog("ws_lists_versions");
        handledAny = true;
        continue;
      }

      if (isLikelyAlertPayload(envelope)) {
        publishAlert(envelope, "websocket");
        handledAny = true;
      }
    }

    if (handledAny) {
      return;
    }

    wsLogger.debug("unhandled websocket payload", {
      topLevelType: Array.isArray(message) ? "array" : typeof message
    });
  }

  function connect() {
    if (isShuttingDown || ws) {
      wsLogger.debug("connect skipped", {
        isShuttingDown,
        hasActiveSocket: Boolean(ws)
      });
      return;
    }

    wsConnectAttempts += 1;
    wsLogger.info("opening websocket connection", {
      attempt: wsConnectAttempts,
      url: config.websocketUrl
    });

    const socket = new WebSocket(config.websocketUrl, {
      headers: {
        Origin: config.wsOrigin,
        "User-Agent": config.wsUserAgent
      }
    });

    ws = socket;

    socket.on("open", () => {
      wsLogger.info("websocket connected", { attempt: wsConnectAttempts });
      onConnectionStateChanged(true);
      startBackupPoll("websocket_connected_safety_net");
    });

    socket.on("message", (message, isBinary) => {
      const text = typeof message === "string" ? message : message?.toString?.("utf8");
      if (!text) {
        wsLogger.debug("received websocket frame with empty payload", {
          isBinary,
          size: message?.length ?? 0
        });
        return;
      }

      if (isBinary) {
        wsLogger.debug("received binary websocket frame; attempting utf8 parse", {
          size: message?.length ?? 0
        });
      }

      handleSocketMessage(text);
    });

    socket.on("close", (code, reasonBuffer) => {
      const reason = reasonBuffer?.toString() ?? "";
      wsLogger.warn("websocket closed", { code, reason });
      handleSocketClose({
        code,
        reason: reason || "socket_close_event"
      });
    });

    socket.on("error", (error) => {
      wsLogger.error("websocket error", { error: error?.message });
      try {
        socket.close();
      } catch (closeError) {
        wsLogger.warn("failed to close websocket after error", {
          error: closeError?.message
        });
      }
    });
  }

  function start() {
    isShuttingDown = false;
    startBackupPoll("startup");
    connect();
  }

  function stop() {
    isShuttingDown = true;
    stopBackupPoll();

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      wsLogger.info("cleared pending reconnect timer");
    }

    if (ws) {
      wsLogger.info("closing websocket");
      try {
        ws.close();
      } catch (error) {
        wsLogger.warn("error while closing websocket during shutdown", {
          error: error?.message
        });
      } finally {
        ws = undefined;
      }
      onConnectionStateChanged(false);
    }
  }

  return {
    start,
    stop,
    isConnected
  };
}
