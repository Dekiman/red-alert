import type { NewsEvent } from "@red-alert/shared";
import { formatNewsTime, hasHebrew } from "../app/text-utils";
import { categorizeNewsTitleType } from "../app/news-categorizer";

export function NewsCard({ newsEvent }: { newsEvent: NewsEvent }) {
  const sourceTypes = Array.isArray(newsEvent.sourceTypes)
    ? newsEvent.sourceTypes.join(", ")
    : String(newsEvent.sourceTypesRaw || "");
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
}
