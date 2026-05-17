import { executeNewsCollectionPipeline } from "./collector/runtime.js";

export function createNewsRuntime(options) {
  const {
    config,
    database,
    logger,
    onNewsEvent
  } = options;

  let pollingTimer: any;

  async function runPipeline(reason: string) {
    try {
      await executeNewsCollectionPipeline({
        enabled: config.newsEnabled,
        englishOnly: config.newsEnglishOnly,
        includeWeatherEvents: config.newsIncludeWeather,
        pollMs: config.newsPollMs,
        fetchTimeoutMs: config.newsFetchTimeoutMs,
        maxSignalsPerEvent: config.newsMaxSignalsPerEvent,
        includeSourceTypes: config.newsSourceTypes,
        providerNames: config.newsProviders,
        maxEventsPerProvider: config.newsMaxEventsPerProvider,
        gdacsApiUrl: config.newsGdacsApiUrl,
        gdacsLookbackDays: config.newsGdacsLookbackDays,
        usgsApiUrl: config.newsUsgsApiUrl,
        gdeltApiUrl: config.newsGdeltApiUrl,
        gdeltQuery: config.newsGdeltQuery,
        gdeltMaxRecords: config.newsGdeltMaxRecords,
        nwsApiUrl: config.newsNwsApiUrl,
        weatherCanadaApiUrl: config.newsWeatherCanadaApiUrl,
        meteoalarmApiUrl: config.newsMeteoalarmApiUrl,
        database,
        onNewsEvent
      }, reason);
    } catch (error: any) {
      logger.error("news collection pipeline execution failed", { error: error?.message });
    }
  }

  function start() {
    if (!config.newsEnabled) {
      logger.info("live news collector disabled by config");
      return;
    }

    if (pollingTimer) {
      return;
    }

    logger.info("starting live news collection runner", { pollMs: config.newsPollMs });
    
    // Initial run
    void runPipeline("startup");

    pollingTimer = setInterval(() => {
      void runPipeline("poll");
    }, config.newsPollMs);
  }

  function stop() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = undefined;
      logger.info("stopped live news collection runner");
    }
  }

  async function refreshOnce(reason: string) {
    if (!config.newsEnabled) {
      return;
    }
    await runPipeline(reason);
  }

  return {
    start,
    stop,
    refreshOnce
  };
}
