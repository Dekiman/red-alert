import { useMemo, useState } from "react";
import type { NewsEventPayload } from "./contracts.js";
import { formatNewsTime, hasHebrew } from "./text-utils.js";
import { Activity, ChevronDown, ChevronUp, Radio, Signal } from "lucide-react";
import { Card } from "../components/ui/card";

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
    return "Live";
  }
  if (connectionState === "down") {
    return "Disconnected";
  }
  return "Connecting";
}

export function OsintStreamCard({ connectionState, updatedAt, newsEvents }: OsintStreamCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const topSourceTypes = useMemo<SourceTypeCount[]>(() => rankSourceTypes(newsEvents).slice(0, 6), [newsEvents]);
  const latestEvent = newsEvents[0] ?? null;
  const latestTitle = latestEvent?.title ? String(latestEvent.title) : null;
  const latestTitleHasHebrew = latestTitle ? hasHebrew(latestTitle) : false;
  const latestLocation = [latestEvent?.locationName, latestEvent?.region, latestEvent?.country]
    .filter(Boolean)
    .join(" | ");

  return (
    <Card 
      className={`transition-all duration-200 border-l-2 ${connectionState === "live" ? "border-l-blue-500 bg-blue-500/5" : "border-l-transparent bg-white/[0.03]"}`}
      aria-label="OSINT global news stream"
    >
      <div className={`flex flex-col ${isCollapsed ? "p-3" : "gap-4 p-4"}`}>
        <div className="flex justify-between items-center gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className="text-[13px] font-bold tracking-tight text-blue-500 uppercase flex items-center gap-1.5 truncate">
              <Signal className="w-3.5 h-3.5 shrink-0" />
              OSINT Stream
              {isCollapsed && connectionState === "live" && (
                <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              )}
            </h3>
            {!isCollapsed && (
              <p className="text-[11px] text-muted-foreground font-medium leading-tight">
                Realtime global incident updates.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isCollapsed && (
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${connectionState === "live" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" : "border-white/10 text-muted-foreground bg-white/5"}`}>
                {getConnectionLabel(connectionState)}
              </span>
            )}
            <button
              type="button"
              className="p-1 rounded-md text-muted-foreground hover:text-blue-500 hover:bg-white/5 transition-colors"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
            >
              {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-300">
            <div className="flex flex-wrap gap-1">
              {OSINT_SERVICE_LABELS.map((serviceLabel) => (
                <span key={serviceLabel} className="px-2 py-0.5 rounded-sm bg-white/5 border border-white/10 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  {serviceLabel}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 py-2 border-y border-white/5">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Total Events</span>
                <span className="text-[11px] font-bold text-slate-100 tabular-nums flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-blue-500/50" />
                  {newsEvents.length}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Updated</span>
                <span className="text-[11px] font-mono font-bold text-slate-100 tabular-nums">
                  {updatedAt}
                </span>
              </div>
            </div>

            {topSourceTypes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {topSourceTypes.map((sourceType) => (
                  <span key={sourceType.name} className="px-1.5 py-0.5 rounded-sm bg-blue-500/10 border border-blue-500/20 text-[9px] font-bold text-blue-400 uppercase tracking-tight tabular-nums">
                    {sourceType.name}:&nbsp;{sourceType.count}
                  </span>
                ))}
              </div>
            )}

            {latestEvent && latestTitle ? (
              <div className="p-2 rounded bg-white/[0.03] border border-white/5 flex flex-col gap-1.5">
                <p
                  className={`text-[12px] font-bold leading-snug text-slate-200 ${latestTitleHasHebrew ? "text-right font-hebrew" : "text-left"} text-pretty line-clamp-2`}
                >
                  {latestTitle}
                </p>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums opacity-70">
                    {formatNewsTime(latestEvent.updatedAtIso || latestEvent.createdAtIso)}
                  </span>
                  {latestLocation && (
                    <span className="text-[10px] font-medium text-blue-400 truncate max-w-[120px]">
                      {latestLocation}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded border border-dashed border-white/10 text-center">
                <p className="text-[11px] font-medium text-muted-foreground">Waiting for OSINT signals…</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
