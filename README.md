# Israel Red Alert + Live News Stream

Streams Israel red alert events from the public Tzeva Adom WebSocket and prints normalized JSON lines with:

- `locations`
- `alertTimestampIso`
- `receivedAtIso`
- `threat`
- `isDrill`
- `notificationId`

In addition, every alert is stored in a local SQLite database.
The app also ingests the live news feed from `monitor-the-situation.com` and stores it in the same database.

## Run

```bash
npm install
npm start
```

Build artifacts are generated into `dist/`:

- Backend runtime entry: `dist/backend/index.js`
- Frontend static bundle: `dist/frontend/*`

Useful scripts:

- `npm run build` -> build backend TypeScript and frontend React bundle
- `npm run typecheck` -> run TypeScript project checks without emitting files

Database file (default): `data/red_alerts.sqlite`

Frontend URL (default): `http://127.0.0.1:3030`
- Includes two live panels:
  - Red alerts
  - Live news feed
- Includes an Israel locality polygon map (cities/towns/kibbutzim/moshavim) sourced from tzevaadom lists data.
  - Polygon states:
    - Neutral (default)
    - Pre-alert (`SYSTEM_MESSAGE` pre-warning) -> yellow
    - Active siren (alert active for 60s) -> red
    - Post-siren unsafe (after red, until safe message) -> orange
    - Safe-to-exit (after safe message, fades over 5 minutes) -> green

## Project structure

Backend is now split into focused modules:

- Source root: `backend/src`
- `backend/src/index.ts` -> composition root and lifecycle only
- `backend/src/app/*` -> pipeline handlers (alerts/system messages/news UI fanout)
- `backend/src/config.ts` -> env/config parsing
- `backend/src/utils/*` -> shared parsing/static-file helpers
- `backend/src/alerts/*` -> alert payload parsing + normalization
- `backend/src/system-messages/*` -> system-message parsing/classification
- `backend/src/mock/*` -> mock API payload builders
- `backend/src/ui/*` -> UI runtime state + websocket broadcasting
- `backend/src/server/frontend-server.ts` -> server composition only
- `backend/src/server/express/app.ts` -> Express app composition
- `backend/src/server/express/api-router.ts` -> API route logic
- `backend/src/server/express/frontend-router.ts` -> SPA/static serving
- `backend/src/server/ui-socket.ts` -> UI websocket connection handling
- `backend/src/transport/red-alert-transport.ts` -> upstream websocket client + backup polling
- `backend/src/news/runtime.ts` -> live-news collector lifecycle
- `backend/src/news/collector/*` -> live-news collector internals (normalization/payload parsing/runtime)
- `backend/src/locality-map/runtime.ts` -> locality map catalog lifecycle
- `backend/src/locality-map/*` -> locality catalog internals (cache/fetch/payload parsing/catalog building)

Frontend is React + TypeScript (built with Vite):

- Source root: `frontend/src`
- Static assets root: `frontend/public`
- `frontend/src/main.tsx` -> React entrypoint
- `frontend/src/app/App.tsx` -> dashboard root component
- `frontend/src/app/use-dashboard-socket.ts` -> websocket state hook
- `frontend/src/app/alert-map-panel.tsx` -> React wrapper for locality map controller
- `frontend/src/app/alert-map.ts` -> polygon map rendering + stage machine
- `frontend/src/app/text-utils.ts` -> text/direction/time helpers
- `frontend/src/app/news-categorizer.ts` -> live-news title categorization

## Output format

Each line in stdout is a JSON event:

```json
{
  "source": "websocket",
  "notificationId": "abc123",
  "threat": 0,
  "isDrill": false,
  "locations": ["Tel Aviv - City Center", "Bat Yam"],
  "locationCount": 2,
  "alertTimestampUnix": 1772364498,
  "alertTimestampIso": "2026-03-01T09:48:18.000Z",
  "alertDateUtc": "2026-03-01",
  "alertTimeUtc": "09:48:18",
  "alertDateIsrael": "2026-03-01",
  "alertTimeIsrael": "11:48:18",
  "receivedAtIso": "2026-03-01T09:48:19.204Z",
  "hasSourceTime": true
}
```

## Database schema

`alerts` table stores the main alert event:

- `notification_id`
- `source`
- `threat`
- `is_drill`
- `alert_timestamp_unix`
- `alert_timestamp_iso`
- `alert_date_utc`, `alert_time_utc`
- `alert_date_israel`, `alert_time_israel`
- `received_at_iso`
- `has_source_time`
- `location_count`
- `raw_payload_json`

`alert_locations` table stores one row per location in the alert:

- `alert_id` (FK -> `alerts.id`)
- `location_index`
- `location_name`

`live_news_events` table stores live news events:

- `external_event_id`
- `title`, `summary`
- `category`, `severity`
- `source_types`
- `signal_count`
- `is_active`
- `location_name`, `country`, `region`, `lat`, `lng`
- `created_at_iso`, `updated_at_iso`, `fetched_at_iso`
- `raw_payload_json`

`live_news_signals` table stores source signals for each live news event:

