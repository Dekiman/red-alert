import { useEffect, useState, lazy, Suspense, useRef } from "react";
import type { NewsEventPayload, AlertPayload } from "./contracts.js";
import { formatNewsTime, hasHebrew } from "./text-utils.js";

const DashboardMap = lazy(() => import("./map-kernel/renderer").then(m => ({ default: m.DashboardMap })));

interface AlertMapPanelProps {
  newsEvents: NewsEventPayload[];
  alerts: AlertPayload[];
  date?: Date;
  selectedCountry?: string | null;
  onSelectCountry?: (country: string | null) => void;
}

export function AlertMapPanel({ newsEvents, alerts, date, selectedCountry: globalSelectedCountry, onSelectCountry }: AlertMapPanelProps) {
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const lastSelectTimeRef = useRef<number>(0);

  const handleSelect = (item: { kind: "news" | "alert"; id: string; payload: any } | null) => {
    console.log("handleSelect called with:", item);
    lastSelectTimeRef.current = Date.now();
    if (!item) {
      setSelectedItem(null);
      return;
    }
    setSelectedItem({
      kind: item.kind,
      newsEvent: item.kind === "news" ? item.payload : null,
      alert: item.kind === "alert" ? item.payload : null,
      title: item.kind === "alert" ? `Alert: ${item.payload.notificationId}` : item.payload.title
    });
  };

  useEffect(() => {
    if (!selectedItem) return;

    const handleDocumentClick = (e: MouseEvent) => {
      const timeDiff = Date.now() - lastSelectTimeRef.current;
      const target = e.target as HTMLElement;
      const insideCard = target.closest(".event-bubble-card");
      console.log("handleDocumentClick target:", target, "timeDiff:", timeDiff, "insideCard:", !!insideCard);

      // If the selection happened extremely recently, ignore the click to avoid instant closure
      if (timeDiff < 100) {
        console.log("Ignoring document click: too recent selection");
        return;
      }

      // If the click is inside the bubble, ignore it
      if (insideCard) {
        console.log("Ignoring document click: inside bubble card");
        return;
      }

      // Otherwise, close the bubble and unselect the event
      console.log("Closing bubble via click outside");
      setSelectedItem(null);
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [selectedItem]);

  const selectedNewsEvent = selectedItem?.kind === "news" ? selectedItem.newsEvent : null;
  const selectedAlert = selectedItem?.kind === "alert" ? selectedItem.alert : null;

  const eventSelectedCountry = selectedNewsEvent?.country || (selectedAlert ? "Israel" : null);
  const effectiveSelectedCountry = globalSelectedCountry || eventSelectedCountry;

  return (
    <section className="alert-map alert-map-stage" aria-label="Global threat globe">
      <div className="alert-map-shell">
        <Suspense fallback={<div className="alert-map-loading">Loading Orbital View...</div>}>
          <DashboardMap 
            alerts={alerts} 
            newsEvents={newsEvents} 
            selectedEventId={selectedItem?.kind === "news" ? selectedItem.newsEvent?.eventId : null}
            selectedItem={selectedItem}
            selectedCountry={effectiveSelectedCountry}
            onSelect={handleSelect}
            onSelectCountry={onSelectCountry}
            date={date}
          />
        </Suspense>
        
        <div className="globe-overlay globe-overlay-legend">
          <span className="legend-chip">
            <span className="legend-swatch live"></span>
            Active siren
          </span>
          <span className="legend-chip">
            <span className="legend-swatch news"></span>
            Global news
          </span>
        </div>
      </div>
    </section>
  );
}
