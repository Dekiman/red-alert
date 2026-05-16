import type { NewsEventPayload } from "./contracts.js";

function normalizeSourceTypeValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toOptionalCoordinate(value: unknown) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getNewsSourceTypeSet(newsEvent: Partial<NewsEventPayload> | null | undefined) {
  const sourceTypes = new Set<string>();

  for (const sourceType of Array.isArray(newsEvent?.sourceTypes) ? newsEvent.sourceTypes : []) {
    const normalized = normalizeSourceTypeValue(sourceType);
    if (normalized) {
      sourceTypes.add(normalized);
    }
  }

  for (const sourceType of String(newsEvent?.sourceTypesRaw ?? "")
    .split(",")
    .map((part) => normalizeSourceTypeValue(part))) {
    if (sourceType) {
      sourceTypes.add(sourceType);
    }
  }

  return sourceTypes;
}

export function getExplicitNewsCoordinates(newsEvent: Partial<NewsEventPayload> | null | undefined) {
  const latitude = toOptionalCoordinate(newsEvent?.lat);
  const longitude = toOptionalCoordinate(newsEvent?.lng);
  if (latitude == null || longitude == null) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude
  };
}

export function hasExplicitNewsCoordinates(newsEvent: Partial<NewsEventPayload> | null | undefined) {
  return getExplicitNewsCoordinates(newsEvent) != null;
}

export function usesPublisherCountryFallback(newsEvent: Partial<NewsEventPayload> | null | undefined) {
  return getNewsSourceTypeSet(newsEvent).has("gdelt") && !hasExplicitNewsCoordinates(newsEvent);
}

export function sanitizeNewsEventLocationFields(newsEvent: NewsEventPayload): NewsEventPayload {
  if (!usesPublisherCountryFallback(newsEvent)) {
    return newsEvent;
  }

  return {
    ...newsEvent,
    locationName: null,
    country: null,
    region: null
  };
}
