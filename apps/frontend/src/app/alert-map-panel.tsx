import { useEffect, useState, lazy, Suspense } from "react";
import type { NewsEventPayload, AlertPayload } from "./contracts.js";
import { formatNewsTime, hasHebrew } from "./text-utils.js";

const DashboardMap = lazy(() => import("./map-kernel/renderer").then(m => ({ default: m.DashboardMap })));

interface AlertMapPanelProps {
  newsEvents: NewsEventPayload[];
  alerts: AlertPayload[];
  date?: Date;
}

export function AlertMapPanel({ newsEvents, alerts, date }: AlertMapPanelProps) {
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const handleSelect = (item: { kind: "news" | "alert"; id: string; payload: any }) => {
    setSelectedItem({
      kind: item.kind,
      newsEvent: item.kind === "news" ? item.payload : null,
      alert: item.kind === "alert" ? item.payload : null,
      title: item.kind === "alert" ? `Alert: ${item.payload.notificationId}` : item.payload.title
    });
  };

  const selectedNewsEvent = selectedItem?.kind === "news" ? selectedItem.newsEvent : null;
  const selectedAlert = selectedItem?.kind === "alert" ? selectedItem.alert : null;

  const selectedCountry = selectedNewsEvent?.country || (selectedAlert ? "Israel" : null);

  const selectedTitle =
    selectedItem?.kind === "news"
      ? String(selectedNewsEvent?.title ?? "")
      : selectedItem?.kind === "alert"
        ? `Red Alert: ${selectedAlert?.locations?.[0] || "Unknown Location"}`
        : "";

  const selectedSummary =
    selectedItem?.kind === "news"
      ? selectedNewsEvent?.summary && selectedNewsEvent.summary !== selectedNewsEvent.title
        ? String(selectedNewsEvent.summary)
        : null
      : selectedItem?.kind === "alert"
        ? `${selectedAlert?.threat} threat detected at ${selectedAlert?.locationCount} locations.`
        : null;

  const selectedEyebrow =
    selectedItem?.kind === "news"
      ? `${(selectedNewsEvent?.category || "news").toUpperCase()} · ${formatNewsTime(
          selectedNewsEvent?.updatedAtIso || selectedNewsEvent?.createdAtIso
        )}`
      : selectedItem?.kind === "alert"
        ? `LIVE ALERT · ${selectedAlert?.source}`
        : "";

  return (
    <section className="alert-map alert-map-stage" aria-label="Global threat globe">
      <div className="alert-map-shell">
        <Suspense fallback={<div className="alert-map-loading">Loading Orbital View...</div>}>
          <DashboardMap 
            alerts={alerts} 
            newsEvents={newsEvents} 
            selectedEventId={selectedItem?.kind === "news" ? selectedItem.newsEvent?.eventId : null}
            selectedCountry={selectedCountry}
            onSelect={handleSelect}
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
        
        {selectedItem && (
          <aside className="globe-event-card" aria-label="Selected world event">
            <button
              type="button"
              className="globe-event-close"
              aria-label="Close event details"
              onClick={() => setSelectedItem(null)}
            >
              Close
            </button>
            <p className="globe-event-eyebrow">{selectedEyebrow}</p>
            <h4
              className="globe-event-title"
              dir={hasHebrew(selectedTitle) ? "rtl" : "ltr"}
              lang={hasHebrew(selectedTitle) ? "he" : "en"}
            >
              {selectedTitle}
            </h4>
            {selectedSummary && (
              <p 
                className="globe-event-summary"
                dir={hasHebrew(selectedSummary) ? "rtl" : "ltr"}
                lang={hasHebrew(selectedSummary) ? "he" : "en"}
              >
                {selectedSummary}
              </p>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
