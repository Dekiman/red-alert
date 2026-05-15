import { useMemo } from "react";
import type { NewsEventPayload } from "./contracts.js";
import { formatNewsTime, hasHebrew } from "./text-utils.js";

export type OsintStreamConnectionState = "live" | "down" | "connecting";

interface OsintStreamCardProps {
  connectionState: OsintStreamConnectionState;
  updatedAt: string;
  newsEvents: NewsEventPayload[];
}

interface SourceTypeCount {
  name: string;
  count: number;
}

const OSINT_SERVICE_LABELS = ["GDACS API", "USGS Earthquake Feed"];

function normalizeSourceTypeLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function splitEventSourceTypes(newsEvent: NewsEventPayload) {
  if (Array.isArray(newsEvent.sourceTypes) && newsEvent.sourceTypes.length > 0) {
    return newsEvent.sourceTypes;
  }
  return String(newsEvent.sourceTypesRaw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function rankSourceTypes(newsEvents: NewsEventPayload[]) {
  const counts = new Map<string, number>();
  for (const newsEvent of newsEvents) {
    const uniqueTypesForEvent = new Set(splitEventSourceTypes(newsEvent).map(normalizeSourceTypeLabel));
    for (const sourceType of uniqueTypesForEvent) {
      counts.set(sourceType, (counts.get(sourceType) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.name.localeCompare(b.name);
    });
}

function getConnectionLabel(connectionState: OsintStreamConnectionState) {
  if (connectionState === "live") {
    return "live";
  }
  if (connectionState === "down") {
    return "disconnected";
  }
  return "connecting";
}

export function OsintStreamCard({ connectionState, updatedAt, newsEvents }: OsintStreamCardProps) {
  const topSourceTypes = useMemo<SourceTypeCount[]>(() => rankSourceTypes(newsEvents).slice(0, 6), [newsEvents]);
  const latestEvent = newsEvents[0] ?? null;
  const latestTitle = latestEvent?.title ? String(latestEvent.title) : null;
  const latestTitleHasHebrew = latestTitle ? hasHebrew(latestTitle) : false;
  const latestLocation = [latestEvent?.locationName, latestEvent?.region, latestEvent?.country]
    .filter(Boolean)
    .join(" | ");

  return (
    <section className="osint-stream-card card" aria-label="OSINT global news stream">
      <div className="osint-stream-head">
        <div>
          <h3 className="osint-stream-title">OSINT Global Stream</h3>
          <p className="osint-stream-subtitle">Realtime global updates from integrated OSINT services.</p>
        </div>
        <span className={`osint-stream-state ${connectionState}`}>{getConnectionLabel(connectionState)}</span>
      </div>

      <div className="osint-stream-services">
        {OSINT_SERVICE_LABELS.map((serviceLabel) => (
          <span key={serviceLabel} className="osint-service-chip">
            {serviceLabel}
          </span>
        ))}
      </div>

      <div className="osint-stream-metrics">
        <span className="osint-mini">
          Stream events: <strong>{newsEvents.length}</strong>
        </span>
        <span className="osint-mini">
          Updated: <strong>{updatedAt}</strong>
        </span>
      </div>

      {topSourceTypes.length > 0 ? (
        <div className="osint-stream-tags">
          {topSourceTypes.map((sourceType) => (
            <span key={sourceType.name} className="tag">
              {sourceType.name}: {sourceType.count}
            </span>
          ))}
        </div>
      ) : null}

      {latestEvent && latestTitle ? (
        <div className="osint-stream-latest">
          <p
            className="osint-stream-latest-title"
            dir={latestTitleHasHebrew ? "rtl" : "ltr"}
            lang={latestTitleHasHebrew ? "he" : "en"}
          >
            {latestTitle}
          </p>
          <p className="osint-stream-latest-meta">
            {formatNewsTime(latestEvent.updatedAtIso || latestEvent.createdAtIso)}
          </p>
          {latestLocation ? <p className="osint-stream-latest-location">{latestLocation}</p> : null}
        </div>
      ) : (
        <div className="osint-stream-empty">Waiting for OSINT global events...</div>
      )}
    </section>
  );
}
