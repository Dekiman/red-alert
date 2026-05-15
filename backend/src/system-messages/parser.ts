import { coerceStringArray } from "../alerts/payload-utils.js";
import { dedupeStrings, firstDefined, isObjectLike } from "../utils/primitives.js";

const SYSTEM_MESSAGE_SAFE_PATTERNS = [
  "incident ended",
  "all clear",
  "safe to go out",
  "can leave shelter",
  "return to routine",
  "event ended",
  "threat removed",
  "ניתן לצאת",
  "אפשר לצאת",
  "האירוע הסתיים",
  "סיום אירוע",
  "חזרה לשגרה"
];

const SYSTEM_MESSAGE_PRE_ALERT_PATTERNS = [
  "in the next few minutes",
  "next few minutes",
  "alerts are expected",
  "siren might go off",
  "be prepared",
  "stay near shelter",
  "pre-alert",
  "pre alert",
  "בדקות הקרובות",
  "ייתכנו אזעקות",
  "בסמיכות למרחב מוגן",
  "אין צורך להיכנס למרחב מוגן"
];

function tryParseObjectLike(value) {
  if (isObjectLike(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isObjectLike(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function collectNestedPayloads(payload) {
  const directPayload = tryParseObjectLike(payload);
  if (!directPayload) {
    return [];
  }

  const nestedValues = [
    directPayload,
    directPayload.data,
    directPayload.data?.data,
    directPayload.payload,
    directPayload.payload?.data
  ];
  const nestedPayloads = [];
  for (const nestedValue of nestedValues) {
    const parsedNested = tryParseObjectLike(nestedValue);
    if (!parsedNested) {
      continue;
    }
    nestedPayloads.push(parsedNested);
  }
  return nestedPayloads;
}

function toNumberArray(values) {
  if (Array.isArray(values)) {
    return values
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.floor(item));
  }

  if (typeof values === "string") {
    return values
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.floor(item));
  }

  const numericValue = Number(values);
  if (Number.isFinite(numericValue)) {
    return [Math.floor(numericValue)];
  }

  return [];
}

function uniqueSortedNumbers(values) {
  const numericValues = values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item));
  return Array.from(new Set(numericValues)).sort((a, b) => Number(a) - Number(b));
}

function inferSystemMessageLocationsFromTextParts(textParts, getLocalityMapIdsForLocations) {
  if (!Array.isArray(textParts) || textParts.length === 0 || typeof getLocalityMapIdsForLocations !== "function") {
    return {
      names: [],
      ids: []
    };
  }

  const inferredNames = [];
  const inferredIds = new Set();
  for (const textPart of textParts) {
    if (typeof textPart !== "string" || !textPart.trim()) {
      continue;
    }

    const candidateChunks = String(textPart)
      .split(/[\n,;|]/g)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length >= 2 && chunk.length <= 80);

    for (const candidateChunk of candidateChunks) {
      const ids = getLocalityMapIdsForLocations([candidateChunk]);
      if (!Array.isArray(ids) || ids.length === 0) {
        continue;
      }

      inferredNames.push(candidateChunk);
      for (const id of ids) {
        inferredIds.add(id);
      }
    }
  }

  return {
    names: dedupeStrings(inferredNames),
    ids: uniqueSortedNumbers(Array.from(inferredIds))
  };
}

export function collectSystemMessageTextParts(payload) {
  if (payload == null) {
    return [];
  }
  if (typeof payload === "string") {
    const parsed = tryParseObjectLike(payload);
    if (!parsed) {
      return [payload];
    }
    return collectSystemMessageTextParts(parsed);
  }
  if (!isObjectLike(payload)) {
    return [String(payload)];
  }

  const textParts = [];
  const directFields = [
    payload.titleEn,
    payload.title,
    payload.titleHe,
    payload.titleAr,
    payload.titleRu,
    payload.titleEs,
    payload.bodyEn,
    payload.body,
    payload.bodyHe,
    payload.bodyAr,
    payload.bodyRu,
    payload.bodyEs,
    payload.text,
    payload.message,
    payload.description,
    payload.instruction
  ];
  for (const value of directFields) {
    if (typeof value === "string" && value.trim()) {
      textParts.push(value);
    }
  }

  const nestedData = tryParseObjectLike(payload.data);
  if (nestedData) {
    const nestedFields = [
      nestedData.title,
      nestedData.titleEn,
      nestedData.titleHe,
      nestedData.body,
      nestedData.bodyEn,
      nestedData.bodyHe,
      nestedData.text,
      nestedData.message
    ];
    for (const value of nestedFields) {
      if (typeof value === "string" && value.trim()) {
        textParts.push(value);
      }
    }
  }

  return dedupeStrings(textParts);
}

