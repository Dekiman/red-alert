import { createHash } from "node:crypto";
import {
  clampSeverity,
  cleanAndLimitSummary,
  decodeXmlEntities,
  dedupeStrings,
  normalizeWhitespace,
  toLooseIsoTimestamp
} from "./provider-helpers.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

type CreateRssProviderOptions = {
  name: string;
  sourceName: string;
  apiUrl: string;
  fetchText: (url: string) => Promise<string>;
  maxEvents: number;
  throttleMs?: number;
  blockedKeywords?: string[];
};

const DEFAULT_BLOCKED_KEYWORDS = [
  "eurovision",
  "pop music",
  "album",
  "song",
  "sports",
  "football",
  "soccer",
  "tennis",
  "cricket",
  "olympics",
  "fashion",
  "celebrity",
  "gossip",
  "hollywood",
  "oscars",
  "film review",
  "tv review",
  "movie review",
  "arts",
  "exhibition",
  "theatre",
  "recipe",
  "cooking",
  "travel guide"
];

function extractXmlTagValue(block: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(pattern);
  if (!match) {
    return null;
  }
  return normalizeWhitespace(decodeXmlEntities(match[1]));
}

export function createRssProvider({
  name,
  sourceName,
  apiUrl,
  fetchText,
  maxEvents,
  throttleMs = 60_000,
  blockedKeywords = DEFAULT_BLOCKED_KEYWORDS
}: CreateRssProviderOptions): OsintNewsProvider {
  return {
    name,
    throttleMs,
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const xmlPayload = await fetchText(apiUrl);
      const itemBlocks = Array.from(xmlPayload.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((match) => match[1] || "");
      const nowIso = new Date().toISOString();
      const collected: ProviderCollectedEvent[] = [];

      for (const itemBlock of itemBlocks) {
        const title = extractXmlTagValue(itemBlock, "title");
        const link = extractXmlTagValue(itemBlock, "link");
        const description = extractXmlTagValue(itemBlock, "description") ?? "";
        const updatedAtIso = toLooseIsoTimestamp(extractXmlTagValue(itemBlock, "pubDate")) ?? nowIso;

        if (!title && !link) {
          continue;
        }

        const cleanLink = link ? normalizeWhitespace(link) : "";
        const cleanTitle = title ? normalizeWhitespace(title) : "";
        const cleanDescription = description ? cleanAndLimitSummary(description) : "";

        // Keyword filter check (case-insensitive)
        const combinedText = `${cleanTitle} ${cleanDescription}`.toLowerCase();
        const hasBlockedKeyword = blockedKeywords.some((keyword) =>
          combinedText.includes(keyword.toLowerCase())
        );

        if (hasBlockedKeyword) {
          continue;
        }

        const hash = createHash("sha1").update(`${cleanLink}|${cleanTitle}`).digest("hex").slice(0, 20);
        const eventId = `${name}-${hash}`;
        const category = "news";
        const sourceTypes = dedupeStrings([name, "osint", "news", category]);

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: name,
            sourceName,
            sourceReliability: null,
            title: cleanTitle,
            content: cleanDescription,
            url: cleanLink,
            timestampIso: updatedAtIso,
            createdAtIso: updatedAtIso,
            accountHandle: null,
            tweetId: null,
            mediaUrls: [],
            fetchedAtIso: nowIso
          },
          raw: {
            title: cleanTitle,
            description: cleanDescription,
            link: cleanLink,
            pubDate: updatedAtIso
          }
        };

        collected.push({
          event: {
            eventId,
            title: cleanTitle,
            summary: cleanDescription || cleanTitle,
            category,
            severity: clampSeverity(2),
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: true,
            locationName: null,
            country: null,
            region: null,
            lat: null,
            lng: null,
            createdAtIso: updatedAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: itemBlock,
          signals: [signal],
          primarySignalUrl: cleanLink,
          primarySourceName: sourceName
        });
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, Math.max(1, maxEvents));
    }
  };
}
