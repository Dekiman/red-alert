import { Hono } from 'hono';
import { parseEnv, type Env } from '../env.js';
import { initDatabase } from '../db.js';
import { createAppConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createLocalityMapRuntime } from '../locality-map/runtime.js';
import { createBoundaryDetailService } from '../boundary-detail/service.js';
import { createPolygonStateService } from '../polygon-state/service.js';
import { createNewsRuntime } from '../news/runtime.js';

function parseIntegerQueryValue(value: string | string[] | undefined): number | null {
  if (Array.isArray(value)) {
    return parseIntegerQueryValue(value[0]);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function parseStringListQueryValue(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseStringListQueryValue(item));
  }
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerListQueryValue(value: string | string[] | undefined): number[] {
  return parseStringListQueryValue(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item));
}

let dbInstance: any = null;
let configInstance: any = null;
let localityMapRuntime: any = null;
let boundaryDetailService: any = null;
let polygonStateService: any = null;

async function getServices(env: Env) {
  if (!configInstance) {
    const logger = createLogger("app");
    configInstance = createAppConfig(env, logger);
  }
  if (!dbInstance) {
    dbInstance = initDatabase({ kv: env.ALERTS_KV, includeWeatherNews: configInstance.newsIncludeWeather, englishOnlyNews: configInstance.newsEnglishOnly });
  }
  if (!localityMapRuntime) {
    const logger = createLogger("locality-map");
    localityMapRuntime = createLocalityMapRuntime({ config: configInstance, logger });
    await localityMapRuntime.start(env.CACHE_KV);
  }
  if (!boundaryDetailService) {
    const logger = createLogger("boundary-detail");
    boundaryDetailService = createBoundaryDetailService({ kv: env.CACHE_KV, logger });
  }
  if (!polygonStateService) {
    const logger = createLogger("polygon-state");
    polygonStateService = createPolygonStateService({
      getDatabase: () => dbInstance,
      getLocalityMapIdsForLocations: (locs: string[]) => localityMapRuntime.findLocalityIdsForLocations(locs),
      logger
    });
  }

  return {
    db: dbInstance,
    config: configInstance,
    localityMapRuntime,
    boundaryDetailService,
    polygonStateService
  };
}