export function extractSystemMessageLocationIds(payload) {
  const nestedPayloads = collectNestedPayloads(payload);
  if (nestedPayloads.length === 0) {
    return [];
  }

  const idFields = [
    "locationIds",
    "localityIds",
    "ids",
    "polygonIds",
    "areaIds",
    "zoneIds",
    "cityIds",
    "citiesIds",
    "citiesIDs",
    "location_ids",
    "locality_ids",
    "city_ids"
  ];

  for (const nestedPayload of nestedPayloads) {
    for (const idField of idFields) {
      const parsed = toNumberArray(nestedPayload?.[idField]);
      if (parsed.length > 0) {
        return Array.from(new Set(parsed));
      }
    }
  }

  return [];
}

export function extractSystemMessageLocationNames(payload) {
  const nestedPayloads = collectNestedPayloads(payload);
  if (nestedPayloads.length === 0) {
    return [];
  }

  const arrayFields = [
    "cities",
    "locations",
    "localities",
    "areas",
    "locationNames",
    "cityNames",
    "areaNames",
    "citiesNames",
    "location_names",
    "city_names"
  ];
  const singleFields = [
    "location",
    "locationName",
    "area",
    "areaName",
    "locality",
    "localityName",
    "city",
    "cityName"
  ];

  const locationNames = [];
  for (const nestedPayload of nestedPayloads) {
    for (const arrayField of arrayFields) {
      const parsed = coerceStringArray(nestedPayload?.[arrayField]);
      if (parsed && parsed.length > 0) {
        locationNames.push(...parsed);
      }
    }
    for (const singleField of singleFields) {
      const value = nestedPayload?.[singleField];
      if (typeof value === "string" && value.trim()) {
        locationNames.push(value.trim());
      }
    }
  }

  return dedupeStrings(locationNames);
}

export function classifySystemMessageKind(payload, textParts) {
  const explicitHints = [
    payload?.kind,
    payload?.instructionType,
    payload?.code,
    payload?.type,
    payload?.instruction
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (
    explicitHints.includes("safe") ||
    explicitHints.includes("all_clear") ||
    explicitHints.includes("incident_ended")
  ) {
    return "safe_to_go_out";
  }
  if (
    explicitHints.includes("pre") ||
    explicitHints.includes("prepare") ||
    explicitHints.includes("early_warning")
  ) {
    return "pre_alert";
  }

  const textBlob = textParts.join(" | ").toLowerCase();
  if (SYSTEM_MESSAGE_SAFE_PATTERNS.some((pattern) => textBlob.includes(pattern))) {
    return "safe_to_go_out";
  }
  if (SYSTEM_MESSAGE_PRE_ALERT_PATTERNS.some((pattern) => textBlob.includes(pattern))) {
    return "pre_alert";
  }
  return "other";
}

export function createSystemMessageNormalizer(getLocalityMapIdsForLocations) {
  return function normalizeSystemMessageForUi(rawPayload, source) {
    const payload =
      tryParseObjectLike(rawPayload) ?? (isObjectLike(rawPayload) ? rawPayload : { text: String(rawPayload ?? "") });
    const textParts = collectSystemMessageTextParts(payload);
    const title = firstDefined(payload.titleEn, payload.title, payload.titleHe, payload.data?.title) ?? "";
    const body = firstDefined(payload.bodyEn, payload.body, payload.bodyHe, payload.data?.body) ?? "";
    let locationNames = extractSystemMessageLocationNames(payload);
    const explicitLocationIds = extractSystemMessageLocationIds(payload);
    let locationIds =
      explicitLocationIds.length > 0 ? explicitLocationIds : getLocalityMapIdsForLocations(locationNames);

    if (locationNames.length === 0 && locationIds.length === 0) {
      const inferred = inferSystemMessageLocationsFromTextParts(
        [String(title || ""), String(body || ""), ...textParts],
        getLocalityMapIdsForLocations
      );
      if (inferred.names.length > 0) {
        locationNames = inferred.names;
      }
      if (inferred.ids.length > 0) {
        locationIds = inferred.ids;
      }
    }

    const kind = classifySystemMessageKind(payload, textParts);

    return {
      source,
      kind,
      instruction: payload.instruction != null ? String(payload.instruction) : null,
      title: String(title || ""),
      body: String(body || ""),
      textParts,
      locationNames,
      locationIds,
      receivedAtIso: new Date().toISOString()
    };
  };
}
