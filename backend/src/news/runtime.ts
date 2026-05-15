import { createLiveNewsCollector } from "../live-news-collector.js";

export function createNewsRuntime(options) {
  const {
    config,
    database,
    logger,
    onNewsEvent
  } = options;

  let liveNewsCollector;

  function start() {
    if (!config.newsEnabled) {
      logger.info("live news collector disabled");
      return;
    }

    liveNewsCollector = createLiveNewsCollector({
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
    });

    liveNewsCollector.start();
  }

  function stop() {
    if (!liveNewsCollector) {
      return;
    }

    try {
      liveNewsCollector.stop();
    } catch (error) {
      logger.warn("error while stopping live news collector", {
        error: error?.message
      });
    } finally {
      liveNewsCollector = undefined;
    }
  }

  return {
    start,
    stop
  };
}
