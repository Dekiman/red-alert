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
