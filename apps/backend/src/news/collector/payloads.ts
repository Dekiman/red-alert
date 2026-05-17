import { firstDefined } from "../../utils/primitives.js";
import { normalizeSourceTypeValue, parseSourceTypes } from "./normalizers.js";
import type { RealtimeTriggerTablesSet, SourceTypesSet } from "./types.js";

export function extractEventsPayload(rawPayload: any) {
  if (Array.isArray(rawPayload)) {
    return rawPayload;
  }
  if (!rawPayload || typeof rawPayload !== "object") {
    return [];
  }
  const candidates = [rawPayload.data, rawPayload.events, rawPayload.items, rawPayload.results, rawPayload.payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

export function extractSignalsPayload(rawPayload: any) {
  if (Array.isArray(rawPayload)) {
    return rawPayload;
  }
  if (!rawPayload || typeof rawPayload !== "object") {
    return [];
  }
  const candidates = [rawPayload.data, rawPayload.signals, rawPayload.items, rawPayload.results, rawPayload.payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

export function eventMatchesSourceFilter(rawEvent: any, includeSourceTypesSet: SourceTypesSet | null) {
  if (!includeSourceTypesSet || includeSourceTypesSet.size === 0) {
    return true;
  }
  const eventSourceTypes = parseSourceTypes(
    firstDefined(rawEvent?.source_types, rawEvent?.sourceTypes, rawEvent?.source_type, rawEvent?.sourceType)
  ).map((type) => normalizeSourceTypeValue(type));

  if (eventSourceTypes.length === 0) {
    return true;
  }
  return eventSourceTypes.some((type) => includeSourceTypesSet.has(type));
}

export function shouldRefreshFromRealtimeMessage(message: any, realtimeTriggerTablesSet: RealtimeTriggerTablesSet) {
  if (!message || typeof message !== "object") {
    return false;
  }
  const tableName = normalizeSourceTypeValue(firstDefined(message.table, message.channel, message.topic));
  if (!tableName) {
    return false;
  }
  return realtimeTriggerTablesSet.has(tableName);
}
