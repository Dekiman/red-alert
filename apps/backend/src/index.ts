import { Hono } from 'hono';
import { cors } from 'hono/cors';
import api from './routes/api.js';
import { parseEnv, type Env } from './env.js';
import { createLogger } from './logger.js';
import { createAppConfig } from './config.js';
import { initDatabase } from './db.js';
import { createLocalityMapRuntime } from './locality-map/runtime.js';
import { createNewsRuntime } from './news/runtime.js';

export { AlertBroadcaster } from './durable-objects/AlertBroadcaster.js';

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://your-frontend.vercel.app', 'http://127.0.0.1:5173'],
}));

// Mount the API routes under /api
const routes = app.route('/api', api);

// Route WebSocket traffic to Durable Object
app.get('/ui-socket', async (c) => {
  const id = c.env.ALERT_BROADCASTER.idFromName("global-broadcaster");
  const obj = c.env.ALERT_BROADCASTER.get(id);
  return obj.fetch(c.req.raw);
});

export type AppType = typeof routes;

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const parsedEnv = parseEnv(env);
    const logger = createLogger("cron");
    const config = createAppConfig(parsedEnv, logger);
    const db = initDatabase({ kv: env.ALERTS_KV, includeWeatherNews: config.newsIncludeWeather, englishOnlyNews: config.newsEnglishOnly });

    const localityMapRuntime = createLocalityMapRuntime({ config, logger });
    await localityMapRuntime.start(env.CACHE_KV);

    // Poke the DO to ensure upstream connection
    const id = env.ALERT_BROADCASTER.idFromName("global-broadcaster");
    const obj = env.ALERT_BROADCASTER.get(id);
    await obj.fetch(new Request("http://do/poke"));

    if (config.newsEnabled) {
      const newsRuntime = createNewsRuntime({
        config,
        database: db,
        logger,
        onNewsEvent: (newsEvent: any) => {
          logger.info("Cron found new live news event", { eventId: newsEvent.eventId });
          
          // Notify the DO
          const id = env.ALERT_BROADCASTER.idFromName("global-broadcaster");
          const obj = env.ALERT_BROADCASTER.get(id);
          ctx.waitUntil(obj.fetch(new Request("http://do/push-news", {
            method: "POST",
            body: JSON.stringify(newsEvent),
            headers: { "Content-Type": "application/json" }
          })));
        }
      });
      
      await newsRuntime.refreshOnce("cron");
    }
  }
};


