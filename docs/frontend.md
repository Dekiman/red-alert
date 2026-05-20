# Frontend Details

## Tech Stack

-   **Framework**: [React 19](https://react.dev/)
-   **Build Tool**: [Vite](https://vitejs.dev/)
-   **Routing**: [TanStack Router](https://tanstack.com/router) (Type-safe)
-   **Data Fetching**: [TanStack Query](https://tanstack.com/query)
-   **State Management**: [Zustand](https://github.com/pmndrs/zustand)
-   **3D Rendering**: [`@react-three/fiber`](https://r3f.docs.pmnd.rs/) & [`@react-three/drei`](https://github.com/pmndrs/drei) (Three.js)
-   **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
-   **UI Architecture**: `@json-render` (core, react, shadcn) for dynamic UI card representation

## Application Structure

### 1. Map Kernel
Located in `apps/frontend/src/app/map-kernel/`.
-   **`renderer.tsx`**: The main entry point for the 3D globe, wrapping the canvas, camera controls, ambient light systems, and coordinate raycasters.
-   **`components.tsx`**: Implementation of R3F components like `Globe`, `BoundaryLayer`, `LocalityBoundaryLayer`, `AutoGeoBoundaryLayer` (raycast interaction), `Marker3D` (live news and active sirens), and `SunHighlight` (twilight daylight rendering).
-   **`math.ts`**: Utilities for geographic conversions, subsolar and sublunar calculations, and point-in-polygon checks.

### 2. Dashboard Stores
Located in `apps/frontend/src/stores/`.
-   **`useDashboardStore.ts`**: Central Zustand store managing connection state, live alert/news feeds, and UI configuration.

### 3. Real-time Synchronization
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
