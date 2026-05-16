import path from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { createExpressApp } from "./express/app.js";
import { createUiSocketServer } from "./ui-socket.js";

export function createFrontendServer(options) {
  const {
    config,
    uiRuntime,
    uiBroadcaster,
    logger,
    getLocalityMapStatus,
    getLocalityMapPayload,
    getCurrentPolygonStates,
    getPolygonReplayTimeline,
    getLiveNewsFeed,
    getBoundaryDetail,
    getHealthPayload,
    createMockAlert,
    publishAlert,
    createMockSystemMessage,
    publishSystemMessage
  } = options;

  let webServer;
  let webSocketServer;

  function start() {
    if (webServer) {
      return;
    }

    const indexPath = path.join(config.frontendPublicRoot, "index.html");
    if (!existsSync(indexPath)) {
      logger.warn("frontend file missing, UI server disabled", {
        path: indexPath
      });
      return;
    }

    const app = createExpressApp({
      config,
      logger,
      getLocalityMapStatus,
      getLocalityMapPayload,
      getCurrentPolygonStates,
      getPolygonReplayTimeline,
      getLiveNewsFeed,
      getBoundaryDetail,
      getHealthPayload,
      createMockAlert,
      publishAlert,
      createMockSystemMessage,
      publishSystemMessage
    });

    webServer = createServer(app);

    webSocketServer = createUiSocketServer({
      webServer,
      webSocketPath: config.webSocketPath,
      uiRuntime,
      uiBroadcaster,
      logger
    });

    webServer.on("error", (error) => {
      logger.error("frontend server failed", { error: error?.message });
    });

    webServer.listen(config.webPort, config.webHost, () => {
      logger.info("frontend server listening", {
        url: `http://${config.webHost}:${config.webPort}`,
        socketPath: config.webSocketPath
      });
    });
  }

  function stop() {
    if (webSocketServer) {
      logger.info("closing UI websocket server", { clients: uiRuntime.uiClients.size });
      for (const client of uiRuntime.uiClients) {
        try {
          client.close(1001, "Server shutting down");
        } catch {
          // Ignore individual client close errors.
        }
      }

      try {
        webSocketServer.close();
      } catch (error) {
        logger.warn("error while closing UI websocket server", {
          error: error?.message
        });
      } finally {
        webSocketServer = undefined;
      }
    }

    if (webServer) {
      logger.info("closing frontend HTTP server");
      try {
        webServer.close();
      } catch (error) {
        logger.warn("error while closing frontend HTTP server", {
          error: error?.message
        });
      } finally {
        webServer = undefined;
      }
    }
  }

  return {
    start,
    stop
  };
}
