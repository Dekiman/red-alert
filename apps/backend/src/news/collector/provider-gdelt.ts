import { createHash } from "node:crypto";
import { clampSeverity, dedupeStrings, normalizeWhitespace, toIsoTimestamp } from "./provider-helpers.js";
import { isEnglishNewsCandidate, resolveNewsSourceLanguage } from "../language-filter.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

type CreateGdeltProviderOptions = {
  fetchJson: (url: string) => Promise<any>;
  apiUrl: string;
  query: string;
  maxRecords: number;
  maxEvents: number;
};

function buildEventId(article: any) {
  const eventKey = `${normalizeWhitespace(article?.url)}|${normalizeWhitespace(article?.seendate)}|${normalizeWhitespace(
    article?.title
  )}`;
  const hash = createHash("sha1").update(eventKey).digest("hex").slice(0, 20);
  return `gdelt-${hash}`;
}

function categorizeFromHeadline(headline: string) {
  const lower = headline.toLowerCase();
  if (
    lower.includes("strike") ||
    lower.includes("missile") ||
    lower.includes("attack") ||
    lower.includes("war") ||
    lower.includes("conflict")
  ) {
    return "conflict";
  }
  if (
    lower.includes("earthquake") ||
    lower.includes("flood") ||
    lower.includes("wildfire") ||
    lower.includes("storm") ||
    lower.includes("hurricane") ||
    lower.includes("eruption")
  ) {
    return "disaster";
  }
  return "news";
}

function severityFromHeadline(headline: string) {
  const lower = headline.toLowerCase();
  if (lower.includes("kills") || lower.includes("dead") || lower.includes("massive")) {
    return 4;
  }
  if (lower.includes("war") || lower.includes("missile") || lower.includes("earthquake")) {
    return 3;
  }
  return clampSeverity(2);
}

export function createGdeltProvider({
  fetchJson,
  apiUrl,
  query,
  maxRecords,
  maxEvents
}: CreateGdeltProviderOptions): OsintNewsProvider {
  return {
    name: "gdelt",
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const url = new URL(apiUrl);
      if (!url.searchParams.has("query")) {
        url.searchParams.set("query", query);
      }
      url.searchParams.set("mode", "artlist");
      url.searchParams.set("format", "json");
      url.searchParams.set("sort", "DateDesc");
      url.searchParams.set("maxrecords", String(Math.max(1, maxRecords)));

      const payload = await fetchJson(url.toString());
      const articles = Array.isArray(payload?.articles) ? payload.articles : [];
      const nowIso = new Date().toISOString();
      const collected: ProviderCollectedEvent[] = [];

      for (const article of articles) {
        const title = normalizeWhitespace(article?.title);
        const articleUrl = normalizeWhitespace(article?.url) || null;
        if (!title && !articleUrl) {
          continue;
        }
        if (!isEnglishNewsCandidate({ title, summary: title, sourceLanguage: resolveNewsSourceLanguage(article) })) {
          continue;
        }

        const eventId = buildEventId(article);
        const category = categorizeFromHeadline(title || "news");
        const sourceTypes = dedupeStrings(["gdelt", "osint", "news", category]);
        const updatedAtIso = toIsoTimestamp(article?.seendate) ?? nowIso;
        const createdAtIso = updatedAtIso;
        const sourceName = normalizeWhitespace(article?.domain) || "GDELT";
        const summary = title || normalizeWhitespace(article?.domain) || "GDELT article";

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: "gdelt",
            sourceName,
            sourceReliability: null,
            title: title || summary,
            content: summary,
            url: articleUrl,
            timestampIso: updatedAtIso,
            createdAtIso,
            accountHandle: null,
            tweetId: null,
            mediaUrls: [],
            fetchedAtIso: nowIso
          },
          raw: {
            title,
            url: articleUrl,
            sourceName
          }
        };

        collected.push({
          event: {
            eventId,
            title: title || summary,
            summary,
            category,
            severity: severityFromHeadline(title || summary),
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: true,
            locationName: null,
            country: null,
            region: null,
            lat: null,
            lng: null,
            createdAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: article,
          signals: [signal],
          primarySignalUrl: articleUrl,
          primarySourceName: sourceName
        });
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, Math.max(1, maxEvents));
    }
  };
}
