# Israel Red Alert + Live News Stream

A real-time dashboard for monitoring security alerts and news events in Israel. Built with a modern, high-performance stack using Bun, Cloudflare Workers, and React 19.

## Tech Stack

### Backend (Cloudflare Workers)
- **Runtime**: [Bun](https://bun.sh/)
- **Framework**: [Hono](https://hono.dev/)
- **Compute**: Cloudflare Workers (Edge Functions)
- **State & Real-time**: 
  - **Durable Objects**: `AlertBroadcaster` for WebSocket coordination and live state management.
  - **KV Storage**: Persistence for alerts, news events, and rate-limiting states.
- **Deployment**: Wrangler

### Frontend (React 19)
- **Framework**: React 19
- **Build Tool**: Vite
- **Routing**: TanStack Router (Type-safe)
- **Data Fetching**: TanStack Query
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **3D Rendering**: React Three Fiber (Three.js) for the global visualization.
- **Deployment**: Vercel

### Shared
- **Shared Schemas**: Zod-based schemas in `packages/shared` for type safety across the monorepo.

## Project Structure

The project is managed as a Bun monorepo:

- `apps/backend`: Cloudflare Workers source code.
- `apps/frontend`: React application.
- `packages/shared`: Shared types and Zod schemas.
- `scripts/`: Build and utility scripts.

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) installed.
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI for backend development.

### Development

```bash
# Install dependencies
bun install

# Run backend (Cloudflare Workers)
bun dev:backend

# Run frontend (Vite)
bun dev:frontend
```

### Build & Deploy

```bash
# Build all packages
bun run build

# Deploy backend to Cloudflare
bun --filter backend deploy

# Frontend is automatically deployed via Vercel on push
```

## Features

- **Real-time Synchronization**: Powered by Cloudflare Durable Objects managing active WebSocket channels.
- **High-Fidelity 3D Globe**: 
  - **Astronomical Alignment**: Real-world UTC-tied Earth rotation paired with real-time astronomical solar and lunar coordinate mapping (subsolar and sublunar points) casting twilight and shadow shaders.
  - **Interactive Country Boundary Raycasting**: Hovering and clicking on the globe computes local coordinates and runs point-in-polygon checks to highlight country borders.
  - **Detailed Administrative Borders (ADM2)**: Dynamic loading of secondary administrative divisions from `geoboundaries.org` or static pre-simplified caches when a country is hovered/selected.
  - **Automatic Filters**: Selecting a country on the globe dynamically filters the dashboard's live news feed.
- **News Aggregation**: Normalized, rate-limit compliant news stream from multiple OSINT/disaster sources including GDELT, GDACS, USGS (earthquakes), NWS (US weather), Weather Canada, and Meteoalarm (European weather).
- **Timeline Replay**: An interactive slider/timeline interface to rewind, pause, play, or scrub back in time to inspect historical siren states and global news events.
- **Type Safety**: End-to-end type safety using Zod and TanStack Router.

## Deployment Targets

- **Backend**: `https://red-alert-backend.galmankedi.workers.dev`
- **Frontend**: Managed by Vercel, proxying `/api` and `/ui-socket` to the Cloudflare backend.
