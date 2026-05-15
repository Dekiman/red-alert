import { extractAlertsFromPayload } from "../alerts/payload-utils.js";
import { createAlertNormalizer } from "../alerts/normalizer.js";

export function createAlertPipeline(options) {
  const {
    config,
    getDatabase,
    getLocalityMapIdsForLocations,
    appLogger,
    alertLogger,
    uiRuntime,
    uiBroadcaster
  } = options;

  const oneTimeWarnings = new Set();

  function warnOnce(key, message, context) {
    if (oneTimeWarnings.has(key)) {
      return;
    }

    oneTimeWarnings.add(key);
    appLogger.warn(message, context);
  }

  const alertNormalizer = createAlertNormalizer({
    timezone: config.alertTimezone,
    englishOnly: config.englishOnly,
    warnOnce,
    getLocalityMapIdsForLocations,
    maxSeenIds: config.maxSeenIds,
    logger: alertLogger
  });

  function publishAlert(alert, source) {
    const normalized = alertNormalizer.normalizeAlert(alert, source);
    if (alertNormalizer.rememberNotificationId(normalized.notificationId)) {
      return null;
    }

    if (config.englishOnly && normalized.locationCount === 0) {
      alertLogger.debug("skipping alert because no English locations were found", {
        notificationId: normalized.notificationId,
        source
      });
      return null;
    }

    const database = getDatabase();
    if (!database) {
      appLogger.error("failed to save alert in database", {
        notificationId: normalized.notificationId,
        source,
        error: "database unavailable"
      });
      return null;
    }

    try {
      const { inserted } = database.saveAlert(normalized, alert);
      if (!inserted) {
        alertLogger.debug("alert was not inserted because it already exists", {
          notificationId: normalized.notificationId
        });
        return null;
      }
    } catch (error) {
      appLogger.error("failed to save alert in database", {
        notificationId: normalized.notificationId,
        source,
        error: error?.message
      });
      return null;
    }

    if (normalized.locationCount === 0) {
      alertLogger.warn("saved alert with no locations", {
        notificationId: normalized.notificationId,
        source
      });
    } else {
      alertLogger.debug("saved alert", {
        notificationId: normalized.notificationId,
        source,
        locations: normalized.locationCount,
        matchedLocalities: normalized.matchedLocationCount,
        threat: normalized.threat,
        isDrill: normalized.isDrill
      });
    }

    uiRuntime.pushRecentAlert(normalized);
    uiBroadcaster.broadcast({
      type: "alert",
      alert: normalized
    });
    uiBroadcaster.broadcast(uiRuntime.getStatsPayload());

    process.stdout.write(`${JSON.stringify(normalized)}\n`);
    return normalized;
  }

  function publishAlertsFromPayload(payload, source) {
    const alerts = extractAlertsFromPayload(payload);
    if (alerts.length === 0) {
      return 0;
    }

    let publishedCount = 0;
    for (const alert of alerts) {
      if (publishAlert(alert, source)) {
        publishedCount += 1;
      }
    }
    return publishedCount;
  }

  return {
    publishAlert,
    publishAlertsFromPayload
  };
}
