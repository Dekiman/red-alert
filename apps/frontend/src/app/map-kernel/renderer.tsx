import React, { useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { 
  Globe, 
  Marker3D, 
  BoundaryLayer, 
  LocalityBoundaryLayer,
  SunHighlight, 
  AdaptiveOrbitControls, 
  Starfield,
  SunMarker,
  MoonMarker
} from "./components";
import type { AlertPayload, NewsEventPayload } from "../contracts";

export interface DashboardMapProps {
  alerts: AlertPayload[];
  newsEvents: NewsEventPayload[];
  selectedEventId?: string | null;
  onSelect?: (item: { kind: "news" | "alert"; id: string; payload: any }) => void;
}

const SUN_DIRECTION: [number, number, number] = [1, 0.2, 0.5];

export function DashboardMap({ alerts, newsEvents, selectedEventId, onSelect }: DashboardMapProps) {
  const cameraProps = useMemo(() => ({ 
    position: [0, 0, 5.0] as [number, number, number], 
    fov: 34 
  }), []);

  const shadowProps = useMemo(() => ({
    type: THREE.PCFShadowMap
  }), []);

  return (
    <div className="alert-map" style={{ width: "100%", height: "100%" }}>
      <Canvas 
        camera={cameraProps} 
        shadows={shadowProps}
      >
        <Starfield />
        <ambientLight intensity={0.4} />
        <directionalLight 
          position={SUN_DIRECTION} 
          intensity={1.2} 
          castShadow 
        />
        
        <Globe radius={1.2}>
          <SunHighlight radius={1.2} sunDirection={SUN_DIRECTION} />
          
          <BoundaryLayer 
            url="/assets/world-countries-50m.json" 
            color="#ffffff" 
            altitude={0.006} 
          />
          
          <LocalityBoundaryLayer 
            color="#4488ff" 
            altitude={0.01} 
          />
          
          <group name="newsMarkers">
            {newsEvents.map((event) => {
              if (!event.eventId) return null;
              const isSelected = selectedEventId === event.eventId;
              return (
                <Marker3D 
                  key={event.eventId}
                  lat={event.lat ?? 0}
                  lng={event.lng ?? 0}
                  color={isSelected ? "#ff7648" : "#72d47d"}
                  scale={isSelected ? 1.2 : 1}
                  showHalo={isSelected}
                  onClick={() => onSelect?.({ kind: "news", id: event.eventId, payload: event })}
                />
              );
            })}
          </group>

          <group name="alertMarkers">
            {alerts.map((alert) => {
              if (!alert.notificationId) return null;
              return (
                <Marker3D 
                  key={alert.notificationId}
                  lat={32.0853} // Demo fallback
                  lng={34.7818}
                  color="#ff5837"
                  isPulse={true}
                  showHalo={true}
                  onClick={() => onSelect?.({ kind: "alert", id: alert.notificationId, payload: alert })}
                />
              );
            })}
          </group>
        </Globe>

        <SunMarker orbitRadius={6} />
        <MoonMarker orbitRadius={5} />
        
        <AdaptiveOrbitControls />
      </Canvas>
    </div>
  );
}
