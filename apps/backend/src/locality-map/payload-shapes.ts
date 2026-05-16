export function extractVersionPayload(rawPayload: any) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return {};
  }
  if (rawPayload.cities != null || rawPayload.polygons != null) {
    return rawPayload;
  }

  const nestedCandidates = [
    rawPayload.data,
    rawPayload.payload,
    rawPayload.result,
    rawPayload.results,
    rawPayload.version,
    rawPayload.versions
  ];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object" && (candidate.cities != null || candidate.polygons != null)) {
      return candidate;
    }
  }
  return {};
}

export function extractCitiesPayload(rawPayload: any) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { cities: {}, areas: {} };
  }
  if (rawPayload.cities && typeof rawPayload.cities === "object") {
    return rawPayload;
  }

  const nestedCandidates = [rawPayload.data, rawPayload.payload, rawPayload.result];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object" && candidate.cities && typeof candidate.cities === "object") {
      return candidate;
    }
  }
  return { cities: {}, areas: {} };
}

export function extractPolygonsPayload(rawPayload: any) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return {};
  }

  if (rawPayload.polygons && typeof rawPayload.polygons === "object" && !Array.isArray(rawPayload.polygons)) {
    return rawPayload.polygons;
  }

  const nestedCandidates = [rawPayload.data, rawPayload.payload, rawPayload.result];
  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    if (candidate.polygons && typeof candidate.polygons === "object" && !Array.isArray(candidate.polygons)) {
      return candidate.polygons;
    }
    const keys = Object.keys(candidate);
    if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
      return candidate;
    }
  }

  const rawKeys = Object.keys(rawPayload);
  if (rawKeys.length > 0 && rawKeys.every((key) => /^\d+$/.test(key))) {
    return rawPayload;
  }
  return {};
}
