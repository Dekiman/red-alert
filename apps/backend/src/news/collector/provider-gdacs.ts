import { parseBooleanLike } from "../../utils/primitives.js";
import {
  clampSeverity,
  dedupeStrings,
  normalizeWhitespace,
  stripHtmlTags,
  toIsoTimestamp
} from "./provider-helpers.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

const GDACS_EVENT_TYPE_TO_CATEGORY: Record<string, string> = {
  EQ: "earthquake",
  FL: "flood",
  TC: "cyclone",
  VO: "volcano",
  DR: "drought",
  WF: "wildfire",
  TS: "tsunami"
};

type CreateGdacsProviderOptions = {
  fetchJson: (url: string) => Promise<any>;
  apiUrl: string;
  lookbackDays: number;
  maxEvents: number;
};

export function createGdacsProvider({
  fetchJson,
  apiUrl,
  lookbackDays,
  maxEvents
}: CreateGdacsProviderOptions): OsintNewsProvider {
  return {
    name: "gdacs",
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const fromDateIso = new Date(Date.now() - Math.max(1, lookbackDays) * 86400000)
        .toISOString()
        .slice(0, 10);

      const url = new URL(apiUrl);
      url.searchParams.set("fromdate", fromDateIso);
      const payload = await fetchJson(url.toString());
      const features = Array.isArray(payload?.features) ? payload.features : [];
      const nowIso = new Date().toISOString();
      const collected: ProviderCollectedEvent[] = [];

      for (const feature of features) {
        const properties = feature?.properties ?? {};
        const eventType = normalizeWhitespace(properties?.eventtype).toUpperCase();
        const eventIdRaw = normalizeWhitespace(properties?.eventid);
        const episodeIdRaw = normalizeWhitespace(properties?.episodeid);
        if (!eventIdRaw) {
          continue;
        }

        const eventId = `gdacs-${eventType || "EVENT"}-${eventIdRaw}-${episodeIdRaw || "0"}`;
        const country = normalizeWhitespace(properties?.country) || null;
        const title =
          normalizeWhitespace(properties?.name) ||
          normalizeWhitespace(properties?.description) ||
          `GDACS ${eventType || "event"}${country ? ` in ${country}` : ""}`;
        const summary = stripHtmlTags(properties?.htmldescription || properties?.description || title) || title;
        const category = GDACS_EVENT_TYPE_TO_CATEGORY[eventType] ?? "disaster";
        const sourceTypes = dedupeStrings(["gdacs", "osint", "disaster", category]);
        const updatedAtIso =
          toIsoTimestamp(properties?.datemodified) ??
          toIsoTimestamp(properties?.todate) ??
          toIsoTimestamp(properties?.fromdate) ??
          nowIso;
        const createdAtIso =
          toIsoTimestamp(properties?.fromdate) ??
          toIsoTimestamp(properties?.todate) ??
          updatedAtIso;
        const alertScore = Number(properties?.alertscore);
        const severity = clampSeverity(Number.isFinite(alertScore) ? alertScore + 1 : null);

        const coordinates = Array.isArray(feature?.geometry?.coordinates)
          ? feature.geometry.coordinates
          : [];
        const lng = Number(coordinates?.[0]);
        const lat = Number(coordinates?.[1]);
        const reportUrl = normalizeWhitespace(properties?.url?.report) || null;
        const sourceName = normalizeWhitespace(properties?.source) || "GDACS";

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: "gdacs",
            sourceName,
            sourceReliability: null,
            title,
            content: summary,
            url: reportUrl,
            timestampIso: updatedAtIso,
            createdAtIso,
            accountHandle: null,
            tweetId: null,
            mediaUrls: [],
            fetchedAtIso: nowIso
          },
          raw: {
            title,
            summary,
            reportUrl,
            sourceName
          }
        };

        collected.push({
          event: {
            eventId,
            title,
            summary,
            category,
            severity,
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: parseBooleanLike(properties?.iscurrent, true),
            locationName: country ?? (normalizeWhitespace(properties?.name) || null),
            country,
            region: null,
            lat: Number.isFinite(lat) ? lat : null,
            lng: Number.isFinite(lng) ? lng : null,
            createdAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: feature,
          signals: [signal],
          primarySignalUrl: reportUrl,
          primarySourceName: sourceName
        });
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, Math.max(1, maxEvents));
    }
  };
}
