import {
  clampSeverity,
  dedupeStrings,
  getGeoGeometryCenter,
  normalizeWhitespace,
  toIsoTimestamp
} from "./provider-helpers.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

type CreateWeatherCanadaProviderOptions = {
  fetchJson: (url: string) => Promise<any>;
  apiUrl: string;
  maxEvents: number;
};

const RISK_COLOR_SEVERITY_MAP: Record<string, number> = {
  green: 2,
  yellow: 3,
  orange: 4,
  red: 5
};

const IMPACT_SEVERITY_MAP: Record<string, number> = {
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5
};

function severityFromCanadaAlert(riskColor: unknown, impact: unknown) {
  const riskSeverity = RISK_COLOR_SEVERITY_MAP[normalizeWhitespace(riskColor).toLowerCase()] ?? null;
  const impactSeverity = IMPACT_SEVERITY_MAP[normalizeWhitespace(impact).toLowerCase()] ?? null;
  return clampSeverity(Math.max(riskSeverity ?? 0, impactSeverity ?? 0, 2));
}

export function createWeatherCanadaProvider({
  fetchJson,
  apiUrl,
  maxEvents
}: CreateWeatherCanadaProviderOptions): OsintNewsProvider {
  return {
    name: "weather_canada",
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const payload = await fetchJson(apiUrl);
      const features = Array.isArray(payload?.features) ? payload.features : [];
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const collected: ProviderCollectedEvent[] = [];

      for (const feature of features) {
        const properties = feature?.properties ?? {};
        const rawIdentifier = normalizeWhitespace(properties?.id ?? feature?.id);
        if (!rawIdentifier) {
          continue;
        }

        const expiresAtIso =
          toIsoTimestamp(properties?.expiration_datetime) ??
          toIsoTimestamp(properties?.event_end_datetime);
        if (expiresAtIso && new Date(expiresAtIso).getTime() < nowMs) {
          continue;
        }

        const locationName = normalizeWhitespace(properties?.feature_name_en);
        const alertName = normalizeWhitespace(properties?.alert_name_en) || "Environment Canada Alert";
        const title = locationName ? `${alertName}: ${locationName}` : alertName;
        const summary =
          normalizeWhitespace(properties?.alert_text_en) ||
          normalizeWhitespace(properties?.alert_short_name_en) ||
          title;
        const category = "weather";
        const sourceTypes = dedupeStrings(["weather_canada", "official", "warning", category]);
        const createdAtIso =
          toIsoTimestamp(properties?.publication_datetime) ??
          toIsoTimestamp(properties?.validity_datetime) ??
          nowIso;
        const updatedAtIso =
          toIsoTimestamp(properties?.publication_datetime) ??
          toIsoTimestamp(properties?.event_end_datetime) ??
          createdAtIso;
        const center = getGeoGeometryCenter(feature?.geometry);
        const sourceName = "Environment Canada";
        const eventId = `weather-canada-${rawIdentifier}`;

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: "weather_canada",
            sourceName,
            sourceReliability: null,
            title,
            content: summary,
            url: null,
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
            sourceName
          }
        };

        collected.push({
          event: {
            eventId,
            title,
            summary,
            category,
            severity: severityFromCanadaAlert(properties?.risk_colour_en, properties?.impact_en),
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: !expiresAtIso || new Date(expiresAtIso).getTime() >= nowMs,
            locationName: locationName || null,
            country: "Canada",
            region: normalizeWhitespace(properties?.province) || null,
            lat: Number.isFinite(center?.lat) ? Number(center?.lat) : null,
            lng: Number.isFinite(center?.lng) ? Number(center?.lng) : null,
            createdAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: feature,
          signals: [signal],
          primarySignalUrl: null,
          primarySourceName: sourceName
        });
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, Math.max(1, maxEvents));
    }
  };
}
