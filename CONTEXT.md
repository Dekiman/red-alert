# Domain Glossary

## Core Concepts

### Alert
A high-priority emergency notification. In the context of the project, this usually refers to "Tzeva Adom" (Red Alert) notifications from the Home Front Command (Oref). 
- **Attributes**: threat type, locations, timestamp, source.

### News Event
A security, environmental, or public safety event collected from OSINT (Open Source Intelligence) or official news sources (e.g., GDELT, GDACS, USGS).
- **Attributes**: category, severity, location, source URL.

### System Message
Non-alert, non-news notifications used for system updates, instructions, or broad announcements.

## Architectural Concepts

### Locality Map
The system responsible for resolving location names (Hebrew/English) or IDs to geographic polygons and metadata. It manages the catalog of cities and regions.

### Collection Pipeline
A specialized stateless pipeline (within the broader Pipeline concept) responsible for fetching, normalizing, and deduplicating news events from external providers. It uses a read-modify-write pattern with the persistence layer for change detection and persists provider-specific backoff states in KV to ensure rate-limit compliance across isolate restarts.

### AlertBroadcaster
A real-time synchronization hub implemented as a Cloudflare Durable Object. It coordinates the "live" state of alerts and news across all connected WebSocket clients.

### Pipeline
An orchestrated sequence of data processing. A typical pipeline includes:
1. **Collector**: Fetches raw data from an external provider.
2. **Normalizer**: Transforms raw data into domain-compliant objects (using Shared Schemas).
3. **Storage**: Persists the data (currently in KV).
4. **Broadcast**: Notifies the `AlertBroadcaster` of new events.

### Shared Schemas
The source of truth for domain objects, defined using Zod in `packages/shared`. They define the mandatory structure for Alerts, NewsEvents, and SystemMessages.

## Tooling & Ecosystem

### Core Infrastructure
- **Runtime & Package Manager**: [Bun](https://bun.sh/). Used for all scripts, package management, and as the execution environment for local scripts.
- **Monorepo Management**: Bun Workspaces. The project is split into `apps/` (frontend, backend) and `packages/` (shared libraries).
- **Quality Control**: 
  - [Oxlint](https://oxlint.dev/) for high-performance linting.
  - [tsgo](https://github.com/teatimeguest/tsgo) for fast TypeScript type checking.

### Backend (Cloudflare Workers)
- **Framework**: [Hono](https://hono.dev/). A small, fast, and web-standard based framework.
- **Compute**: Cloudflare Workers (Edge Functions).
- **State & Real-time**: 
  - **Durable Objects**: `AlertBroadcaster` manages live state and WebSocket connections.
  - **KV Storage**: `ALERTS_KV` for event persistence and `CACHE_KV` for provider-specific backoff and rate-limiting states.
- **Deployment**: [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

### Frontend (React 19)
- **Framework**: [React 19](https://react.dev/).
- **Build Tool**: [Vite](https://vitejs.dev/) with `@tailwindcss/vite`.
- **Routing**: [TanStack Router](https://tanstack.com/router). Type-safe, client-side routing.
- **Data Fetching**: [TanStack Query](https://tanstack.com/query).
- **State Management**: [Zustand](https://github.com/pmndrs/zustand).
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) (integrated via `@json-render/shadcn`).
- **3D Rendering**: [React Three Fiber](https://r3f.docs.pmnd.rs/) (Three.js).
- **UI Architecture**: Uses `@json-render` ecosystem for building UIs from JSON specifications.
- **Deployment**: [Vercel](https://vercel.com/).

### Shared
- **Shared Schemas**: Located in `packages/shared`, using [Zod](https://zod.dev/) for runtime validation and type inference across both backend and frontend.
