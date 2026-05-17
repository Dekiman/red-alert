# Frontend Details

## Tech Stack

-   **Framework**: React (TypeScript)
-   **Routing**: TanStack Router
-   **State Management**: Zustand
-   **Data Fetching**: TanStack Query (React Query)
-   **3D Rendering**: `@json-render/react-three-fiber` (based on Three.js)
-   **Styling**: Vanilla CSS + Tailwind CSS (for UI components)
-   **UI Components**: Shadcn UI (Radix UI)

## Application Structure

### 1. Map Kernel
Located in `apps/frontend/src/app/map-kernel/`.
-   **`renderer.tsx`**: The main entry point for the 3D globe. It uses `ThreeCanvas` to render a declarative scene specification.
-   **`components.tsx`**: Implementation of R3F components like `Globe`, `BoundaryLayer`, `Marker3D`, and `SunHighlight`.
-   **`catalog.ts`**: Defines the JSON schema for the map components using `@json-render/core`.
-   **`math.ts`**: Utilities for geographic to 3D coordinate conversion (Lat/Lng to Vector3).

### 2. Map Adapter
Located in `apps/frontend/src/app/map-adapter/`.
-   **`spec-generator.ts`**: Generates a declarative JSON specification for the 3D scene based on the current application state (active alerts, news events).

### 3. Dashboard Stores
Located in `apps/frontend/src/stores/`.
-   **`useDashboardStore.ts`**: Central Zustand store managing connection state, live alert/news feeds, and UI configuration.

### 4. Real-time Synchronization
Located in `apps/frontend/src/app/use-dashboard-socket.ts`.
-   Manages the WebSocket connection to the backend.
-   Handles incoming real-time payloads and updates the Zustand store and Map Kernel.

## Features

### Live 3D Globe
-   **Physically Accurate Earth Rotation**: The globe rotates strictly according to the current UTC time (360 degrees per 24 hours).
-   **Astronomical Markers**: Real-time visualization of the Sun and Moon positions (subsolar and sublunar points) based on UTC astronomical calculations.
-   **Precision Navigation**: 
    *   **Bounded Zoom**: Strictly capped camera distance (1.4 to 5.0) to maintain visual consistency.
    *   **True-to-Cursor Panning**: Proportional rotation speed that scales with zoom level, ensuring the globe surface tracks the mouse with 1:1 precision (damping disabled).
-   **Zoom-Based Level of Detail (LOD)**: Geographic boundaries (TopoJSON) smoothly cross-fade between global country outlines and detailed regional/local boundaries based on the camera's zoom level.
-   **Atmospheric Rendering**: Custom Fresnel shaders for a realistic atmospheric glow and dynamic day/night highlight simulation.

### Multi-Stream News Feed
-   Aggregated feed from multiple global providers.
-   Advanced filtering by category, severity, and region.
-   Deep linking to original news sources.

### Timeline Replay
-   Allows users to "scrub" through recent history to see past alert sequences.
-   Infers geographic alert states (polygons) for historical points in time.
-   Syncs the entire dashboard (map + feeds) to the replay cursor.
