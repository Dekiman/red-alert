import path from "node:path";
import { readPayloadSnapshot, readVersionsCache, writePayloadSnapshot, writeVersionsCache } from "./cache.js";
import { buildCatalogLookupFromPayload, buildCatalogPayload, findMatchingLocalityIds } from "./catalog-builder.js";
import { fetchJsonWithTimeout } from "./fetch-json.js";
import { extractCitiesPayload, extractPolygonsPayload, extractVersionPayload } from "./payload-shapes.js";
import { buildVersionedUrl, parseVersion, uniqueSortedNumbers } from "./shared.js";

type LocalityMapCatalogOptions = {
  enabled?: boolean;
  listsVersionsUrl?: string;
  citiesBaseUrl?: string;
  polygonsBaseUrl?: string;
  fetchTimeoutMs?: number;
  defaultCitiesVersion?: number;
  defaultPolygonsVersion?: number;
  versionsCachePath?: string;
  snapshotPath?: string;
  logger?: any;
};

export function createLocalityMapCatalog({
  enabled = true,
  listsVersionsUrl = "https://api.tzevaadom.co.il/lists-versions",
  citiesBaseUrl = "https://www.tzevaadom.co.il/static/cities.json",
  polygonsBaseUrl = "https://www.tzevaadom.co.il/static/polygons.json",
  fetchTimeoutMs = 15000,
  defaultCitiesVersion = 10,
  defaultPolygonsVersion = 5,
  versionsCachePath = process.env.RED_ALERT_LOCALITY_MAP_VERSIONS_CACHE_PATH ??
    path.join(process.cwd(), "data", "locality-map-versions.json"),
  snapshotPath = process.env.RED_ALERT_LOCALITY_MAP_SNAPSHOT_PATH ??
    path.join(process.cwd(), "data", "locality-map-snapshot.json"),
  logger
}: LocalityMapCatalogOptions = {}) {
  const cachedVersions = readVersionsCache(versionsCachePath, logger);
  const snapshotPayloadCandidate = readPayloadSnapshot(snapshotPath, logger);
  const snapshotPayload =
    snapshotPayloadCandidate && Array.isArray(snapshotPayloadCandidate.localities) && snapshotPayloadCandidate.localities.length > 0
      ? snapshotPayloadCandidate
      : null;
  const snapshotLookup = snapshotPayload ? buildCatalogLookupFromPayload(snapshotPayload) : null;
  const snapshotVersions = {
    cities: parseVersion(snapshotPayload?.source?.citiesVersion, null),
    polygons: parseVersion(snapshotPayload?.source?.polygonsVersion, null)
  };
  const state = {
    status: enabled ? (snapshotPayload ? "ready" : "idle") : "disabled",
    payload: snapshotPayload,
    lookup: snapshotLookup,
    lastError: null,
    loadedAtIso: snapshotPayload?.loadedAtIso ?? null,
    lastKnownVersions: {
      cities: parseVersion(cachedVersions?.cities, snapshotVersions.cities),
      polygons: parseVersion(cachedVersions?.polygons, snapshotVersions.polygons)
    }
  };

  let refreshPromise;

  if (enabled && snapshotPayload) {
    logger?.info?.("locality map catalog hydrated from snapshot", {
      path: snapshotPath,
      localities: snapshotPayload.localities.length,
      areas: Array.isArray(snapshotPayload.areas) ? snapshotPayload.areas.length : 0,
      loadedAtIso: snapshotPayload.loadedAtIso ?? null
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

  function findLocalityIdsForLocations(locationNames = []) {
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
      } catch (error) {
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
        writeVersionsCache(versionsCachePath, state.lastKnownVersions, logger);
        writePayloadSnapshot(snapshotPath, built.payload, logger);
        logger?.info?.("locality map catalog loaded", {
          reason,
          localities: built.payload.localities.length,
          areas: built.payload.areas.length,
          citiesVersion,
          polygonsVersion,
          versionsSource
        });
      } catch (error) {
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
