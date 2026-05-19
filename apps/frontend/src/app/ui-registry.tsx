import React from "react";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { uiCatalog } from "./ui-catalog";
import { formatTime, formatNewsTime, hasHebrew } from "./text-utils";
import { categorizeNewsTitleType } from "./news-categorizer";

import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";

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
        <Card className="alert-card overflow-hidden transition-all hover:border-red-500/50 p-0">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-bold text-red-500">
                {locationCount} location{locationCount === 1 ? "" : "s"}
              </h4>
              <span className="text-xs text-muted-foreground">
                {formatTime(alertTimestampIso)}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent text-[10px] uppercase tracking-wider bg-red-500/10 text-red-400 border-red-500/30">
                🚨 {source}
              </span>
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[10px] uppercase tracking-wider">
                Threat: {threat}
              </span>
              {isDrill && (
                <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80 text-[10px] uppercase tracking-wider">
                  DRILL
                </span>
              )}
            </div>

            <div className="h-px w-full bg-foreground/10 opacity-10" />

            <div className={`flex flex-col gap-1 ${direction === "rtl" ? "text-right font-hebrew" : "text-left"}`}>
              {locations.map((locationText, index) => (
                <p 
                  key={`${notificationId}-${locationText}-${index}`}
                  className="text-sm leading-tight text-slate-200"
                >
                  {locationText}
                </p>
              ))}
            </div>

            <span className="text-[10px] text-muted-foreground opacity-50">
              ID: {notificationId}
            </span>
          </div>
        </Card>
      );
    },

    NewsCard: ({ props }) => {
      const newsEvent = props;
      const titleType = categorizeNewsTitleType(newsEvent as any);
      const titleText = newsEvent.title || "Untitled news event";
      const titleDir = hasHebrew(titleText) ? "rtl" : "ltr";

      const summaryText =
        newsEvent.summary && newsEvent.summary !== newsEvent.title ? String(newsEvent.summary) : null;
      
      const locationParts = [newsEvent.locationName, newsEvent.region, newsEvent.country].filter(Boolean);
      const locationText = locationParts.length > 0 ? locationParts.join(" | ") : null;
      
      const badgeClass = newsEvent.severity && newsEvent.severity >= 4 
        ? "bg-destructive text-destructive-foreground hover:bg-destructive/80" 
        : "bg-secondary text-secondary-foreground hover:bg-secondary/80";

      return (
        <Card className="news-card overflow-hidden transition-all hover:border-emerald-500/50 p-0">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                {(newsEvent.category || "news").toUpperCase()}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatNewsTime(newsEvent.updatedAtIso || newsEvent.createdAtIso)}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              {newsEvent.primarySignalUrl ? (
                <a 
                  href={newsEvent.primarySignalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`text-sm font-semibold leading-tight text-foreground hover:underline ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"}`}
                >
                  {titleText}
                </a>
              ) : (
                <p className={`text-sm font-semibold leading-tight text-foreground ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"}`}>
                  {titleText}
                </p>
              )}

              {locationText && (
                <p className={`text-[10px] italic text-muted-foreground ${hasHebrew(locationText) ? "text-right font-hebrew" : "text-left"}`}>
                  {locationText}
                </p>
              )}
            </div>

            {summaryText && (
              <p className={`text-xs text-slate-400 line-clamp-3 ${hasHebrew(summaryText) ? "text-right font-hebrew" : "text-left"}`}>
                {summaryText}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-tighter border-muted-foreground/20 text-muted-foreground">
                {titleType}
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] uppercase tracking-tighter ${badgeClass}`}>
                Sev: {newsEvent.severity ?? "n/a"}
              </span>
              <span className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[9px] uppercase tracking-tighter">
                Signals: {newsEvent.signalCount ?? 0}
              </span>
            </div>

            {newsEvent.primarySignalUrl && (
              <div className="flex justify-end">
                <a 
                  href={newsEvent.primarySignalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors uppercase font-bold tracking-wider"
                >
                  Source: {newsEvent.primarySourceName || "news"} →
                </a>
              </div>
            )}
          </div>
        </Card>
      );
    },

    Metric: ({ props }) => {
      const { label, value } = props;
      return (
        <div className="flex justify-between items-center gap-2 border-b border-white/5 pb-1 metric">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}:
          </span>
          <span className="text-xs font-mono font-bold text-slate-100">
            {String(value)}
          </span>
        </div>
      );
    }
  },
});
