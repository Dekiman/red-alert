import { createLocalityMapCatalog } from "../locality-map.js";

export function createLocalityMapRuntime(options) {
  const { config, logger } = options;

  let localityMapCatalog;
  let localityMapRefreshTimer;

  async function refresh(reason) {
    if (!localityMapCatalog) {
      return;
    }

    try {
      await localityMapCatalog.refresh(reason);
    } catch (error) {
      logger.error("locality map refresh failed", {
        reason,
        error: error?.message
      });
    }
  }

  async function start(kv: KVNamespace) {
    if (!config.localityMapEnabled) {
      logger.info("locality map catalog disabled");
      return;
    }

    localityMapCatalog = await createLocalityMapCatalog({
      kv,
      enabled: config.localityMapEnabled,
      listsVersionsUrl: config.localityMapListsVersionsUrl,
      citiesBaseUrl: config.localityMapCitiesUrl,
      polygonsBaseUrl: config.localityMapPolygonsUrl,
      fetchTimeoutMs: config.localityMapFetchTimeoutMs,
      defaultCitiesVersion: config.localityMapDefaultCitiesVersion,
      defaultPolygonsVersion: config.localityMapDefaultPolygonsVersion,
      logger
    });

    void refresh("startup");

    if (config.localityMapRefreshMs > 0) {
      localityMapRefreshTimer = setInterval(() => {
        void refresh("interval_refresh");
      }, config.localityMapRefreshMs);
      logger.info("locality map refresh timer started", {
        refreshMs: config.localityMapRefreshMs
      });
    }
  }

  function stop() {
    if (localityMapRefreshTimer) {
      clearInterval(localityMapRefreshTimer);
      localityMapRefreshTimer = undefined;
      logger.info("cleared locality map refresh timer");
    }

    localityMapCatalog = undefined;
  }

  function findLocalityIdsForLocations(locations) {
    if (!localityMapCatalog || !Array.isArray(locations) || locations.length === 0) {
      return [];
    }

    try {
      return localityMapCatalog.findLocalityIdsForLocations(locations);
    } catch (error) {
      logger.warn("failed mapping alert locations to locality ids", {
        error: error?.message
      });
      return [];
    }
  }

  function getPayload() {
    return localityMapCatalog?.getPayload?.() ?? null;
  }

  function getStatus() {
    return (
      localityMapCatalog?.getStatus?.() ?? {
        enabled: config.localityMapEnabled,
        status: "uninitialized",
        loadedAtIso: null,
        hasPayload: false,
        lastError: "catalog not initialized"
      }
    );
  }

  return {
    start,
    stop,
    refresh,
    getStatus,
    getPayload,
    findLocalityIdsForLocations
  };
}
