import React, { useMemo, useState, useRef, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { 
  Globe, 
  Marker3D, 
  BoundaryLayer, 
  LocalityBoundaryLayer,
  GeoBoundaryLayer,
  AutoGeoBoundaryLayer,
  SunHighlight, 
  AdaptiveOrbitControls, 
  Starfield,
  SunMarker,
  MoonMarker
} from "./components";
import { getSubsolarPoint, latLngToVector3 } from "./math";
import type { AlertPayload, NewsEventPayload } from "../contracts";
import { formatNewsTime, hasHebrew } from "../text-utils";

export interface DashboardMapProps {
  alerts: AlertPayload[];
  newsEvents: NewsEventPayload[];
  selectedEventId?: string | null;
  selectedItem?: any;
  selectedCountry?: string | null;
  date?: Date;
  onSelect?: (item: { kind: "news" | "alert"; id: string; payload: any } | null) => void;
  onSelectCountry?: (country: string | null) => void;
}

/**
 * Syncs the sun light and highlight with the actual calculated sun position
 */
function SunSynchronizer({ onSunDirChange, date = new Date() }: { onSunDirChange: (dir: [number, number, number]) => void, date?: Date }) {
  useFrame(() => {
    const { lat, lng } = getSubsolarPoint(date);
    const pos = latLngToVector3(lat, lng, 1);
    onSunDirChange([pos.x, pos.y, pos.z]);
  });
  return null;
}

export function DashboardMap({ alerts, newsEvents, selectedEventId, selectedItem, selectedCountry, date = new Date(), onSelect, onSelectCountry }: DashboardMapProps) {
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [sunDirection, setSunDirection] = useState<[number, number, number]>([1, 0.2, 0.5]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<THREE.Mesh>(null);
  const selectedAlertId = selectedItem?.kind === "alert" ? selectedItem.alert?.notificationId : null;

  const cameraProps = useMemo(() => ({ 
    position: [0, 0, 5.0] as [number, number, number], 
    fov: 34 
  }), []);

  const shadowProps = useMemo(() => ({
    type: THREE.PCFShadowMap
  }), []);

  // Update tooltip position natively to avoid React re-renders on every mouse move
  useEffect(() => {
    const updateTooltip = (e: MouseEvent) => {
      if (tooltipRef.current) {
        tooltipRef.current.style.transform = `translate3d(${e.clientX + 16}px, ${e.clientY + 16}px, 0)`;
      }
    };
    window.addEventListener("mousemove", updateTooltip);
    return () => window.removeEventListener("mousemove", updateTooltip);
  }, []);

  return (
    <div className="alert-map" style={{ width: "100%", height: "100%", position: "relative" }}>
      <Canvas 
        camera={cameraProps} 
        shadows={shadowProps}
      >
        <Starfield />
        <ambientLight intensity={0.4} />
        <directionalLight 
          position={sunDirection} 
          intensity={1.2} 
          castShadow 
        />
        
        <SunSynchronizer onSunDirChange={setSunDirection} date={date} />

        <Globe radius={1.2} date={date} globeRef={globeRef}>
          <SunHighlight radius={1.2} sunDirection={sunDirection} />
          
          <BoundaryLayer 
            url="/assets/world-countries-50m.json" 
            color="#ffffff" 
            altitude={0.006} 
          />
          
          <LocalityBoundaryLayer 
            color="#4488ff" 
            altitude={0.008} 
          />

          <AutoGeoBoundaryLayer 
            color="#88ccff" 
            altitude={0.007} 
            opacity={0.8}
            onHover={setHoveredCountry}
            onSelect={onSelectCountry}
            selectedCountry={selectedCountry}
            date={date}
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
                  onClick={() => {
                    console.log("newsMarker click registered for eventId:", event.eventId);
                    onSelect?.({ kind: "news", id: event.eventId, payload: event });
                  }}
                >
                  {isSelected && selectedItem?.kind === "news" && (
                    <Html occlude={[globeRef]}>
                      <div className="event-bubble-card">
                        <button
                          type="button"
                          className="event-bubble-close"
                          aria-label="Close details"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect?.(null);
                          }}
                        >
                          ✕
                        </button>
                        <p className="event-bubble-eyebrow">
                          {(event.category || "news").toUpperCase()} · {formatNewsTime(event.updatedAtIso || event.createdAtIso)}
                        </p>
                        <h4
                          className="event-bubble-title"
                          dir={hasHebrew(event.title || "") ? "rtl" : "ltr"}
                          lang={hasHebrew(event.title || "") ? "he" : "en"}
                        >
                          {event.title}
                        </h4>
                        {event.summary && event.summary !== event.title && (
                          <p
                            className="event-bubble-summary"
                            dir={hasHebrew(event.summary) ? "rtl" : "ltr"}
                            lang={hasHebrew(event.summary) ? "he" : "en"}
                          >
                            {event.summary}
                          </p>
                        )}
                        <div className="event-bubble-meta">
                          <span 
                            className="event-bubble-location"
                            dir={hasHebrew([event.locationName, event.region, event.country].filter(Boolean).join(" | ")) ? "rtl" : "ltr"}
                          >
                            {[event.locationName, event.region, event.country].filter(Boolean).join(" | ") || "Global event"}
                          </span>
                          {event.primarySignalUrl && (
                            <a
                              href={event.primarySignalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="event-bubble-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Open source
                            </a>
                          )}
                        </div>
                      </div>
                    </Html>
                  )}
                </Marker3D>
              );
            })}
          </group>

          <group name="alertMarkers">
            {alerts.map((alert) => {
              if (!alert.notificationId) return null;
              const isSelected = selectedAlertId === alert.notificationId;
              return (
                <Marker3D 
                  key={alert.notificationId}
                  lat={32.0853} // Demo fallback
                  lng={34.7818}
                  color="#ff5837"
                  isPulse={true}
                  showHalo={true}
                  onClick={() => onSelect?.({ kind: "alert", id: alert.notificationId, payload: alert })}
                >
                  {isSelected && (
                    <Html occlude={[globeRef]}>
                      <div className="event-bubble-card">
                        <button
                          type="button"
                          className="event-bubble-close"
                          aria-label="Close details"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect?.(null);
                          }}
                        >
                          ✕
                        </button>
                        <p className="event-bubble-eyebrow">
                          LIVE ALERT · {alert.source}
                        </p>
                        <h4 className="event-bubble-title">
                          Red Alert: {alert.locations?.[0] || "Unknown Location"}
                        </h4>
                        <p className="event-bubble-summary">
                          {alert.threat} threat detected at {alert.locationCount} locations.
                        </p>
                        <div className="event-bubble-meta">
                          <span className="event-bubble-location">
                            {alert.locations?.slice(0, 3).join(", ") || "Israel"}
                          </span>
                        </div>
                      </div>
                    </Html>
                  )}
                </Marker3D>
              );
            })}
          </group>
        </Globe>

        <SunMarker orbitRadius={6} date={date} />
        <MoonMarker orbitRadius={5} date={date} />
        
        <AdaptiveOrbitControls />
      </Canvas>

      {hoveredCountry && (
        <div 
          ref={tooltipRef} 
          className="pointer-events-none fixed top-0 left-0 bg-slate-900/90 text-slate-100 px-3 py-1.5 rounded-md text-sm font-medium shadow-2xl z-[100] border border-slate-700/50 backdrop-blur-sm whitespace-nowrap"
        >
          {hoveredCountry}
        </div>
      )}
    </div>
  );
}
