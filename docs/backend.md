# Backend Details

## Tech Stack

-   **Runtime**: Cloudflare Workers
-   **Framework**: Hono
-   **State Management**: Cloudflare Durable Objects (`AlertBroadcaster`)
-   **Storage**: Cloudflare KV
-   **Validation**: Zod (via Shared Schemas)

## Service Architecture

The backend is structured into several specialized services:

### 1. AlertBroadcaster (Durable Object)
Located in `apps/backend/src/durable-objects/AlertBroadcaster.ts`.
-   Maintains active WebSocket connections.
-   Handles real-time message broadcasting.
-   Manages the "live" state of alerts to ensure consistency across clients.

### 2. Locality Map Runtime
Located in `apps/backend/src/locality-map/runtime.ts`.
-   Loads and caches the catalog of Israeli cities and regions.
-   Provides fuzzy matching and resolution for location names in both Hebrew and English.

### 3. News Collection Pipeline
Located in `apps/backend/src/news/collector/runtime.ts`.
-   **Stateless Executor**: A pure asynchronous execution path that fetches and normalizes data from OSINT providers.
-   **Read-Modify-Write**: Performs change detection by comparing incoming events against the current state in KV before persisting and broadcasting.
-   **KV Rate Limiting**: Persists provider backoff states in KV (`news_provider_backoffs`) to ensure rate-limit compliance is maintained even across worker isolate restarts.
Supports multiple providers:
-   **GDACS**: Global Disaster Alert and Coordination System.
-   **GDELT**: Global Database of Events, Language, and Tone.
-   **Meteoalarm**: Weather alerts for Europe.
-   **USGS**: Earthquake data.
-   **NWS**: US National Weather Service.

### 4. Polygon State Service
Located in `apps/backend/src/polygon-state/service.ts`.
-   Infers the current state of geographic polygons based on recent alert activity.
-   Supports historical replay by reconstructing polygon states at specific points in time.

## API Endpoints

-   `GET /api/health`: System health and timezone info.
-   `GET /api/localities-map`: Returns the full locality catalog.
-   `GET /api/polygon-states/current`: Current active alert polygons.
-   `GET /api/polygon-states/replay`: Timeline of polygon states for replay mode.
-   `GET /api/live-news`: Filterable feed of global news events.
-   `WS /ui-socket`: WebSocket entry point for real-time updates.

## Cron Triggers

The system relies on Cloudflare Workers' `scheduled` events to drive the data collection pipelines. These triggers invoke the collectors, normalize the data, persist it to KV, and notify the `AlertBroadcaster`.
