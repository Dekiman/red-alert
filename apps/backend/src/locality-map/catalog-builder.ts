import { normalizeLocationText, uniqueSortedNumbers } from "./shared.js";

function addAlias(lookupMap: Map<string, Set<number>>, aliasValue: unknown, localityId: number) {
  const normalized = normalizeLocationText(aliasValue);
  if (!normalized || normalized.length < 2) {
    return;
  }
  let ids = lookupMap.get(normalized);
  if (!ids) {
    ids = new Set();
    lookupMap.set(normalized, ids);
  }
  ids.add(localityId);
}

function buildLookupFromLocalities(localities: any[] = []) {
  const aliasLookup = new Map<string, Set<number>>();

  for (const locality of localities) {
    const localityId = Number(locality?.id);
    if (!Number.isFinite(localityId)) {
      continue;
    }

    addAlias(aliasLookup, locality?.key, localityId);
    addAlias(aliasLookup, locality?.he, localityId);
    addAlias(aliasLookup, locality?.en, localityId);
  }

  const aliasToIds = new Map<string, number[]>();
  for (const [alias, ids] of aliasLookup.entries()) {
    aliasToIds.set(alias, uniqueSortedNumbers(Array.from(ids)));
  }

  const aliasesByLength = Array.from(aliasToIds.keys())
    .filter((alias) => alias.length >= 5)
    .sort((a, b) => b.length - a.length);

  return {
    aliasToIds,
    aliasesByLength
  };
}

function sanitizePolygon(rawPolygon: any) {
  if (!Array.isArray(rawPolygon)) {
    return [];
  }

  const points = [];
  for (const point of rawPolygon) {
    const lat = Number(point?.[0]);
    const lng = Number(point?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    points.push([lat, lng]);
  }
  return points;
}

export function buildCatalogPayload(citiesJson: any, polygonsJson: any, sourceMeta: Record<string, unknown>) {
  const areas = [];
  const rawAreas: Record<string, any> = citiesJson?.areas ?? {};
  for (const [areaIdRaw, areaValue] of Object.entries(rawAreas)) {
    const parsedAreaId = Number(areaIdRaw);
    if (!Number.isFinite(parsedAreaId)) {
      continue;
    }
    areas.push({
      id: parsedAreaId,
      he: String(areaValue?.he ?? ""),
      en: String(areaValue?.en ?? ""),
      ar: String(areaValue?.ar ?? ""),
      ru: String(areaValue?.ru ?? ""),
      es: String(areaValue?.es ?? "")
    });
  }
  areas.sort((a, b) => a.id - b.id);

  const localities = [];
  const aliasLookup = new Map<string, Set<number>>();
  const rawCities: Record<string, any> = citiesJson?.cities ?? {};
  for (const [cityKey, cityValue] of Object.entries(rawCities)) {
    const localityId = Number(cityValue?.id);
    if (!Number.isFinite(localityId)) {
      continue;
    }

    const areaId = Number(cityValue?.area);
    const lat = Number(cityValue?.lat);
    const lng = Number(cityValue?.lng);
    const countdown = Number(cityValue?.countdown);
    const polygon = sanitizePolygon(polygonsJson?.[String(localityId)]);

    const locality = {
      id: localityId,
      key: String(cityKey),
      he: String(cityValue?.he ?? cityKey),
      en: String(cityValue?.en ?? cityKey),
      areaId: Number.isFinite(areaId) ? areaId : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      countdown: Number.isFinite(countdown) ? countdown : null,
      polygon
    };
    localities.push(locality);

    addAlias(aliasLookup, locality.key, locality.id);
    addAlias(aliasLookup, locality.he, locality.id);
    addAlias(aliasLookup, locality.en, locality.id);
  }

  localities.sort((a, b) => a.id - b.id);

  const payload = {
    loadedAtIso: new Date().toISOString(),
    source: sourceMeta,
    areas,
    localities
  };

  return {
    payload,
    lookup: buildLookupFromLocalities(localities)
  };
}

export function buildCatalogLookupFromPayload(payload: any) {
  return buildLookupFromLocalities(Array.isArray(payload?.localities) ? payload.localities : []);
}

export function findMatchingLocalityIds(locationName: string, lookup: any) {
  if (!lookup) {
    return [];
  }

  const normalized = normalizeLocationText(locationName);
  if (!normalized) {
    return [];
  }

  const direct = lookup.aliasToIds.get(normalized);
  if (direct && direct.length > 0) {
    return direct;
  }

  const matchedIds = new Set<number>();
  for (const alias of lookup.aliasesByLength) {
    if (!normalized.includes(alias) && !alias.includes(normalized)) {
      continue;
    }
    const ids = lookup.aliasToIds.get(alias) ?? [];
    for (const id of ids) {
      matchedIds.add(id);
    }
    if (matchedIds.size >= 30) {
      break;
    }
  }

  return uniqueSortedNumbers(Array.from(matchedIds));
}
