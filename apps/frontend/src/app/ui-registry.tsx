import React from "react";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { uiCatalog } from "./ui-catalog";
import { formatTime, formatNewsTime, hasHebrew } from "./text-utils";
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
        <Card className="group relative border border-white/10 bg-black/40 p-0 overflow-hidden transition-colors duration-200 hover:border-red-500/30">
          <div className="flex flex-col gap-4 p-4">
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

      const summaryText =
        newsEvent.summary && newsEvent.summary !== newsEvent.title ? String(newsEvent.summary) : null;
      
      const locationParts = [newsEvent.locationName, newsEvent.region, newsEvent.country].filter(Boolean);
      const locationText = locationParts.length > 0 ? locationParts.join(" | ") : null;
      
      const isCritical = newsEvent.severity && newsEvent.severity >= 4;

      return (
        <Card className="group relative border border-white/10 bg-black/40 p-0 overflow-hidden transition-colors duration-200 hover:border-emerald-500/30">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex justify-between items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-500">
                {(newsEvent.category || "News").toUpperCase()}
              </span>
              <span className="text-[11px] font-mono font-medium text-muted-foreground tabular-nums tracking-tight opacity-70">
                {formatNewsTime(newsEvent.updatedAtIso || newsEvent.createdAtIso)}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {newsEvent.primarySignalUrl ? (
                <a 
                  href={newsEvent.primarySignalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`text-sm font-bold leading-tight text-slate-100 hover:text-emerald-400 focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:outline-none transition-colors duration-200 ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"} text-pretty`}
                >
                  {titleText}
                </a>
              ) : (
                <p className={`text-sm font-bold leading-tight text-slate-100 ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"} text-pretty`}>
                  {titleText}
                </p>
              )}

              {locationText && (
                <p className={`text-[11px] font-medium text-emerald-500/80 tracking-tight ${hasHebrew(locationText) ? "text-right font-hebrew" : "text-left"}`}>
                  {locationText}
                </p>
              )}
            </div>

            {summaryText && (
              <p className={`text-[12px] leading-relaxed text-slate-400 line-clamp-3 ${hasHebrew(summaryText) ? "text-right font-hebrew" : "text-left"} text-pretty`}>
                {summaryText}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5 mt-auto">
              <span className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-white/5 text-muted-foreground border border-white/10">
                {titleType || "General"}
              </span>
              <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border tabular-nums ${isCritical ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>
                Sev:&nbsp;{newsEvent.severity ?? "0"}
              </span>
              <span className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-white/5 text-muted-foreground border border-white/10 tabular-nums">
                Signals:&nbsp;{newsEvent.signalCount ?? 0}
              </span>
              
              {newsEvent.primarySignalUrl && (
                <a 
                  href={newsEvent.primarySignalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-[10px] font-bold text-emerald-500 hover:text-emerald-400 focus-visible:underline focus-visible:outline-none transition-colors duration-200 uppercase tracking-widest"
                >
                  Source&nbsp;↗
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
