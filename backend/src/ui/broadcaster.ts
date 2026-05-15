import WebSocket from "ws";

export function createUiBroadcaster(options) {
  const { uiRuntime, logger } = options;

  function broadcast(payload) {
    if (uiRuntime.uiClients.size === 0) {
      return;
    }

    const data = JSON.stringify(payload);
    let broadcastCount = 0;
    for (const client of uiRuntime.uiClients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        client.send(data);
        broadcastCount += 1;
      } catch (error) {
        logger.warn("failed sending message to UI client", { error: error?.message });
      }
    }

    logger.debug("broadcasted UI payload", { type: payload?.type, clients: broadcastCount });
  }

  return {
    broadcast
  };
}
