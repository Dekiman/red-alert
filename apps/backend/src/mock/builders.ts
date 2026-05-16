import { parseBooleanLike } from "../utils/primitives.js";

function parseNumberCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item));
}

export function createMockAlertFromRequestUrl(requestUrl) {
  const locationsValue = requestUrl.searchParams.get("locations") ?? requestUrl.searchParams.get("location");
  const locations = String(locationsValue || "Tel Aviv")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const threatRaw = Number(requestUrl.searchParams.get("threat"));
  const threat = Number.isFinite(threatRaw) ? Math.max(0, Math.floor(threatRaw)) : 0;
  const isDrill = parseBooleanLike(requestUrl.searchParams.get("isDrill"), false);
  const nowUnix = Math.floor(Date.now() / 1000);
  const notificationId =
    requestUrl.searchParams.get("notificationId") ??
    `mock-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  return {
    notificationId,
    time: nowUnix,
    threat,
    isDrill,
    cities: locations
  };
}

export function createMockSystemMessageFromRequestUrl(requestUrl) {
  const kindRaw = requestUrl.searchParams.get("kind") ?? "other";
  const kind = String(kindRaw).trim().toLowerCase();
  const locationsValue = requestUrl.searchParams.get("locations") ?? requestUrl.searchParams.get("location") ?? "";
  const locations = String(locationsValue)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const locationIds = parseNumberCsv(
    requestUrl.searchParams.get("locationIds") ?? requestUrl.searchParams.get("ids") ?? ""
  );

  const defaultTitleByKind = {
    pre_alert: "Pre-alert notice",
    safe_to_go_out: "Incident ended",
    other: "System notice"
  };
  const defaultBodyByKind = {
    pre_alert: "In the next few minutes alerts are expected in your area. Be prepared.",
    safe_to_go_out: "Incident ended. Safe to go out.",
    other: "System message."
  };

  const title = requestUrl.searchParams.get("title") ?? defaultTitleByKind[kind] ?? defaultTitleByKind.other;
  const body = requestUrl.searchParams.get("body") ?? defaultBodyByKind[kind] ?? defaultBodyByKind.other;
  const instruction = requestUrl.searchParams.get("instruction") ?? kind;

  return {
    kind,
    instruction,
    title,
    titleEn: title,
    body,
    bodyEn: body,
    locations,
    locationIds
  };
}
