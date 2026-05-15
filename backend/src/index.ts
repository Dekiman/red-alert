import { initDatabase } from "./db.js";
import { createLogger, getActiveLogLevel } from "./logger.js";
import { createAppConfig } from "./config.js";
import { createMockAlertFromRequestUrl, createMockSystemMessageFromRequestUrl } from "./mock/builders.js";
import { createUiRuntime } from "./ui/runtime-state.js";
import { createUiBroadcaster } from "./ui/broadcaster.js";
import { createNewsRuntime } from "./news/runtime.js";
import { createLocalityMapRuntime } from "./locality-map/runtime.js";
import { createFrontendServer } from "./server/frontend-server.js";
import { createRedAlertTransport } from "./transport/red-alert-transport.js";
import { createAlertPipeline } from "./app/alert-pipeline.js";
import { createSystemMessagePipeline } from "./app/system-message-pipeline.js";
import { createNewsPipeline } from "./app/news-pipeline.js";
import { createPolygonStateService } from "./polygon-state/service.js";
import { createBoundaryDetailService } from "./boundary-detail/service.js";

const appLogger = createLogger("app");
const wsLogger = createLogger("ws");
const backupLogger = createLogger("backup");
const alertLogger = createLogger("alert");
const uiLogger = createLogger("ui");
const newsLogger = createLogger("news");
const boundaryLogger = createLogger("boundary");

const config = createAppConfig(appLogger);
let database;
let isShuttingDown = false;
let websocketConnected = false;

const uiRuntime = createUiRuntime({
  uiHistorySize: config.uiHistorySize,
  uiNewsHistorySize: config.uiNewsHistorySize
});
const uiBroadcaster = createUiBroadcaster({
  uiRuntime,
  logger: uiLogger
});

const localityMapRuntime = createLocalityMapRuntime({
  config,
  logger: uiLogger
});

function getLocalityMapIdsForLocations(locations) {
  return localityMapRuntime.findLocalityIdsForLocations(locations);
}

const polygonStateService = createPolygonStateService({
  getDatabase: () => database ?? null,
  getLocalityMapIdsForLocations,
  logger: uiLogger
});

const boundaryDetailService = createBoundaryDetailService({
  logger: boundaryLogger
});

const { publishAlert, publishAlertsFromPayload } = createAlertPipeline({
  config,
  getDatabase: () => database,
  getLocalityMapIdsForLocations,
  appLogger,
  alertLogger,
  uiRuntime,
  uiBroadcaster
});

const { publishSystemMessage } = createSystemMessagePipeline({
  getLocalityMapIdsForLocations,
  uiBroadcaster
});

const { handleLiveNewsEvent } = createNewsPipeline({
  uiRuntime,
  uiBroadcaster
});

let newsRuntime = {
  start() {},
  stop() {}
};

const frontendServer = createFrontendServer({
  config,
  uiRuntime,
  uiBroadcaster,
  logger: uiLogger,
  getLocalityMapStatus: () => localityMapRuntime.getStatus(),
  getLocalityMapPayload: () => localityMapRuntime.getPayload(),
  getCurrentPolygonStates: (query) => polygonStateService.getCurrentPolygonStates(query),
  getPolygonReplayTimeline: (query) => polygonStateService.getPolygonReplayTimeline(query),
  getLiveNewsFeed: (query) => database?.getLiveNewsFeed(query) ?? null,
  getBoundaryDetail: (query) => boundaryDetailService.getBoundaryDetail(query),
  getHealthPayload: () => ({
    status: "ok",
    websocketConnected,
    liveNewsCollectorEnabled: config.newsEnabled,
    uiClients: uiRuntime.uiClients.size,
    bufferedAlerts: uiRuntime.recentAlerts.length,
    bufferedNewsEvents: uiRuntime.recentNewsEvents.length,
    localityMapStatus: localityMapRuntime.getStatus().status,
    localityMapLoadedAtIso: localityMapRuntime.getStatus().loadedAtIso ?? null
  }),
  createMockAlert: createMockAlertFromRequestUrl,
  publishAlert,
  createMockSystemMessage: createMockSystemMessageFromRequestUrl,
  publishSystemMessage
});

const transport = createRedAlertTransport({
  config,
  wsLogger,
  backupLogger,
  publishAlert,
  publishAlertsFromPayload,
  publishSystemMessage,
  refreshLocalityMapCatalog: (reason) => localityMapRuntime.refresh(reason),
  onConnectionStateChanged: (isConnected) => {
    websocketConnected = isConnected;
  }
});

