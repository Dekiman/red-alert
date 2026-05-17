import { readPayloadSnapshot, readVersionsCache, writePayloadSnapshot, writeVersionsCache } from "./cache.js";
import { buildCatalogLookupFromPayload, buildCatalogPayload, findMatchingLocalityIds } from "./catalog-builder.js";
import { fetchJsonWithTimeout } from "./fetch-json.js";
import { extractCitiesPayload, extractPolygonsPayload, extractVersionPayload } from "./payload-shapes.js";
import { buildVersionedUrl, parseVersion, uniqueSortedNumbers } from "./shared.js";

type LocalityMapCatalogOptions = {
  kv: KVNamespace;
  enabled?: boolean;
  listsVersionsUrl?: string;
  citiesBaseUrl?: string;
  polygonsBaseUrl?: string;
  fetchTimeoutMs?: number;
  defaultCitiesVersion?: number;
  defaultPolygonsVersion?: number;
  logger?: any;
};

export async function createLocalityMapCatalog({
  kv,
  enabled = true,
  listsVersionsUrl = "https://api.tzevaadom.co.il/lists-versions",
  citiesBaseUrl = "https://www.tzevaadom.co.il/static/cities.json",
  polygonsBaseUrl = "https://www.tzevaadom.co.il/static/polygons.json",
  fetchTimeoutMs = 15000,
  defaultCitiesVersion = 10,
  defaultPolygonsVersion = 5,
  logger
}: LocalityMapCatalogOptions) {
  const cachedVersions = await readVersionsCache(kv, logger);
  const snapshotPayloadCandidate = await readPayloadSnapshot(kv, logger);
  const snapshotPayload =
    snapshotPayloadCandidate && Array.isArray((snapshotPayloadCandidate as any).localities) && (snapshotPayloadCandidate as any).localities.length > 0
      ? snapshotPayloadCandidate
      : null;
  const snapshotLookup = snapshotPayload ? buildCatalogLookupFromPayload(snapshotPayload) : null;
  const snapshotVersions = {
    cities: parseVersion((snapshotPayload as any)?.source?.citiesVersion, null),
    polygons: parseVersion((snapshotPayload as any)?.source?.polygonsVersion, null)
  };
  const state = {
    status: enabled ? (snapshotPayload ? "ready" : "idle") : "disabled",
    payload: snapshotPayload as any,
    lookup: snapshotLookup,
    lastError: null as string | null,
    loadedAtIso: (snapshotPayload as any)?.loadedAtIso ?? null,
    lastKnownVersions: {
      cities: parseVersion(cachedVersions?.cities, snapshotVersions.cities),
      polygons: parseVersion(cachedVersions?.polygons, snapshotVersions.polygons)
    }
  };

  let refreshPromise: Promise<any> | undefined;

  if (enabled && snapshotPayload) {
    logger?.info?.("locality map catalog hydrated from snapshot", {
      localities: (snapshotPayload as any).localities.length,
      areas: Array.isArray((snapshotPayload as any).areas) ? (snapshotPayload as any).areas.length : 0,
      loadedAtIso: (snapshotPayload as any).loadedAtIso ?? null
    });
  }

  function getStatus() {
    return {
      enabled,
      status: state.status,
      loadedAtIso: state.loadedAtIso,
      hasPayload: Boolean(state.payload),
      lastError: state.lastError
    };
  }

  function getPayload() {
    return state.payload;
  }

  function findLocalityIdsForLocations(locationNames: string[] = []) {
    if (!enabled || !state.lookup || !Array.isArray(locationNames) || locationNames.length === 0) {
      return [];
    }

    const resolved = new Set<number>();
    for (const locationName of locationNames) {
      const ids = findMatchingLocalityIds(locationName, state.lookup);
      for (const id of ids) {
        resolved.add(id);
      }
    }
    return uniqueSortedNumbers(Array.from(resolved));
  }

  async function refresh(reason = "manual") {
    if (!enabled) {
      return getStatus();
    }

    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      state.status = "loading";
      state.lastError = null;
      logger?.info?.("refreshing locality map catalog", { reason, listsVersionsUrl });

      let versions: any = {};
      try {
        versions = extractVersionPayload(await fetchJsonWithTimeout(listsVersionsUrl, fetchTimeoutMs));
      } catch (error: any) {
        logger?.warn?.("failed to fetch locality map versions; using fallback versions", {
          reason,
          error: error?.message,
          cachedCitiesVersion: state.lastKnownVersions?.cities,
          cachedPolygonsVersion: state.lastKnownVersions?.polygons,
          defaultCitiesVersion,
          defaultPolygonsVersion
        });
      }

      const citiesVersion = parseVersion(
        versions?.cities,
        parseVersion(state.lastKnownVersions?.cities, defaultCitiesVersion)
      );
      const polygonsVersion = parseVersion(
        versions?.polygons,
        parseVersion(state.lastKnownVersions?.polygons, defaultPolygonsVersion)
      );
      const citiesUrl = buildVersionedUrl(citiesBaseUrl, citiesVersion);
      const polygonsUrl = buildVersionedUrl(polygonsBaseUrl, polygonsVersion);
      const versionsSource =
        versions?.cities != null || versions?.polygons != null
          ? "remote"
          : state.lastKnownVersions?.cities != null || state.lastKnownVersions?.polygons != null
            ? "cache"
            : "default";

      try {
        const [citiesJsonRaw, polygonsJsonRaw] = await Promise.all([
          fetchJsonWithTimeout(citiesUrl, fetchTimeoutMs),
          fetchJsonWithTimeout(polygonsUrl, fetchTimeoutMs)
        ]);
        const citiesJson = extractCitiesPayload(citiesJsonRaw);
        const polygonsJson = extractPolygonsPayload(polygonsJsonRaw);

        const sourceMeta = {
          listsVersionsUrl,
          citiesUrl,
          polygonsUrl,
          citiesVersion,
          polygonsVersion,
          versionsSource,
          payloadCitiesVersion: parseVersion(citiesJson?.["@VERSION"], null),
          payloadPolygonsVersion: parseVersion(polygonsJsonRaw?.["@VERSION"], null)
        };

        const built = buildCatalogPayload(citiesJson, polygonsJson, sourceMeta);
        if (built.payload.localities.length === 0) {
          throw new Error("locality catalog is empty after parsing upstream payloads");
        }
        state.payload = built.payload;
        state.lookup = built.lookup;
        state.status = "ready";
        state.loadedAtIso = built.payload.loadedAtIso;
        state.lastError = null;
        state.lastKnownVersions = {
          cities: citiesVersion,
          polygons: polygonsVersion
        };
        await writeVersionsCache(kv, state.lastKnownVersions, logger);
        await writePayloadSnapshot(kv, built.payload, logger);
        logger?.info?.("locality map catalog loaded", {
          reason,
          localities: built.payload.localities.length,
          areas: built.payload.areas.length,
          citiesVersion,
          polygonsVersion,
          versionsSource
        });
      } catch (error: any) {
        state.status = state.payload ? "stale" : "error";
        state.lastError = error?.message ?? "unknown error";
        logger?.error?.("failed to refresh locality map catalog", {
          reason,
          citiesUrl,
          polygonsUrl,
          error: error?.message
        });
      }

      return getStatus();
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = undefined;
    }
  }

  return {
    getStatus,
    getPayload,
    findLocalityIdsForLocations,
    refresh
  };
}
