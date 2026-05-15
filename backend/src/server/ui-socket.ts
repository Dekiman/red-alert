import { WebSocketServer } from "ws";

export function createUiSocketServer({ webServer, webSocketPath, uiRuntime, uiBroadcaster, logger }) {
  const webSocketServer = new WebSocketServer({
    server: webServer,
    path: webSocketPath
  });

  webSocketServer.on("connection", (client, req) => {
    uiRuntime.uiClients.add(client);
    logger.info("UI client connected", {
      remoteAddress: req.socket.remoteAddress,
      clients: uiRuntime.uiClients.size
    });

    try {
      client.send(JSON.stringify(uiRuntime.getSnapshotPayload()));
      client.send(JSON.stringify(uiRuntime.getStatsPayload()));
    } catch (error) {
      logger.warn("failed to send initial UI payload", {
        error: error?.message
      });
    }

    client.on("close", () => {
      uiRuntime.uiClients.delete(client);
      logger.info("UI client disconnected", {
        clients: uiRuntime.uiClients.size
      });
      uiBroadcaster.broadcast(uiRuntime.getStatsPayload());
    });

    client.on("error", (error) => {
      logger.warn("UI client socket error", { error: error?.message });
    });
  });

  return webSocketServer;
}