function initializeDatabase() {
  try {
    database = initDatabase({
      includeWeatherNews: config.newsIncludeWeather,
      englishOnlyNews: config.newsEnglishOnly
    });
    appLogger.info("database connected", { dbPath: database.path });

    const storedNewsEvents = database.getRecentLiveNewsEvents(config.uiNewsHistorySize);
    uiRuntime.recentNewsEvents.push(...storedNewsEvents);
    if (storedNewsEvents.length > 0) {
      newsLogger.info("loaded live news events from database for UI warm start", {
        count: storedNewsEvents.length
      });
    }
  } catch (error) {
    appLogger.error("database initialization failed", {
      error: error?.message
    });
    process.exit(1);
  }
}

function start() {
  initializeDatabase();

  appLogger.info("starting red alert stream client", {
    logLevel: getActiveLogLevel(),
    websocketUrl: config.websocketUrl,
    notificationsUrl: config.notificationsApiUrl,
    reconnectDelayMs: config.reconnectDelayMs,
    backupPollMs: config.backupPollMs,
    timezone: config.alertTimezone,
    maxSeenIds: config.maxSeenIds,
    englishOnly: config.englishOnly,
    webHost: config.webHost,
    webPort: config.webPort,
    webSocketPath: config.webSocketPath,
    uiHistorySize: config.uiHistorySize,
    uiNewsHistorySize: config.uiNewsHistorySize,
    liveNewsEnabled: config.newsEnabled,
    liveNewsIncludeWeather: config.newsIncludeWeather,
    liveNewsEnglishOnly: config.newsEnglishOnly,
    liveNewsPollMs: config.newsPollMs,
    liveNewsFetchTimeoutMs: config.newsFetchTimeoutMs,
    liveNewsMaxSignalsPerEvent: config.newsMaxSignalsPerEvent,
    liveNewsProviders: config.newsProviders,
    liveNewsSourceTypes: config.newsSourceTypes,
    liveNewsMaxEventsPerProvider: config.newsMaxEventsPerProvider,
    liveNewsGdacsApiUrl: config.newsGdacsApiUrl,
    liveNewsGdacsLookbackDays: config.newsGdacsLookbackDays,
    liveNewsUsgsApiUrl: config.newsUsgsApiUrl,
    liveNewsGdeltApiUrl: config.newsGdeltApiUrl,
    liveNewsGdeltMaxRecords: config.newsGdeltMaxRecords,
    liveNewsNwsApiUrl: config.newsNwsApiUrl,
    liveNewsWeatherCanadaApiUrl: config.newsWeatherCanadaApiUrl,
    liveNewsMeteoalarmApiUrl: config.newsMeteoalarmApiUrl,
    localityMapEnabled: config.localityMapEnabled,
    localityMapListsVersionsUrl: config.localityMapListsVersionsUrl,
    localityMapCitiesUrl: config.localityMapCitiesUrl,
    localityMapPolygonsUrl: config.localityMapPolygonsUrl,
    localityMapFetchTimeoutMs: config.localityMapFetchTimeoutMs,
    localityMapRefreshMs: config.localityMapRefreshMs,
    localityMapDefaultCitiesVersion: config.localityMapDefaultCitiesVersion,
    localityMapDefaultPolygonsVersion: config.localityMapDefaultPolygonsVersion
  });

  localityMapRuntime.start();
  frontendServer.start();

  if (!database) {
    appLogger.error("live news collector not started because database is unavailable");
  } else {
    newsRuntime = createNewsRuntime({
      config,
      database,
      logger: newsLogger,
      onNewsEvent: handleLiveNewsEvent
    });
    newsRuntime.start();
  }

  transport.start();
}

function shutdown(signal) {
  if (isShuttingDown) {
    appLogger.warn("duplicate shutdown signal ignored", { signal });
    return;
  }

  isShuttingDown = true;
  appLogger.info("shutdown signal received", { signal });

  transport.stop();
  newsRuntime.stop();
  frontendServer.stop();
  localityMapRuntime.stop();

  if (database) {
    try {
      database.close();
    } catch (error) {
      appLogger.error("error while closing database", { error: error?.message });
    } finally {
      database = undefined;
    }
  }

  appLogger.info("shutdown complete");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
