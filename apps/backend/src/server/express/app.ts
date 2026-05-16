import express from "express";
import { createApiRouter } from "./api-router.js";
import { createFrontendRouter } from "./frontend-router.js";

export function createExpressApp(options) {
  const {
    config,
    logger,
    getLocalityMapStatus,
    getLocalityMapPayload,
    getCurrentPolygonStates,
    getPolygonReplayTimeline,
    getLiveNewsFeed,
    getBoundaryDetail,
    getHealthPayload,
    createMockAlert,
    publishAlert,
    createMockSystemMessage,
    publishSystemMessage
  } = options;

  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.status(200).json(getHealthPayload());
  });

  app.use(
    "/api",
    createApiRouter({
      config,
      logger,
      getLocalityMapStatus,
      getLocalityMapPayload,
      getCurrentPolygonStates,
      getPolygonReplayTimeline,
      getLiveNewsFeed,
      getBoundaryDetail,
      createMockAlert,
      publishAlert,
      createMockSystemMessage,
      publishSystemMessage
    })
  );

  app.use(
    createFrontendRouter({
      config,
      logger
    })
  );

  return app;
}
