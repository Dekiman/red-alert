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
      const locationClassName = hasHebrewLocation ? "locations rtl" : "locations";

      return (
        <article className="card alert-card">
          <div className="card-head">
            <strong>
              {locationCount} location{locationCount === 1 ? "" : "s"}
            </strong>
            <span className="card-time">{formatTime(alertTimestampIso)}</span>
          </div>

          <div className="tags">
            <span className="tag">Source: {source}</span>
            <span className="tag">Threat: {threat}</span>
            <span className="tag">Drill: {isDrill ? "Yes" : "No"}</span>
            <span className="tag">ID: {notificationId}</span>
          </div>

          <ul className={locationClassName}>
            {locations.map((locationText, index) => (
              <li
                key={`${notificationId}-${locationText}-${index}`}
                dir={hasHebrew(locationText) ? "rtl" : "ltr"}
                lang={hasHebrew(locationText) ? "he" : "en"}
              >
                {locationText}
              </li>
            ))}
          </ul>
        </article>
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
      
      return (
        <article className="card news-card">
          <div className="card-head">
            <strong>{(newsEvent.category || "news").toUpperCase()}</strong>
            <span className="card-time">{formatNewsTime(newsEvent.updatedAtIso || newsEvent.createdAtIso)}</span>
          </div>

          {newsEvent.primarySignalUrl ? (
            <a
              className="news-title-link"
              href={newsEvent.primarySignalUrl}
              target="_blank"
              rel="noreferrer"
              dir={titleDir}
              lang={titleLang}
            >
              <span className="news-title">{titleText}</span>
            </a>
          ) : (
            <p className="news-title" dir={titleDir} lang={titleLang}>
              {titleText}
            </p>
          )}

          {summaryText ? (
            <p className="news-summary" dir={hasHebrew(summaryText) ? "rtl" : "ltr"} lang={hasHebrew(summaryText) ? "he" : "en"}>
              {summaryText}
            </p>
          ) : null}

          {locationText ? (
            <p className="news-location" dir={hasHebrew(locationText) ? "rtl" : "ltr"} lang={hasHebrew(locationText) ? "he" : "en"}>
              {locationText}
            </p>
          ) : null}

          <div className="tags">
            <span className="tag">Type: {titleType}</span>
            <span className="tag">Severity: {newsEvent.severity ?? "n/a"}</span>
            <span className="tag">Signals: {newsEvent.signalCount ?? 0}</span>
            <span className="tag">Sources: {sourceTypes || "unknown"}</span>
          </div>

          {newsEvent.primarySignalUrl ? (
            <a className="news-link" href={newsEvent.primarySignalUrl} target="_blank" rel="noreferrer">
              Open source ({newsEvent.primarySourceName || "news"})
            </a>
          ) : null}
        </article>
      );
    },

    Metric: ({ props }) => {
      const { label, value } = props;
      return (
        <div className="metric">
          {label}: <span>{value}</span>
        </div>
      );
    }
  },
});
