import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.js";
import { parseEnv } from "../env.js";
import { createLogger } from "../logger.js";
import { createAppConfig } from "../config.js";
import { initDatabase } from "../db.js";
import { createLocalityMapRuntime } from "../locality-map/runtime.js";
import { createAlertPipeline } from "../app/alert-pipeline.js";
import { createNewsPipeline } from "../app/news-pipeline.js";
import { createSystemMessagePipeline } from "../app/system-message-pipeline.js";
import { extractAlertsFromPayload, isLikelyAlertPayload } from "../alerts/payload-utils.js";
import { firstDefined, isObjectLike } from "../utils/primitives.js";

export class AlertBroadcaster extends DurableObject {
  logger = createLogger("do-broadcaster");
  wsLogger = createLogger("do-ws");
  config: any;
  db: any;
  localityMapRuntime: any;
  upstreamSocket: WebSocket | null = null;
  recentAlerts: any[] = [];
  recentNewsEvents: any[] = [];
  publishAlertsFromPayload: any;
  publishNewsEvent: any;
  publishSystemMessage: any;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    this.config = createAppConfig(parseEnv(env), this.logger);
    this.db = initDatabase({ kv: env.ALERTS_KV, includeWeatherNews: this.config.newsIncludeWeather, englishOnlyNews: this.config.newsEnglishOnly });
    this.localityMapRuntime = createLocalityMapRuntime({ config: this.config, logger: this.logger });

    const uiRuntime = {
      uiClients: new Set(),
      recentAlerts: this.recentAlerts,
      recentNewsEvents: this.recentNewsEvents,
      pushRecentAlert: (alert: any) => {
        this.recentAlerts.unshift(alert);
        if (this.recentAlerts.length > this.config.uiHistorySize) this.recentAlerts.pop();
      },
      pushRecentNewsEvent: (newsEvent: any) => {
        const existingIndex = this.recentNewsEvents.findIndex((item) => item.eventId === newsEvent.eventId);
        if (existingIndex !== -1) this.recentNewsEvents.splice(existingIndex, 1);
        this.recentNewsEvents.unshift(newsEvent);
        if (this.recentNewsEvents.length > this.config.uiNewsHistorySize) this.recentNewsEvents.pop();
      },

      getStatsPayload: () => ({
        type: "stats",
        connectedClients: this.ctx.getWebSockets().length,
        bufferedAlerts: this.recentAlerts.length,
        bufferedNewsEvents: this.recentNewsEvents.length
      })
    };

