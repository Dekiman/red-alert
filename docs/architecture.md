# Architecture

## System Overview

Red Alert + Live News is a real-time monitoring dashboard that combines Israeli security alerts ("Tzeva Adom") with global news events and OSINT signals. It provides a highly accurate, real-time 3D globe visualization that synchronizes Earth's rotation and astronomical markers (Sun/Moon) with the current UTC time.

The entire project is managed as a **Bun monorepo**, utilizing Bun for its runtime, package management, and high-performance developer tooling (oxlint, tsgo).

## System Diagram

```mermaid
graph TD
    subgraph External Providers
        Oref[Home Front Command]
        GDELT[GDELT Project]
        GDACS[GDACS]
        USGS[USGS Earthquake]
        NWS[US Weather Alerts]
        Meteo[Meteoalarm Europe]
        Canada[Weather Canada]
        GeoBound[geoboundaries.org]
    end

    subgraph Backend [Cloudflare Workers]
        Hono[Hono API]
        Cron[Cloudflare Cron Triggers]
        DO[AlertBroadcaster Durable Object]
        KV[(Cloudflare KV Storage)]
    end

    subgraph Frontend [Vercel]
        React[React Dashboard]
        Globe[3D Map Kernel]
    end

    Cron -->|Polls| External Providers
    Cron -->|Stores Data| KV
    Cron -->|Notifies| DO
    Hono -->|Serves API & ADM2 Boundaries| React
    Hono -->|Queries| GeoBound
    DO <-->|WebSockets| React
    React -->|Renders| Globe
```

## Data Flow

1.  **Collection**: Cloudflare Workers Cron Triggers run periodically to fetch raw data from external providers (Home Front Command for alerts, GDELT/GDACS/USGS/NWS/Weather Canada/Meteoalarm for news).
2.  **Normalization**: Raw data is parsed and transformed into standardized domain objects using Shared Schemas (defined in `packages/shared`).
3.  **Persistence**: Normalized events are stored in Cloudflare KV storage for historical access and backfilling.
4.  **Boundary Queries**: When the frontend requests a country's boundaries, Hono handles name normalization, checks KV, fetches the ADM2 shapefiles from `geoboundaries.org` or static caches, and returns them to the map kernel.
5.  **Broadcast**: New events are pushed to the `AlertBroadcaster` Durable Object.
6.  **Synchronization**: The Durable Object broadcasts the events via WebSockets to all connected frontend clients.
7.  **Visualization**: The React frontend receives the events and updates the UI, including the live 3D globe and news feed.

## Core Components

-   **Locality Map**: Resolves location names/IDs to geographic polygons and metadata for Israel.
-   **Alert Pipeline**: Specifically handles Israeli emergency notifications.
-   **News Pipeline**: Comprised of the **Collection Pipeline** (stateless fetching and normalization) and the **Broadcast Pipeline** (real-time notification of UI clients via Durable Objects). It uses KV-backed rate limiting to ensure compliant data fetching across isolate lifecycles.
-   **Durable Object (AlertBroadcaster)**: Ensures all clients see the same live state and coordinates real-time updates.
