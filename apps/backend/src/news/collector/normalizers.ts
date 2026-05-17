import type { NormalizedNewsEvent, NormalizedNewsSignal } from "./types.js";
import { firstDefined, parseBooleanLike } from "../../utils/primitives.js";

export function normalizeTimestamp(input: unknown) {
  if (input == null) {
    return null;
  }

  let value = String(input).trim();
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    value = value.replace(" ", "T");
  }
  if (!/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    value += "Z";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function parseSourceTypes(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((part) => String(part).trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeSourceTypeValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toOptionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeNewsEvent(rawEvent: any): NormalizedNewsEvent {
  const sourceTypes = parseSourceTypes(
    firstDefined(rawEvent?.source_types, rawEvent?.sourceTypes, rawEvent?.source_type, rawEvent?.sourceType)
  );
  const nowIso = new Date().toISOString();
  const createdAtIso =
    normalizeTimestamp(firstDefined(rawEvent?.created_at, rawEvent?.createdAt, rawEvent?.timestamp, rawEvent?.time)) ??
    nowIso;
  const updatedAtIso =
    normalizeTimestamp(firstDefined(rawEvent?.updated_at, rawEvent?.updatedAt, rawEvent?.modified_at)) ??
    createdAtIso;
  const severityRaw = Number(firstDefined(rawEvent?.severity, rawEvent?.threat, rawEvent?.priority));
  const signalCountRaw = Number(
    firstDefined(rawEvent?.signal_count, rawEvent?.signals_count, rawEvent?.signalCount, rawEvent?.signals)
  );

  return {
    eventId: String(firstDefined(rawEvent?.id, rawEvent?.event_id, rawEvent?.eventId) ?? "").trim(),
    title: String(firstDefined(rawEvent?.title, rawEvent?.headline, rawEvent?.name) ?? "Untitled event"),
    summary: String(
      firstDefined(rawEvent?.summary, rawEvent?.description, rawEvent?.title, rawEvent?.headline) ?? "Untitled event"
    ),
    category: String(firstDefined(rawEvent?.category, rawEvent?.subtype, rawEvent?.type) ?? "unknown"),
    severity: Number.isFinite(severityRaw) ? severityRaw : null,
    sourceTypes,
    sourceTypesRaw: sourceTypes.join(","),
    signalCount: Number.isFinite(signalCountRaw) ? signalCountRaw : 0,
    isActive: parseBooleanLike(firstDefined(rawEvent?.is_active, rawEvent?.isActive, rawEvent?.active), false),
    locationName: firstDefined(rawEvent?.location_name, rawEvent?.locationName, rawEvent?.location)
      ? String(firstDefined(rawEvent?.location_name, rawEvent?.locationName, rawEvent?.location))
      : null,
    country: rawEvent?.country ? String(rawEvent.country) : null,
    region: rawEvent?.region ? String(rawEvent.region) : null,
    lat: toOptionalNumber(firstDefined(rawEvent?.lat, rawEvent?.latitude)),
    lng: toOptionalNumber(firstDefined(rawEvent?.lng, rawEvent?.lon, rawEvent?.longitude)),
    createdAtIso,
    updatedAtIso,
    fetchedAtIso: nowIso
  };
}

export function normalizeNewsSignal(rawSignal: any, eventId: string): NormalizedNewsSignal | null {
  const signalId = String(firstDefined(rawSignal?.id, rawSignal?.signal_id, rawSignal?.signalId) ?? "").trim();
  if (!signalId) {
    return null;
  }

  const timestampIso = normalizeTimestamp(firstDefined(rawSignal?.timestamp, rawSignal?.time, rawSignal?.published_at));
  const createdAtIso = normalizeTimestamp(firstDefined(rawSignal?.created_at, rawSignal?.createdAt));
  return {
    signalId,
    eventId,
    sourceType: firstDefined(rawSignal?.source_type, rawSignal?.sourceType)
      ? String(firstDefined(rawSignal?.source_type, rawSignal?.sourceType))
      : null,
    sourceName: rawSignal?.source_name ? String(rawSignal.source_name) : null,
    sourceReliability: Number.isFinite(Number(rawSignal?.source_reliability))
      ? Number(rawSignal.source_reliability)
      : null,
    title: rawSignal?.title ? String(rawSignal.title) : null,
    content: rawSignal?.content ? String(rawSignal.content) : null,
    url: rawSignal?.url ? String(rawSignal.url) : null,
    timestampIso,
    createdAtIso,
    accountHandle: rawSignal?.account_handle ? String(rawSignal.account_handle) : null,
    tweetId: rawSignal?.tweet_id ? String(rawSignal.tweet_id) : null,
    mediaUrls: Array.isArray(rawSignal?.media_urls) ? rawSignal.media_urls.map((url) => String(url)) : [],
    fetchedAtIso: new Date().toISOString()
  };
}
