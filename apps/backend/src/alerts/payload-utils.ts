import { firstDefined, isObjectLike } from "../utils/primitives.js";
import { parseBooleanLike } from "../utils/primitives.js";

export function parseUnixSecondsLike(value) {
  if (value == null) {
    return null;
  }

  let numeric = Number(value);
  if (!Number.isFinite(numeric) && typeof value === "string") {
    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) {
      numeric = parsedDate;
    }
  }
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric > 1e14) {
    numeric /= 1000;
  }
  if (numeric > 1e12) {
    numeric /= 1000;
  }
  if (numeric > 1e10) {
    numeric /= 1000;
  }
  return Math.floor(numeric);
}

export function isLikelyAlertPayload(value) {
  if (!isObjectLike(value)) {
    return false;
  }
  return (
    value.cities != null ||
    value.locations != null ||
    value.notificationId != null ||
    value.notificationID != null ||
    value.id != null ||
    value.time != null ||
    value.timestamp != null
  );
}

export function extractAlertsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isLikelyAlertPayload(payload)) {
    return [payload];
  }
  if (!isObjectLike(payload)) {
    return [];
  }

  const candidates = [
    payload.data,
    payload.alerts,
    payload.notifications,
    payload.items,
    payload.results,
    payload.payload
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isLikelyAlertPayload(candidate)) {
      return [candidate];
    }
  }

  return [];
}

export function coerceStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return null;
}

export function extractAlertLocations(alert) {
  const candidates = [
    ["cities", alert?.cities],
    ["locations", alert?.locations],
    ["cities", alert?.data?.cities],
    ["locations", alert?.data?.locations],
    ["localities", alert?.localities],
    ["citiesCsv", alert?.citiesCsv],
    ["locationsCsv", alert?.locationsCsv]
  ];

  for (const [sourceField, rawValue] of candidates) {
    const parsed = coerceStringArray(rawValue);
    if (parsed) {
      return { locations: parsed, sourceField, invalidType: null };
    }
    if (rawValue != null) {
      return {
        locations: [],
        sourceField,
        invalidType: typeof rawValue
      };
    }
  }
  return {
    locations: [],
    sourceField: null,
    invalidType: null
  };
}

export function extractAlertThreat(alert) {
  const rawThreat = firstDefined(
    alert?.threat,
    alert?.threatId,
    alert?.threat_id,
    alert?.type,
    alert?.data?.threat,
    alert?.data?.threatId
  );
  const parsed = Number(rawThreat);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractAlertIsDrill(alert) {
  const rawValue = firstDefined(
    alert?.isDrill,
    alert?.is_drill,
    alert?.drill,
    alert?.training,
    alert?.data?.isDrill,
    alert?.data?.is_drill
  );
  return parseBooleanLike(rawValue, false);
}

export function extractAlertNotificationId(alert) {
  const rawValue = firstDefined(
    alert?.notificationId,
    alert?.notificationID,
    alert?.id,
    alert?.messageId,
    alert?.uuid,
    alert?.data?.notificationId,
    alert?.data?.id
  );
  if (rawValue == null) {
    return null;
  }
  const normalized = String(rawValue).trim();
  return normalized || null;
}

export function extractAlertTime(alert) {
  return parseUnixSecondsLike(
    firstDefined(
      alert?.time,
      alert?.timestamp,
      alert?.alertTime,
      alert?.createdAt,
      alert?.created_at,
      alert?.date,
      alert?.data?.time,
      alert?.data?.timestamp
    )
  );
}