const api = new Hono<{ Bindings: Env }>()
  .get('/health', (c) => {
    const env = parseEnv(c.env);
    return c.json({ ok: true, timezone: env.RED_ALERT_TIMEZONE });
  })
  .get('/localities-map/status', async (c) => {
    const env = parseEnv(c.env);
    const { localityMapRuntime } = await getServices(env);
    c.header("Cache-Control", "no-store");
    return c.json(localityMapRuntime.getStatus());
  })
  .get('/localities-map', async (c) => {
    const env = parseEnv(c.env);
    const { localityMapRuntime } = await getServices(env);
    const payload = localityMapRuntime.getPayload();
    const status = localityMapRuntime.getStatus();
    c.header("Cache-Control", "no-store");
    
    if (!payload) {
      c.status(503);
      return c.json({
        ok: false,
        error: "locality map data unavailable",
        status: status?.status ?? "unavailable",
        loadedAtIso: status?.loadedAtIso ?? null,
        lastError: status?.lastError ?? null
      });
    }
    return c.json(payload);
  })
  .get('/polygon-states/current', async (c) => {
    const env = parseEnv(c.env);
    const { polygonStateService } = await getServices(env);
    
    const windowMinutes = parseIntegerQueryValue(c.req.query('windowMinutes'));
    const alertLimit = parseIntegerQueryValue(c.req.query('alertLimit'));
    const nowMs = parseIntegerQueryValue(c.req.query('nowMs'));

    const payload = await polygonStateService.getCurrentPolygonStates({
      windowMinutes: windowMinutes ?? undefined,
      alertLimit: alertLimit ?? undefined,
      nowMs: nowMs ?? undefined
    });

    c.header("Cache-Control", "no-store");
    if (!payload) {
      c.status(503);
      return c.json({
        ok: false,
        error: "polygon state inference unavailable"
      });
    }
    return c.json(payload);
  })
  .get('/polygon-states/replay', async (c) => {
    const env = parseEnv(c.env);
    const { polygonStateService } = await getServices(env);

    const rangeMinutes = parseIntegerQueryValue(c.req.query('rangeMinutes'));
    const stateWindowMinutes = parseIntegerQueryValue(c.req.query('stateWindowMinutes'));
    const alertLimit = parseIntegerQueryValue(c.req.query('alertLimit'));
    const nowMs = parseIntegerQueryValue(c.req.query('nowMs'));

    const payload = await polygonStateService.getPolygonReplayTimeline({
      rangeMinutes: rangeMinutes ?? undefined,
      stateWindowMinutes: stateWindowMinutes ?? undefined,
      alertLimit: alertLimit ?? undefined,
      nowMs: nowMs ?? undefined
    });

    c.header("Cache-Control", "no-store");
    if (!payload) {
      c.status(503);
      return c.json({
        ok: false,
        error: "polygon replay timeline unavailable"
      });
    }
    return c.json(payload);
  })
  .get('/live-news', async (c) => {
    const env = parseEnv(c.env);
    const { db } = await getServices(env);

    const limit = parseIntegerQueryValue(c.req.query('limit'));
    const fromUnix = parseIntegerQueryValue(c.req.query('fromUnix'));
    const toUnix = parseIntegerQueryValue(c.req.query('toUnix'));
    const eventTypes = parseStringListQueryValue(c.req.query('eventTypes'));
    const severities = parseIntegerListQueryValue(c.req.query('severities'));
    
    const payload = await db.getLiveNewsFeed({
      limit: limit ?? undefined,
      fromUnix: fromUnix ?? undefined,
      toUnix: toUnix ?? undefined,
      eventTypes,
      severities
    });

    c.header("Cache-Control", "no-store");
    if (!payload) {
      c.status(503);
      return c.json({
        ok: false,
        error: "live news feed unavailable"
      });
    }
    return c.json(payload);
  })
  .get('/live-news/raw', async (c) => {
    const env = parseEnv(c.env);
    const { db } = await getServices(env);

    const events = await db.news._getAllRaw();
    
    c.header("Cache-Control", "no-store");
    return c.json({
      ok: true,
      count: events.length,
      events
    });
  })
  .get('/live-news/refresh', async (c) => {
    const env = parseEnv(c.env);
    const { db, config } = await getServices(env);
    const logger = createLogger("api-refresh");

    console.log("[API] Manual news refresh triggered");
    
    const newsRuntime = (globalThis as any).newsRuntime || createNewsRuntime({
      config,
      database: db,
      logger,
      onNewsEvent: (newsEvent: any) => {
        console.log(`[API] News event collected: ${newsEvent.eventId}`);
        
        // Notify the DO for real-time broadcast
        const id = c.env.ALERT_BROADCASTER.idFromName("global-broadcaster");
        const obj = c.env.ALERT_BROADCASTER.get(id);
        
        const pushPromise = obj.fetch(new Request("http://do/push-news", {
          method: "POST",
          body: JSON.stringify(newsEvent),
          headers: { "Content-Type": "application/json" }
        })).then(res => {
          if (!res.ok) console.error(`Failed to push news to DO: ${res.status}`);
          return res;
        }).catch(err => console.error("Failed to push news to DO:", err));

        if (c.executionCtx) {
          c.executionCtx.waitUntil(pushPromise);
        }
      }
    });

    await newsRuntime.refreshOnce("api-manual");
    
    return c.json({ ok: true, message: "Refresh cycle completed" });
  })
  .get('/boundary-details', async (c) => {
    const env = parseEnv(c.env);
    const { boundaryDetailService } = await getServices(env);

    const countryName = String(c.req.query('countryName') ?? "").trim();
    const level = String(c.req.query('level') ?? "ADM1").trim().toUpperCase();
    
    c.header("Cache-Control", "no-store");

    if (!countryName) {
      c.status(400);
      return c.json({
        ok: false,
        error: "countryName query parameter is required"
      });
    }

    const payload = await boundaryDetailService.getBoundaryDetail({ countryName, level });

    if (!payload) {
      c.status(404);
      return c.json({
        ok: false,
        error: "boundary detail unavailable",
        countryName,
        level
      });
    }

    return c.json(payload);
  });

export default api;
export type ApiRouteType = typeof api;
