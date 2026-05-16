import { useEffect, useRef, useState } from "react";
import { createAlertMapController, type GlobeSelection } from "./alert-map.js";
import type { NewsEventPayload } from "./contracts.js";
import { formatNewsTime, hasHebrew } from "./text-utils.js";

export interface AlertMapControllerHandle {
  initInteractions: () => void;
  init: () => void;
  updateVisuals: () => void;
  resetState: () => void;
  activateFromAlert: (alert: unknown) => void;
  applyInferredStates: (states: unknown) => void;
  setNewsEvents: (newsEvents: NewsEventPayload[]) => void;
  clearNewsSelection: () => void;
  setReplayTimeUnix: (unixSeconds: number) => void;
  clearReplayTime: () => void;
  handleSystemMessage: (message: unknown) => void;
  destroy: () => void;
}

interface AlertMapPanelProps {
  onControllerReady: (controller: AlertMapControllerHandle | null) => void;
  newsEvents: NewsEventPayload[];
}

export function AlertMapPanel({ onControllerReady, newsEvents }: AlertMapPanelProps) {
  const [selectedItem, setSelectedItem] = useState<GlobeSelection | null>(null);
  const globeContainerRef = useRef<HTMLDivElement | null>(null);
  const alertMapStatusRef = useRef<HTMLSpanElement | null>(null);
  const mapZoomInButtonRef = useRef<HTMLButtonElement | null>(null);
  const mapZoomOutButtonRef = useRef<HTMLButtonElement | null>(null);
  const mapZoomResetButtonRef = useRef<HTMLButtonElement | null>(null);
  const controllerRef = useRef<AlertMapControllerHandle | null>(null);

  useEffect(() => {
    const controller = createAlertMapController({
      globeContainer: globeContainerRef.current,
      alertMapStatus: alertMapStatusRef.current,
      mapZoomInButton: mapZoomInButtonRef.current,
      mapZoomOutButton: mapZoomOutButtonRef.current,
      mapZoomResetButton: mapZoomResetButtonRef.current,
      onSelectionChanged: setSelectedItem
    }) as AlertMapControllerHandle;

    controllerRef.current = controller;
    controller.initInteractions();
    controller.init();
    controller.setNewsEvents(newsEvents);
    onControllerReady(controller);

    const intervalId = window.setInterval(() => controller.updateVisuals(), 250);
    return () => {
      window.clearInterval(intervalId);
      controller.destroy();
      controller.resetState();
      controllerRef.current = null;
      setSelectedItem(null);
      onControllerReady(null);
    };
  }, [onControllerReady]);

  useEffect(() => {
    controllerRef.current?.setNewsEvents(newsEvents);
  }, [newsEvents]);

  useEffect(() => {
    if (!selectedItem || selectedItem.kind !== "news") {
      return;
    }

    const stillVisible = newsEvents.some((newsEvent) => newsEvent.eventId === selectedItem.newsEvent.eventId);
    if (!stillVisible) {
      setSelectedItem(null);
      controllerRef.current?.clearNewsSelection();
    }
  }, [newsEvents, selectedItem]);

  const selectedNewsEvent = selectedItem?.kind === "news" ? selectedItem.newsEvent : null;
  const selectedLocation = [selectedNewsEvent?.locationName, selectedNewsEvent?.region, selectedNewsEvent?.country]
    .filter(Boolean)
    .join(" | ");
  const selectedTitle =
    selectedItem?.kind === "news"
      ? String(selectedNewsEvent?.title ?? "")
      : selectedItem?.kind === "celestial"
        ? selectedItem.title
        : "";
  const selectedSummary =
    selectedItem?.kind === "news"
      ? selectedNewsEvent?.summary && selectedNewsEvent.summary !== selectedNewsEvent.title
        ? String(selectedNewsEvent.summary)
        : null
      : selectedItem?.kind === "celestial"
        ? selectedItem.summary
        : null;
  const selectedEyebrow =
    selectedItem?.kind === "news"
      ? `${(selectedNewsEvent?.category || "news").toUpperCase()} · ${formatNewsTime(
          selectedNewsEvent?.updatedAtIso || selectedNewsEvent?.createdAtIso
        )}`
      : selectedItem?.kind === "celestial"
        ? "CELESTIAL MARKER"
        : "";

  return (
    <section className="alert-map alert-map-stage" aria-label="Global threat globe">
      <div className="alert-map-shell">
        <div
          className="alert-globe-canvas"
          ref={globeContainerRef}
          role="img"
          aria-label="3D globe with live alerts and news markers"
        ></div>
        <div className="globe-overlay globe-overlay-toolbar">
          <div className="globe-toolbar">
            <span className="alert-map-status" ref={alertMapStatusRef}>
              Initializing orbital view
            </span>
            <div className="map-controls" aria-label="Map zoom controls">
              <button
                id="mapZoomOut"
                className="map-control-btn"
                type="button"
                aria-label="Zoom out"
                ref={mapZoomOutButtonRef}
              >
                -
              </button>
              <button
                id="mapZoomReset"
                className="map-control-btn reset"
                type="button"
                aria-label="Reset zoom"
                ref={mapZoomResetButtonRef}
              >
                1:1
              </button>
              <button
                id="mapZoomIn"
                className="map-control-btn"
                type="button"
                aria-label="Zoom in"
                ref={mapZoomInButtonRef}
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div className="globe-overlay globe-overlay-legend">
          <span className="legend-chip">
            <span className="legend-swatch live"></span>
            Active siren
          </span>
          <span className="legend-chip">
            <span className="legend-swatch unsafe"></span>
            Unsafe
          </span>
          <span className="legend-chip">
            <span className="legend-swatch pre"></span>
            Pre-alert
          </span>
          <span className="legend-chip">
            <span className="legend-swatch news"></span>
            Global news
          </span>
        </div>
        <div className="globe-overlay globe-overlay-bottom">
          Drag to orbit. Scroll to zoom. Click a world-event dot or the sun and moon markers to inspect details.
        </div>
        {selectedItem ? (
          <aside className="globe-event-card" aria-label="Selected world event">
            <button
              type="button"
              className="globe-event-close"
              aria-label="Close event details"
              onClick={() => {
                setSelectedItem(null);
                controllerRef.current?.clearNewsSelection();
              }}
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
            {selectedSummary ? (
              <p
                className="globe-event-summary"
                dir={hasHebrew(selectedSummary) ? "rtl" : "ltr"}
                lang={hasHebrew(selectedSummary) ? "he" : "en"}
              >
                {selectedSummary}
              </p>
            ) : null}
            {selectedLocation ? (
              <p
                className="globe-event-location"
                dir={hasHebrew(selectedLocation) ? "rtl" : "ltr"}
                lang={hasHebrew(selectedLocation) ? "he" : "en"}
              >
                {selectedLocation}
              </p>
            ) : null}
            {selectedNewsEvent ? (
              <div className="globe-event-meta">
                <span>Severity {selectedNewsEvent.severity ?? "n/a"}</span>
                <span>Signals {selectedNewsEvent.signalCount ?? 0}</span>
              </div>
            ) : null}
            {selectedNewsEvent?.primarySignalUrl ? (
              <a
                className="globe-event-link"
                href={selectedNewsEvent.primarySignalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open source
              </a>
            ) : null}
          </aside>
        ) : (
          <div className="globe-event-hint">Select a world event, sun, or moon marker for a precise readout.</div>
        )}
      </div>
    </section>
  );
}
