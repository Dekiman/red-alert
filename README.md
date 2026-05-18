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

- **Real-time Synchronization**: Powered by Cloudflare Durable Objects.
- **High-Fidelity 3D Globe**: 
  - Real-world UTC-tied rotation and lighting.
  - Zoom-based Level of Detail (LOD).
  - Dynamic polygon highlighting for active alerts (Yellow -> Red -> Orange -> Green).
- **News Aggregation**: Normalized news stream from multiple OSINT sources (GDELT, GDACS, USGS, etc.).
- **Type Safety**: End-to-end type safety using Zod and TanStack Router.

## Deployment Targets

- **Backend**: `https://red-alert-backend.red-alert.workers.dev`
- **Frontend**: Managed by Vercel, proxying `/api` and `/ui-socket` to the Cloudflare backend.
