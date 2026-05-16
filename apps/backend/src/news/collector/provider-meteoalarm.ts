import {
  clampSeverity,
  decodeXmlEntities,
  dedupeStrings,
  normalizeWhitespace,
  toIsoTimestamp,
  toLooseIsoTimestamp
} from "./provider-helpers.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

type CreateMeteoalarmProviderOptions = {
  fetchText: (url: string) => Promise<string>;
  apiUrl: string;
  maxEvents: number;
};

type MeteoalarmCountrySnapshot = {
  name: string;
  lat: number;
  lng: number;
};

type MeteoalarmWarningWindow = {
  level: number;
  fromIso: string | null;
  untilIso: string | null;
};

const METEOALARM_COUNTRY_BY_REGION: Record<string, MeteoalarmCountrySnapshot> = {
  AD: { name: "Andorra", lat: 42.55, lng: 1.58 },
  AT: { name: "Austria", lat: 47.52, lng: 14.55 },
  BA: { name: "Bosnia and Herzegovina", lat: 44.18, lng: 17.82 },
  BE: { name: "Belgium", lat: 50.64, lng: 4.67 },
  BG: { name: "Bulgaria", lat: 42.76, lng: 25.24 },
  CH: { name: "Switzerland", lat: 46.82, lng: 8.23 },
  CY: { name: "Cyprus", lat: 35.13, lng: 33.43 },
  CZ: { name: "Czech Republic", lat: 49.82, lng: 15.47 },
  DE: { name: "Germany", lat: 51.16, lng: 10.45 },
  DK: { name: "Denmark", lat: 56.12, lng: 10.0 },
  EE: { name: "Estonia", lat: 58.7, lng: 25.01 },
  ES: { name: "Spain", lat: 40.25, lng: -3.7 },
  FI: { name: "Finland", lat: 64.5, lng: 26.0 },
  FR: { name: "France", lat: 46.23, lng: 2.21 },
  GB: { name: "United Kingdom", lat: 54.7, lng: -3.27 },
  GR: { name: "Greece", lat: 39.07, lng: 21.82 },
  HR: { name: "Croatia", lat: 45.1, lng: 15.2 },
  HU: { name: "Hungary", lat: 47.16, lng: 19.5 },
  IE: { name: "Ireland", lat: 53.14, lng: -8.0 },
  IL: { name: "Israel", lat: 31.05, lng: 34.85 },
  IS: { name: "Iceland", lat: 64.96, lng: -18.6 },
  IT: { name: "Italy", lat: 42.5, lng: 12.5 },
  LT: { name: "Lithuania", lat: 55.17, lng: 23.88 },
  LU: { name: "Luxembourg", lat: 49.75, lng: 6.17 },
  LV: { name: "Latvia", lat: 56.88, lng: 24.6 },
  MD: { name: "Moldova", lat: 47.41, lng: 28.37 },
  ME: { name: "Montenegro", lat: 42.78, lng: 19.37 },
  MK: { name: "North Macedonia", lat: 41.61, lng: 21.75 },
  MT: { name: "Malta", lat: 35.94, lng: 14.38 },
  NL: { name: "Netherlands", lat: 52.13, lng: 5.29 },
  NO: { name: "Norway", lat: 61.0, lng: 8.47 },
  PL: { name: "Poland", lat: 52.21, lng: 19.13 },
  PT: { name: "Portugal", lat: 39.55, lng: -8.0 },
  RO: { name: "Romania", lat: 45.94, lng: 24.97 },
  RS: { name: "Serbia", lat: 44.02, lng: 20.91 },
  SE: { name: "Sweden", lat: 62.0, lng: 15.0 },
  SI: { name: "Slovenia", lat: 46.15, lng: 14.99 },
  SK: { name: "Slovakia", lat: 48.67, lng: 19.7 },
  UA: { name: "Ukraine", lat: 48.38, lng: 31.17 }
};

function extractXmlTagValue(block: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(pattern);
  if (!match) {
    return null;
  }
  return normalizeWhitespace(decodeXmlEntities(match[1]));
}

function extractMeteoalarmWarnings(description: string) {
  const warningMatches = Array.from(
    decodeXmlEntities(description).matchAll(
      /data-awareness-level="(\d+)".*?data-awareness-type="(\d+)".*?<b>\s*From:\s*<\/b><i>([^<]+)<\/i><b>\s*Until:\s*<\/b><i>([^<]+)<\/i>/gsi
    )
  );

  const dedupedWindows = new Map<string, MeteoalarmWarningWindow>();
  for (const match of warningMatches) {
    const awarenessLevel = Number(match[1]);
    if (!Number.isFinite(awarenessLevel)) {
      continue;
    }

    const fromIso = toIsoTimestamp(match[3]);
    const untilIso = toIsoTimestamp(match[4]);
    const dedupeKey = `${awarenessLevel}|${fromIso ?? ""}|${untilIso ?? ""}`;
    dedupedWindows.set(dedupeKey, {
      level: awarenessLevel,
      fromIso,
      untilIso
    });
  }

  return [...dedupedWindows.values()];
}

