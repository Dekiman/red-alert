import { createHash } from "node:crypto";
import {
  extractAlertIsDrill,
  extractAlertLocations,
  extractAlertNotificationId,
  extractAlertThreat,
  extractAlertTime
} from "./payload-utils.js";

export function createAlertNormalizer(options) {
  const {
    timezone,
    englishOnly,
    warnOnce,
    getLocalityMapIdsForLocations,
    maxSeenIds,
    logger
  } = options;

  const seenNotificationIds = [];
  const israelDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  function getUtcDateTimeParts(unixSeconds) {
    const iso = new Date(unixSeconds * 1000).toISOString();
    return {
      alertTimestampIso: iso,
      alertDateUtc: iso.slice(0, 10),
      alertTimeUtc: iso.slice(11, 19)
    };
  }

  function getIsraelDateTimeParts(unixSeconds) {
    const parts = israelDateTimeFormatter.formatToParts(new Date(unixSeconds * 1000));
    const valueOf = (partType) => parts.find((part) => part.type === partType)?.value ?? "00";
    return {
      alertDateIsrael: `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`,
      alertTimeIsrael: `${valueOf("hour")}:${valueOf("minute")}:${valueOf("second")}`
    };
  }

  function buildDerivedNotificationId(sourceUnix, threat, isDrill, locations) {
    const key = `${sourceUnix}|${threat}|${Number(isDrill)}|${locations.join("|")}`;
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
    return `derived-${hash}`;
  }

  function isEnglishLocation(value) {
    if (typeof value !== "string") {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    if (/[\u0590-\u05FF]/.test(trimmed)) {
      return false;
    }
    return /[A-Za-z]/.test(trimmed);
  }

  function rememberNotificationId(notificationId) {
    if (!notificationId) {
      warnOnce("missing_notification_id", "alert missing notification id; using derived id");
      return false;
    }

    if (seenNotificationIds.includes(notificationId)) {
      logger?.debug?.("duplicate notification id detected; skipping", { notificationId });
      return true;
    }

    seenNotificationIds.push(notificationId);
    if (seenNotificationIds.length > maxSeenIds) {
      seenNotificationIds.shift();
    }
    return false;
  }

  function normalizeAlert(alert, source) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const sourceTime = extractAlertTime(alert);
    const sourceUnix = Number.isFinite(sourceTime) ? sourceTime : nowUnix;
    if (!Number.isFinite(sourceTime)) {
      warnOnce(
        "missing_source_time",
        "alert payload missing numeric time; using local receive time as fallback",
        { source }
      );
    }

    const locationsResult = extractAlertLocations(alert);
    const rawLocations = locationsResult.locations;
    if (locationsResult.invalidType) {
      warnOnce("invalid_locations_type", "alert payload contains unsupported locations field type", {
        source,
        field: locationsResult.sourceField,
        valueType: locationsResult.invalidType
      });
    }

    const locations = englishOnly ? rawLocations.filter((location) => isEnglishLocation(location)) : rawLocations;
    const locationIds = getLocalityMapIdsForLocations(locations);

    const threatValue = extractAlertThreat(alert);
    const threat = Number.isFinite(threatValue) ? threatValue : 8;
    if (!Number.isFinite(threatValue)) {
      warnOnce("missing_threat_value", "alert payload missing threat value; defaulting to 8", { source });
    }

    const isDrill = extractAlertIsDrill(alert);
    const notificationId =
      extractAlertNotificationId(alert) ?? buildDerivedNotificationId(sourceUnix, threat, isDrill, rawLocations);
    const utc = getUtcDateTimeParts(sourceUnix);
    const israel = getIsraelDateTimeParts(sourceUnix);

    return {
      source,
      notificationId,
      threat,
      isDrill,
      locations,
      locationCount: locations.length,
      locationIds,
      matchedLocationCount: locationIds.length,
      alertTimestampUnix: sourceUnix,
      alertTimestampIso: utc.alertTimestampIso,
      alertDateUtc: utc.alertDateUtc,
      alertTimeUtc: utc.alertTimeUtc,
      alertDateIsrael: israel.alertDateIsrael,
      alertTimeIsrael: israel.alertTimeIsrael,
      receivedAtIso: new Date().toISOString(),
      hasSourceTime: Number.isFinite(sourceTime)
    };
  }

  return {
    normalizeAlert,
    rememberNotificationId
  };
}
