import React from "react";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { uiCatalog } from "./ui-catalog";
import { formatTime, formatNewsTime, hasHebrew, cleanAndLimitSummary } from "./text-utils";
import { categorizeNewsTitleType } from "./news-categorizer";

import { Card } from "../components/ui/card";

export const { registry } = defineRegistry(uiCatalog, {
  components: {
    // Standard shadcn implementations for the Renderer
    Card: shadcnComponents.Card,
    Stack: shadcnComponents.Stack,
    Text: shadcnComponents.Text,
    Badge: shadcnComponents.Badge,
    Separator: shadcnComponents.Separator,
    Button: shadcnComponents.Button,
    Heading: shadcnComponents.Heading,

    // Custom implementations using local React components and Tailwind
    AlertCard: ({ props }) => {
      const { notificationId, source, threat, isDrill, locations, locationCount, alertTimestampIso } = props;
      const hasHebrewLocation = locations.some((value) => hasHebrew(value));
      const direction = hasHebrewLocation ? "rtl" : "ltr";

      return (
        <Card className="group relative border border-white/10 bg-black/40 p-0 transition-colors duration-200 hover:border-red-500/30 min-h-[140px]">
          <div className="flex flex-col gap-4 p-4 flex-1">
            <div className="flex justify-between items-baseline gap-2">
              <h4 className="text-[13px] font-bold tracking-tight text-red-500 uppercase">
                {locationCount}&nbsp;Location{locationCount === 1 ? "" : "s"}
              </h4>
              <span className="text-[11px] font-mono font-medium text-muted-foreground tabular-nums tracking-tight opacity-70">
                {formatTime(alertTimestampIso)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-red-500/10 text-red-400 border border-red-500/20">
                {source}
              </span>
              <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-white/5 text-slate-300 border border-white/10 tabular-nums">
                Threat&nbsp;{threat}
              </span>
              {isDrill && (
                <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Drill
                </span>
              )}
            </div>

            <div className={`flex flex-col gap-1.5 ${direction === "rtl" ? "text-right" : "text-left"}`}>
              {locations.map((locationText, index) => (
                <p 
                  key={`${notificationId}-${locationText}-${index}`}
                  className={`text-[13px] leading-tight text-slate-200 font-medium ${hasHebrew(locationText) ? "font-hebrew" : ""}`}
                >
                  {locationText}
                </p>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-auto">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest opacity-40">
                ID:&nbsp;{notificationId.slice(-8)}
              </span>
            </div>
          </div>
        </Card>
      );
    },

    NewsCard: ({ props }) => {
      const newsEvent = props;
      const titleType = categorizeNewsTitleType(newsEvent as any);
      const titleText = newsEvent.title || "Untitled event";
      const titleDir = hasHebrew(titleText) ? "rtl" : "ltr";
      const url = newsEvent.primarySignalUrl ?? null;
      const sourceName = newsEvent.primarySourceName ?? null;

      const cleanedSummary = newsEvent.summary ? cleanAndLimitSummary(newsEvent.summary) : "";
      const summaryText =
        cleanedSummary && cleanedSummary !== newsEvent.title ? cleanedSummary : null;
      
      const locationParts = [newsEvent.locationName, newsEvent.region, newsEvent.country].filter(Boolean);
      const locationText = locationParts.length > 0 ? locationParts.join(" | ") : null;
      
      const isCritical = newsEvent.severity && newsEvent.severity >= 4;

      // Category badge colour
      const categoryColors: Record<string, string> = {
        "Earthquake": "bg-orange-500/15 text-orange-400 border-orange-500/30",
        "Weather":    "bg-sky-500/15 text-sky-400 border-sky-500/30",
        "News":       "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
        "Other":      "bg-white/5 text-muted-foreground border-white/10",
      };
      const categoryColor = categoryColors[titleType] ?? categoryColors["Other"];

      return (
        <Card className="group relative border border-white/10 bg-black/40 p-0 transition-all duration-200 hover:border-white/20 hover:bg-black/60">
          <div className="flex flex-col gap-0 p-0">
            {/* Header row: category + source + time */}
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border shrink-0 ${categoryColor}`}>
                  {titleType}
                </span>
                {sourceName && (
                  <span className="text-[10px] font-semibold text-muted-foreground truncate max-w-[120px]">
                    {sourceName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isCritical && (
                  <span className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 tabular-nums">
                    Sev {newsEvent.severity}
                  </span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums opacity-60">
                  {formatNewsTime(newsEvent.updatedAtIso || newsEvent.createdAtIso)}
                </span>
              </div>
            </div>

            {/* Title — full-width clickable link when URL available */}
            <div className="px-4 pb-2">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className={`group/link flex items-start gap-1.5 text-sm font-semibold leading-snug text-slate-100 hover:text-emerald-300 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 rounded ${titleDir === "rtl" ? "text-right font-hebrew flex-row-reverse" : "text-left"} text-pretty`}
                >
                  <span>{titleText}</span>
                  <svg className="w-3 h-3 mt-0.5 shrink-0 opacity-40 group-hover/link:opacity-80 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              ) : (
                <p className={`text-sm font-semibold leading-snug text-slate-100 ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"} text-pretty`}>
                  {titleText}
                </p>
              )}
            </div>

            {/* Location */}
            {locationText && (
              <div className="px-4 pb-1.5">
                <p className={`text-[11px] font-medium text-emerald-500/70 tracking-tight ${hasHebrew(locationText) ? "text-right font-hebrew" : "text-left"}`}>
                  📍 {locationText}
                </p>
              </div>
            )}

            {/* Summary */}
            {summaryText && (
              <div className="px-4 pb-3">
                <p className={`text-[12px] leading-relaxed text-slate-400 ${hasHebrew(summaryText) ? "text-right font-hebrew" : "text-left"} text-pretty`}>
                  {summaryText}
                </p>
              </div>
            )}

            {/* Footer: signals count + open source link */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 mt-auto">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest opacity-40 tabular-nums">
                Signals: {newsEvent.signalCount ?? 0}
              </span>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-bold text-emerald-500 hover:text-emerald-300 transition-colors duration-150 uppercase tracking-widest focus-visible:outline-none focus-visible:underline"
                >
                  Open source ↗
                </a>
              )}
            </div>
          </div>
        </Card>
      );
    },

    Metric: ({ props }) => {
      const { label, value } = props;
      return (
        <div className="flex justify-between items-center gap-4 py-1.5 border-b border-white/5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </span>
          <span className="text-[12px] font-mono font-bold text-slate-100 tabular-nums">
            {String(value)}
          </span>
        </div>
      );
    }
  },
});