    const uiBroadcaster = {
      broadcast: (payload: any) => {
        const data = JSON.stringify(payload);
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.send(data);
          } catch (e) {
            // ignore
          }
        }
      }
    };

    const alertPipeline = createAlertPipeline({
      config: this.config,
      getDatabase: () => this.db,
      getLocalityMapIdsForLocations: (locs: string[]) => this.localityMapRuntime.findLocalityIdsForLocations(locs),
      appLogger: this.logger,
      alertLogger: createLogger("alert"),
      uiRuntime,
      uiBroadcaster
    });

    this.publishAlertsFromPayload = alertPipeline.publishAlertsFromPayload;

    const newsPipeline = createNewsPipeline({
      uiRuntime,
      uiBroadcaster
    });

    this.publishNewsEvent = newsPipeline.handleLiveNewsEvent;

    const systemMessagePipeline = createSystemMessagePipeline({
      getLocalityMapIdsForLocations: (locs: string[]) => this.localityMapRuntime.findLocalityIdsForLocations(locs),
      uiBroadcaster
    });

    this.publishSystemMessage = systemMessagePipeline.publishSystemMessage;

    ctx.blockConcurrencyWhile(async () => {
      await this.localityMapRuntime.start(env.CACHE_KV);
      
      const alerts = await this.db.alerts.getRecent(this.config.uiHistorySize);
      this.recentAlerts.push(...alerts);
      this.logger.info("loaded initial alerts", { count: alerts.length });
      
      const newsFeed = await this.db.news.getFeed({ limit: this.config.uiNewsHistorySize });
      this.recentNewsEvents.push(...newsFeed.events);
      this.logger.info("loaded initial news feed", { 
        count: newsFeed.events.length, 
        limit: this.config.uiNewsHistorySize 
      });

      await this.ensureUpstreamConnection();
    });
  }

  async ensureUpstreamConnection() {
    if (this.upstreamSocket) {
      return;
    }

    const fetchUrl = this.config.websocketUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    this.wsLogger.info("connecting to upstream websocket", { url: fetchUrl });
    try {
      const response = await fetch(fetchUrl, {
        headers: {
          Upgrade: "websocket",
          Origin: this.config.wsOrigin,
          "User-Agent": this.config.wsUserAgent
        }
      });

      const webSocket = response.webSocket;
      if (!webSocket) {
        throw new Error("Failed to upgrade to WebSocket");
      }

      webSocket.accept();
      this.upstreamSocket = webSocket;

      webSocket.addEventListener("message", (event) => {
        const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        this.handleSocketMessage(text);
      });

      webSocket.addEventListener("close", (event) => {
        this.wsLogger.warn("upstream websocket closed", { code: event.code, reason: event.reason });
        this.upstreamSocket = null;
      });

      webSocket.addEventListener("error", (error) => {
        this.wsLogger.error("upstream websocket error");
        this.upstreamSocket = null;
      });
    } catch (e: any) {
      this.wsLogger.error("failed to connect to upstream", { error: e.message });
      this.upstreamSocket = null;
    }
  }

  handleSocketMessage(rawMessage: string) {
    const trimmedMessage = rawMessage.trim();
    if (!trimmedMessage) return;
    if (trimmedMessage === "ping" || trimmedMessage === "pong") return;
    if (!trimmedMessage.startsWith("{") && !trimmedMessage.startsWith("[")) return;

    let message;
    try {
      message = JSON.parse(trimmedMessage);
    } catch {
      return;
    }

    const envelopes = Array.isArray(message) ? message : [message];
    for (const envelope of envelopes) {
      if (!isObjectLike(envelope)) continue;

      const rawType = firstDefined(envelope.type, envelope.event, envelope.messageType);
      const type = String(rawType ?? "").toUpperCase();
      const data = firstDefined(envelope.data, envelope.payload, envelope.alert, envelope.notification);

      if ((type === "ALERT" || type === "NOTIFICATION") && data) {
        this.publishAlertsFromPayload(data, "websocket");
        continue;
      }

      if (type === "SYSTEM_MESSAGE") {
        const summarySource = firstDefined(data, envelope.data, envelope.payload, envelope);
        this.publishSystemMessage(summarySource, "websocket");
        continue;
      }

      if (isLikelyAlertPayload(envelope)) {
        this.publishAlertsFromPayload([envelope], "websocket");
      }
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/poke") {
      await this.ensureUpstreamConnection();
      return new Response("OK");
    }

    if (url.pathname === "/push-news") {
      if (request.method !== "POST") {
        return new Response("Expected POST", { status: 405 });
      }
      const event = await request.json();
      this.logger.info("received news event from api", { eventId: event.eventId });
      this.publishNewsEvent(event);
      return new Response("OK");
    }

    if (url.pathname === "/ui-socket") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      this.logger.info("new ui client connecting");

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      const snapshot = {
        type: "snapshot",
        alerts: this.recentAlerts,
        newsEvents: this.recentNewsEvents,
        serverTimeIso: new Date().toISOString()
      };
      
      server.send(JSON.stringify(snapshot));
      this.logger.info("sent snapshot to new ui client", { 
        alerts: this.recentAlerts.length, 
        newsEvents: this.recentNewsEvents.length 
      });

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Handle incoming from UI client if needed (e.g. heartbeat)
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    // Broadcast updated stats
    const stats = {
      type: "stats",
      connectedClients: Math.max(0, this.ctx.getWebSockets().length - 1),
      bufferedAlerts: this.recentAlerts.length,
      bufferedNewsEvents: this.recentNewsEvents.length
    };
    for (const client of this.ctx.getWebSockets()) {
      if (client !== ws) {
        try { client.send(JSON.stringify(stats)); } catch {}
      }
    }
  }
}