function buildMeteoalarmSummary(countryName: string, warnings: MeteoalarmWarningWindow[], highestLevel: number) {
  const nowMs = Date.now();
  const activeCount = warnings.filter((warning) => {
    const fromMs = warning.fromIso ? new Date(warning.fromIso).getTime() : -Infinity;
    const untilMs = warning.untilIso ? new Date(warning.untilIso).getTime() : Infinity;
    return fromMs <= nowMs && untilMs >= nowMs;
  }).length;
  const upcomingCount = warnings.filter((warning) => {
    const fromMs = warning.fromIso ? new Date(warning.fromIso).getTime() : -Infinity;
    return fromMs > nowMs;
  }).length;

  const pieces = [
    `MeteoAlarm warning coverage for ${countryName}.`,
    `Highest awareness level ${highestLevel}.`,
    `${activeCount} active`,
    `${upcomingCount} upcoming`
  ];
  return pieces.join(" ");
}

function severityFromMeteoalarmLevel(level: number) {
  return clampSeverity(level + 1);
}

export function createMeteoalarmProvider({
  fetchText,
  apiUrl,
  maxEvents
}: CreateMeteoalarmProviderOptions): OsintNewsProvider {
  return {
    name: "meteoalarm",
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const xmlPayload = await fetchText(apiUrl);
      const itemBlocks = Array.from(xmlPayload.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const collected: ProviderCollectedEvent[] = [];

      for (const itemBlock of itemBlocks) {
        const title = extractXmlTagValue(itemBlock, "title");
        const link = extractXmlTagValue(itemBlock, "link");
        const guid = extractXmlTagValue(itemBlock, "guid");
        const description = extractXmlTagValue(itemBlock, "description") ?? "";
        const updatedAtIso = toLooseIsoTimestamp(extractXmlTagValue(itemBlock, "pubDate")) ?? nowIso;

        if (!link || !guid) {
          continue;
        }

        let regionCode = "";
        try {
          regionCode = normalizeWhitespace(new URL(link).searchParams.get("region")).toUpperCase();
        } catch {
          regionCode = "";
        }

        const country = METEOALARM_COUNTRY_BY_REGION[regionCode];
        if (!country) {
          continue;
        }

        const relevantWarnings = extractMeteoalarmWarnings(description).filter((warning) => {
          const untilMs = warning.untilIso ? new Date(warning.untilIso).getTime() : Infinity;
          return untilMs >= nowMs;
        });
        if (relevantWarnings.length === 0) {
          continue;
        }

        const highestLevel = relevantWarnings.reduce((maxLevel, warning) => Math.max(maxLevel, warning.level), 0);
        const titleText = title || `MeteoAlarm ${country.name}`;
        const summary = buildMeteoalarmSummary(country.name, relevantWarnings, highestLevel);
        const createdAtIso =
          relevantWarnings
            .map((warning) => warning.fromIso)
            .filter((value): value is string => Boolean(value))
            .sort()[0] ?? updatedAtIso;
        const sourceTypes = dedupeStrings(["meteoalarm", "official", "warning", "weather"]);
        const eventId = `meteoalarm-${regionCode.toLowerCase()}`;
        const sourceName = "MeteoAlarm";

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: "meteoalarm",
            sourceName,
            sourceReliability: null,
            title: titleText,
            content: summary,
            url: link,
            timestampIso: updatedAtIso,
            createdAtIso,
            accountHandle: null,
            tweetId: null,
            mediaUrls: [],
            fetchedAtIso: nowIso
          },
          raw: {
            title: titleText,
            summary,
            url: link,
            sourceName
          }
        };

        collected.push({
          event: {
            eventId,
            title: titleText,
            summary,
            category: "weather",
            severity: severityFromMeteoalarmLevel(highestLevel),
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: true,
            locationName: null,
            country: country.name,
            region: null,
            lat: country.lat,
            lng: country.lng,
            createdAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: {
            guid,
            title: titleText,
            link,
            updatedAtIso,
            warnings: relevantWarnings
          },
          signals: [signal],
          primarySignalUrl: link,
          primarySourceName: sourceName
        });
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, Math.max(1, maxEvents));
    }
  };
}
