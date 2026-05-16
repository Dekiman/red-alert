export function createUiRuntime(options) {
  const { uiHistorySize, uiNewsHistorySize } = options;
  const recentAlerts = [];
  const recentNewsEvents = [];
  const uiClients = new Set();

  function pushRecentAlert(alert) {
    recentAlerts.unshift(alert);
    if (recentAlerts.length > uiHistorySize) {
      recentAlerts.pop();
    }
  }

  function pushRecentNewsEvent(newsEvent) {
    const existingIndex = recentNewsEvents.findIndex((item) => item.eventId === newsEvent.eventId);
    if (existingIndex >= 0) {
      recentNewsEvents.splice(existingIndex, 1);
    }

    recentNewsEvents.unshift(newsEvent);
    if (recentNewsEvents.length > uiNewsHistorySize) {
      recentNewsEvents.pop();
    }
  }

  function getSnapshotPayload() {
    return {
      type: "snapshot",
      alerts: recentAlerts,
      newsEvents: recentNewsEvents
    };
  }

  function getStatsPayload() {
    return {
      type: "stats",
      connectedClients: uiClients.size,
      bufferedAlerts: recentAlerts.length,
      bufferedNewsEvents: recentNewsEvents.length
    };
  }

  return {
    recentAlerts,
    recentNewsEvents,
    uiClients,
    pushRecentAlert,
    pushRecentNewsEvent,
    getSnapshotPayload,
    getStatsPayload
  };
}
