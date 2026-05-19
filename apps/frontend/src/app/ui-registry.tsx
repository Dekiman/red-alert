import React from "react";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { uiCatalog } from "./ui-catalog";
import { formatTime, formatNewsTime, hasHebrew } from "./text-utils";
import { categorizeNewsTitleType } from "./news-categorizer";

export const { registry } = defineRegistry(uiCatalog, {
  components: {
    // Standard shadcn implementations
    Card: shadcnComponents.Card,
    Stack: shadcnComponents.Stack,
    Text: shadcnComponents.Text,
    Badge: shadcnComponents.Badge,
    Separator: shadcnComponents.Separator,
    Button: shadcnComponents.Button,
    Heading: shadcnComponents.Heading,

    // Custom implementations
    AlertCard: ({ props }) => {
      const { notificationId, source, threat, isDrill, locations, locationCount, alertTimestampIso } = props;
      const hasHebrewLocation = locations.some((value) => hasHebrew(value));
      const direction = hasHebrewLocation ? "rtl" : "ltr";

      return (
        <shadcnComponents.Card className="alert-card overflow-hidden transition-all hover:border-red-500/50">
          <shadcnComponents.Stack direction="vertical" gap={3} className="p-4">
            <shadcnComponents.Stack direction="horizontal" justify="between" align="center">
              <shadcnComponents.Heading level={4} className="text-sm font-bold text-red-500">
                {locationCount} location{locationCount === 1 ? "" : "s"}
              </shadcnComponents.Heading>
              <shadcnComponents.Text variant="muted" className="text-xs">
                {formatTime(alertTimestampIso)}
              </shadcnComponents.Text>
            </shadcnComponents.Stack>

            <shadcnComponents.Stack direction="horizontal" gap={2} className="flex-wrap">
              <shadcnComponents.Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-red-500/10 text-red-400 border-red-500/30">
                🚨 {source}
              </shadcnComponents.Badge>
              <shadcnComponents.Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                Threat: {threat}
              </shadcnComponents.Badge>
              {isDrill && (
                <shadcnComponents.Badge variant="destructive" className="text-[10px] uppercase tracking-wider">
                  DRILL
                </shadcnComponents.Badge>
              )}
            </shadcnComponents.Stack>

            <shadcnComponents.Separator className="opacity-10" />

            <shadcnComponents.Stack 
              direction="vertical" 
              gap={1} 
              className={direction === "rtl" ? "text-right font-hebrew" : "text-left"}
            >
              {locations.map((locationText, index) => (
                <shadcnComponents.Text 
                  key={`${notificationId}-${locationText}-${index}`}
                  variant="body"
                  className="text-sm leading-tight text-slate-200"
                >
                  {locationText}
                </shadcnComponents.Text>
              ))}
            </shadcnComponents.Stack>

            <shadcnComponents.Text variant="muted" className="text-[10px] opacity-50">
              ID: {notificationId}
            </shadcnComponents.Text>
          </shadcnComponents.Stack>
        </shadcnComponents.Card>
      );
    },

    NewsCard: ({ props }) => {
      const newsEvent = props;
      const sourceTypes = Array.isArray(newsEvent.sourceTypes)
        ? newsEvent.sourceTypes.join(", ")
        : "";
      const titleType = categorizeNewsTitleType(newsEvent as any);
      const titleText = newsEvent.title || "Untitled news event";
      const titleDir = hasHebrew(titleText) ? "rtl" : "ltr";
      const titleLang = hasHebrew(titleText) ? "he" : "en";

      const summaryText =
        newsEvent.summary && newsEvent.summary !== newsEvent.title ? String(newsEvent.summary) : null;
      
      const locationParts = [newsEvent.locationName, newsEvent.region, newsEvent.country].filter(Boolean);
      const locationText = locationParts.length > 0 ? locationParts.join(" | ") : null;
      
      const severityColor = newsEvent.severity && newsEvent.severity >= 4 ? "text-red-400" : "text-emerald-400";
      const badgeVariant = newsEvent.severity && newsEvent.severity >= 4 ? "destructive" : "secondary";

      return (
        <shadcnComponents.Card className="news-card overflow-hidden transition-all hover:border-emerald-500/50">
          <shadcnComponents.Stack direction="vertical" gap={3} className="p-4">
            <shadcnComponents.Stack direction="horizontal" justify="between" align="center">
              <shadcnComponents.Text variant="lead" className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                {(newsEvent.category || "news").toUpperCase()}
              </shadcnComponents.Text>
              <shadcnComponents.Text variant="muted" className="text-xs">
                {formatNewsTime(newsEvent.updatedAtIso || newsEvent.createdAtIso)}
              </shadcnComponents.Text>
            </shadcnComponents.Stack>

            <shadcnComponents.Stack direction="vertical" gap={1}>
              {newsEvent.primarySignalUrl ? (
                <shadcnComponents.Link 
                  href={newsEvent.primarySignalUrl}
                  className={`text-sm font-semibold leading-tight hover:underline ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"}`}
                >
                  {titleText}
                </shadcnComponents.Link>
              ) : (
                <shadcnComponents.Text 
                  variant="body" 
                  className={`text-sm font-semibold leading-tight ${titleDir === "rtl" ? "text-right font-hebrew" : "text-left"}`}
                >
                  {titleText}
                </shadcnComponents.Text>
              )}

              {locationText && (
                <shadcnComponents.Text 
                  variant="muted" 
                  className={`text-[10px] italic ${hasHebrew(locationText) ? "text-right font-hebrew" : "text-left"}`}
                >
                  {locationText}
                </shadcnComponents.Text>
              )}
            </shadcnComponents.Stack>

            {summaryText && (
              <shadcnComponents.Text 
                variant="body" 
                className={`text-xs text-slate-400 line-clamp-3 ${hasHebrew(summaryText) ? "text-right font-hebrew" : "text-left"}`}
              >
                {summaryText}
              </shadcnComponents.Text>
            )}

            <shadcnComponents.Stack direction="horizontal" gap={2} className="flex-wrap pt-1">
              <shadcnComponents.Badge variant="outline" className="text-[9px] uppercase tracking-tighter">
                {titleType}
              </shadcnComponents.Badge>
              <shadcnComponents.Badge variant={badgeVariant} className="text-[9px] uppercase tracking-tighter">
                Sev: {newsEvent.severity ?? "n/a"}
              </shadcnComponents.Badge>
              <shadcnComponents.Badge variant="secondary" className="text-[9px] uppercase tracking-tighter">
                Signals: {newsEvent.signalCount ?? 0}
              </shadcnComponents.Badge>
            </shadcnComponents.Stack>

            {newsEvent.primarySignalUrl && (
              <shadcnComponents.Stack direction="horizontal" justify="end">
                <shadcnComponents.Link 
                  href={newsEvent.primarySignalUrl}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors uppercase font-bold tracking-wider"
                >
                  Source: {newsEvent.primarySourceName || "news"} →
                </shadcnComponents.Link>
              </shadcnComponents.Stack>
            )}
          </shadcnComponents.Stack>
        </shadcnComponents.Card>
      );
    },

    Metric: ({ props }) => {
      const { label, value } = props;
      return (
        <shadcnComponents.Stack direction="horizontal" gap={2} align="center" justify="between" className="metric border-b border-white/5 pb-1">
          <shadcnComponents.Text variant="muted" className="text-[10px] uppercase tracking-wider">
            {label}:
          </shadcnComponents.Text>
          <shadcnComponents.Text variant="body" className="text-xs font-mono font-bold text-slate-100">
            {String(value)}
          </shadcnComponents.Text>
        </shadcnComponents.Stack>
      );
    }
  },
});
