import { clampSeverity, dedupeStrings, normalizeWhitespace, parseCountryFromPlace, toIsoTimestamp } from "./provider-helpers.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

type CreateUsgsProviderOptions = {
  fetchJson: (url: string) => Promise<any>;
  apiUrl: string;
  maxEvents: number;
  throttleMs?: number;
};

function toEarthquakeSeverity(magnitude: unknown) {
  const numericMagnitude = Number(magnitude);
  if (!Number.isFinite(numericMagnitude)) {
    return null;
  }
  return clampSeverity(numericMagnitude);
}

export function createUsgsProvider({
  fetchJson,
  apiUrl,
  maxEvents,
  throttleMs
}: CreateUsgsProviderOptions): OsintNewsProvider {
  return {
    name: "usgs",
    throttleMs,
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const payload = await fetchJson(apiUrl);
      const features = Array.isArray(payload?.features) ? payload.features : [];
      const nowIso = new Date().toISOString();
      const collected: ProviderCollectedEvent[] = [];

      for (const feature of features) {
        const properties = feature?.properties ?? {};
        const eventIdRaw = normalizeWhitespace(feature?.id);
        if (!eventIdRaw) {
          continue;
        }

        const eventId = `usgs-${eventIdRaw}`;
        const title = normalizeWhitespace(properties?.title) || "USGS Earthquake Event";
        const place = normalizeWhitespace(properties?.place) || null;
        const magnitude = Number(properties?.mag);
        const summary =
          normalizeWhitespace(
            `${Number.isFinite(magnitude) ? `Magnitude ${magnitude}. ` : ""}${place ? `Location: ${place}. ` : ""}${
              normalizeWhitespace(properties?.status) ? `Status: ${normalizeWhitespace(properties?.status)}.` : ""
            }`
          ) || title;

        const createdAtIso = toIsoTimestamp(properties?.time) ?? nowIso;
        const updatedAtIso = toIsoTimestamp(properties?.updated) ?? createdAtIso;
        const coordinates = Array.isArray(feature?.geometry?.coordinates)
          ? feature.geometry.coordinates
          : [];
        const lng = Number(coordinates?.[0]);
        const lat = Number(coordinates?.[1]);
        const sourceTypes = dedupeStrings(["usgs", "osint", "earthquake", "disaster"]);
        const url = normalizeWhitespace(properties?.url) || null;

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: "usgs",
            sourceName: "USGS",
            sourceReliability: null,
            title,
            content: summary,
            url,
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
            url
          }
        };

        collected.push({
          event: {
            eventId,
            title,
            summary,
            category: "earthquake",
            severity: toEarthquakeSeverity(magnitude),
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: true,
            locationName: place,
            country: parseCountryFromPlace(place),
            region: null,
            lat: Number.isFinite(lat) ? lat : null,
            lng: Number.isFinite(lng) ? lng : null,
            createdAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: feature,
          signals: [signal],
          primarySignalUrl: url,
          primarySourceName: "USGS"
        });
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, Math.max(1, maxEvents));
    }
  };
}
