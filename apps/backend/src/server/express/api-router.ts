import express from "express";

function createRequestUrl(req, fallbackPath) {
  const host = req.headers.host ?? "localhost";
  const requestPath = req.originalUrl || req.url || fallbackPath;
  return new URL(requestPath, `http://${host}`);
}

function writeNoStore(response) {
  response.setHeader("Cache-Control", "no-store");
}

function parseIntegerQueryValue(value) {
  if (Array.isArray(value)) {
    return parseIntegerQueryValue(value[0]);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function parseStringListQueryValue(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseStringListQueryValue(item));
  }
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerListQueryValue(value) {
  return parseStringListQueryValue(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item));
}

export function createApiRouter(options) {
  const {
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
  } = options;

  const router = express.Router();

  router.get("/localities-map/status", (_req, res) => {
    writeNoStore(res);
    res.status(200).json(getLocalityMapStatus());
  });

  router.get("/localities-map", (_req, res) => {
    const payload = getLocalityMapPayload();
    const status = getLocalityMapStatus();
    writeNoStore(res);

    if (!payload) {
      res.status(503).json({
        ok: false,
        error: "locality map data unavailable",
        status: status?.status ?? "unavailable",
        loadedAtIso: status?.loadedAtIso ?? null,
        lastError: status?.lastError ?? null
      });
      return;
    }

    res.status(200).json(payload);
  });

  router.get("/polygon-states/current", (req, res) => {
    const windowMinutes = parseIntegerQueryValue(req.query?.windowMinutes);
    const alertLimit = parseIntegerQueryValue(req.query?.alertLimit);
    const nowMs = parseIntegerQueryValue(req.query?.nowMs);

    const payload = getCurrentPolygonStates({
      windowMinutes: windowMinutes ?? undefined,
      alertLimit: alertLimit ?? undefined,
      nowMs: nowMs ?? undefined
    });

    writeNoStore(res);
    if (!payload) {
      res.status(503).json({
        ok: false,
        error: "polygon state inference unavailable"
      });
      return;
    }

    res.status(200).json(payload);
  });

  router.get("/polygon-states/replay", (req, res) => {
    const rangeMinutes = parseIntegerQueryValue(req.query?.rangeMinutes);
    const stateWindowMinutes = parseIntegerQueryValue(req.query?.stateWindowMinutes);
    const alertLimit = parseIntegerQueryValue(req.query?.alertLimit);
    const nowMs = parseIntegerQueryValue(req.query?.nowMs);

    const payload = getPolygonReplayTimeline({
      rangeMinutes: rangeMinutes ?? undefined,
      stateWindowMinutes: stateWindowMinutes ?? undefined,
      alertLimit: alertLimit ?? undefined,
      nowMs: nowMs ?? undefined
    });

    writeNoStore(res);
    if (!payload) {
      res.status(503).json({
        ok: false,
        error: "polygon replay timeline unavailable"
      });
      return;
    }

    res.status(200).json(payload);
  });

  router.get("/live-news", (req, res) => {
    const limit = parseIntegerQueryValue(req.query?.limit);
    const fromUnix = parseIntegerQueryValue(req.query?.fromUnix);
    const toUnix = parseIntegerQueryValue(req.query?.toUnix);
    const eventTypes = parseStringListQueryValue(req.query?.eventTypes);
    const severities = parseIntegerListQueryValue(req.query?.severities);
    const payload = getLiveNewsFeed({
      limit: limit ?? undefined,
      fromUnix: fromUnix ?? undefined,
      toUnix: toUnix ?? undefined,
      eventTypes,
      severities
    });

    writeNoStore(res);
    if (!payload) {
      res.status(503).json({
        ok: false,
        error: "live news feed unavailable"
      });
      return;
    }

    res.status(200).json(payload);
  });

  router.get("/boundary-details", async (req, res) => {
    const countryName = String(req.query?.countryName ?? "").trim();
    const level = String(req.query?.level ?? "ADM1").trim().toUpperCase();
    writeNoStore(res);

    if (!countryName) {
      res.status(400).json({
        ok: false,
        error: "countryName query parameter is required"
      });
      return;
    }

    const payload = await getBoundaryDetail({
      countryName,
      level
    });

    if (!payload) {
      res.status(404).json({
        ok: false,
        error: "boundary detail unavailable",
        countryName,
        level
      });
      return;
    }

    res.status(200).json(payload);
  });

  router.all("/mock-alert", (req, res) => {
    if (!config.enableMockApi) {
      res.status(404).json({ ok: false, error: "mock api disabled" });
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      res.status(405).json({ ok: false, error: "method not allowed" });
      return;
    }

    const requestUrl = createRequestUrl(req, "/api/mock-alert");
    const mockAlert = createMockAlert(requestUrl);
    const published = publishAlert(mockAlert, "mock_api");
    if (!published) {
      logger.warn("mock alert did not publish", {
        notificationId: mockAlert.notificationId,
        locations: mockAlert.cities.length
      });
      res.status(409).json({
        ok: false,
        error: "mock alert not published",
        notificationId: mockAlert.notificationId
      });
      return;
    }

    logger.info("mock alert published", {
      notificationId: published.notificationId,
      locations: published.locationCount
    });
    writeNoStore(res);
    res.status(201).json({
      ok: true,
      alert: published
    });
  });

  router.all("/mock-system-message", (req, res) => {
    if (!config.enableMockApi) {
      res.status(404).json({ ok: false, error: "mock api disabled" });
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      res.status(405).json({ ok: false, error: "method not allowed" });
      return;
    }

    const requestUrl = createRequestUrl(req, "/api/mock-system-message");
    const mockSystemMessage = createMockSystemMessage(requestUrl);
    const published = publishSystemMessage(mockSystemMessage, "mock_api");

    logger.info("mock system message published", {
      kind: published.kind,
      locationNames: published.locationNames.length,
      locationIds: published.locationIds.length
    });
    writeNoStore(res);
    res.status(201).json({
      ok: true,
      systemMessage: published
    });
  });

  return router;
}