- `external_signal_id`
- `event_external_id` (FK -> `live_news_events.external_event_id`)
- `source_type`, `source_name`, `source_reliability`
- `title`, `content`, `url`
- `timestamp_iso`, `created_at_iso`
- `account_handle`, `tweet_id`
- `media_urls_json`
- `fetched_at_iso`
- `raw_payload_json`

## Environment variables

- `RED_ALERT_WS_URL` (default: `wss://ws.tzevaadom.co.il/socket?platform=WEB`)
- `RED_ALERT_WS_ORIGIN` (default: `https://www.tzevaadom.co.il`)
- `RED_ALERT_WS_USER_AGENT` (default: desktop Chrome UA)
- `RED_ALERT_NOTIFICATIONS_URL` (default: `https://api.tzevaadom.co.il/notifications?`)
- `RED_ALERT_RECONNECT_MS` (default: `5000`)
- `RED_ALERT_BACKUP_POLL_MS` (default: `3000`)
- `RED_ALERT_DB_PATH` (default: `data/red_alerts.sqlite`)
- `RED_ALERT_TIMEZONE` (default: `Asia/Jerusalem`)
- `RED_ALERT_MAX_SEEN_IDS` (default: `500`)
- `RED_ALERT_ENGLISH_ONLY` (default: `false`; set to `true` to drop non-English alert locations)
- `RED_ALERT_LOG_LEVEL` (default: `info`; options: `debug`, `info`, `warn`, `error`)
- `RED_ALERT_LOG_ENGLISH_ONLY` (default: `true`; sanitizes non-English characters in log messages/context)
- `RED_ALERT_WEB_HOST` (default: `127.0.0.1`)
- `RED_ALERT_WEB_PORT` (default: `3030`)
- `RED_ALERT_WEB_SOCKET_PATH` (default: `/ui-socket`)
- `RED_ALERT_FRONTEND_PUBLIC_ROOT` (default: `dist/frontend`)
- `RED_ALERT_UI_HISTORY_SIZE` (default: `100`)
- `RED_ALERT_UI_NEWS_HISTORY_SIZE` (default: `100`)
- `RED_ALERT_NEWS_ENABLED` (default: `true`)
- `RED_ALERT_NEWS_BASE_URL` (default: `https://monitor-the-situation.com`)
- `RED_ALERT_NEWS_POLL_MS` (default: `15000`)
- `RED_ALERT_NEWS_FETCH_TIMEOUT_MS` (default: `10000`)
- `RED_ALERT_NEWS_WS_RECONNECT_MS` (default: `5000`)
- `RED_ALERT_NEWS_WS_PING_MS` (default: `30000`)
- `RED_ALERT_NEWS_MAX_SIGNALS_PER_EVENT` (default: `5`)
- `RED_ALERT_NEWS_SOURCE_TYPES` (default: `news,twitter,gdacs`)
- `RED_ALERT_NEWS_REALTIME_TRIGGER_TABLES` (default: `all_events,all_signals`)
- `RED_ALERT_NEWS_MAX_SIGNAL_EVENTS_PER_REFRESH` (default: `25`)
- `RED_ALERT_LOCALITY_MAP_ENABLED` (default: `true`)
- `RED_ALERT_LOCALITY_MAP_LISTS_VERSIONS_URL` (default: `https://api.tzevaadom.co.il/lists-versions`)
- `RED_ALERT_LOCALITY_MAP_CITIES_URL` (default: `https://www.tzevaadom.co.il/static/cities.json`)
- `RED_ALERT_LOCALITY_MAP_POLYGONS_URL` (default: `https://www.tzevaadom.co.il/static/polygons.json`)
- `RED_ALERT_LOCALITY_MAP_FETCH_TIMEOUT_MS` (default: `15000`)
- `RED_ALERT_LOCALITY_MAP_REFRESH_MS` (default: `21600000` / 6 hours)
- `RED_ALERT_LOCALITY_MAP_DEFAULT_CITIES_VERSION` (default: `10`)
- `RED_ALERT_LOCALITY_MAP_DEFAULT_POLYGONS_VERSION` (default: `5`)
- `RED_ALERT_LOCALITY_MAP_VERSIONS_CACHE_PATH` (default: `data/locality-map-versions.json`)

## Notes

- If the WebSocket disconnects, the client automatically polls the notifications API as a fallback.
- If an alert does not contain a server `time`, the client uses current system time.
- By default, only alerts with English location names are emitted/stored.
- Frontend auto-switches location direction to RTL for Hebrew text (alerts and live news text).
- Live news collector uses both polling and realtime `/ws` updates from monitor-the-situation.
- Live news collector defaults to source types `news`, `twitter`, and `gdacs`.
- Backend exposes locality map payload for the frontend at `GET /api/localities-map` and status at `GET /api/localities-map/status`.
- Normalized alerts now include `locationIds` and `matchedLocationCount` for direct locality-to-polygon highlighting.
- The app uses Node's built-in `node:sqlite` module (currently experimental in Node 24).
- Logs are written to stderr with ISO timestamps and component scopes (`app`, `ws`, `backup`, `alert`, `db`, `ui`, `news`).
