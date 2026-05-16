import {
  averageGeoPoints,
  clampSeverity,
  dedupeStrings,
  getGeoGeometryCenter,
  normalizeWhitespace,
  toIsoTimestamp
} from "./provider-helpers.js";
import type { OsintNewsProvider, ProviderCollectedEvent, ProviderSignalPair } from "./provider-types.js";

type CreateNwsProviderOptions = {
  fetchJson: (url: string) => Promise<any>;
  apiUrl: string;
  maxEvents: number;
};

type NwsZoneSnapshot = {
  center: { lat: number; lng: number } | null;
  state: string | null;
};

const NWS_CATEGORY_MAP: Record<string, string> = {
  met: "weather",
  fire: "wildfire",
  geo: "earthquake",
  env: "disaster",
  cbrne: "disaster",
  safety: "warning",
  security: "conflict",
  rescue: "warning",
  health: "warning",
  transport: "warning",
  infra: "warning"
};

const NWS_SEVERITY_MAP: Record<string, number> = {
  unknown: 1,
  minor: 2,
  moderate: 3,
  severe: 4,
  extreme: 5
};

function severityFromNws(value: unknown) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) {
    return clampSeverity(2);
  }
  return clampSeverity(NWS_SEVERITY_MAP[normalized] ?? 2);
}

function isNwsTestAlert(properties: any) {
  const haystack = [
    properties?.status,
    properties?.messageType,
    properties?.event,
    properties?.headline,
    properties?.description,
    properties?.instruction
  ]
    .map((value) => normalizeWhitespace(value).toLowerCase())
    .join(" ");

  return (
    haystack.includes("test") ||
    haystack.includes("monitoring message only") ||
    haystack.includes("please disregard")
  );
}

function categoryFromNws(properties: any) {
  const normalized = normalizeWhitespace(properties?.category).toLowerCase();
  return NWS_CATEGORY_MAP[normalized] ?? "warning";
}

export function createNwsProvider({
  fetchJson,
  apiUrl,
  maxEvents
}: CreateNwsProviderOptions): OsintNewsProvider {
  const zoneSnapshotCache = new Map<string, Promise<NwsZoneSnapshot>>();

  async function resolveZoneSnapshot(zoneUrl: string) {
    const normalizedUrl = normalizeWhitespace(zoneUrl);
    if (!normalizedUrl) {
      return {
        center: null,
        state: null
      } satisfies NwsZoneSnapshot;
    }

    const cached = zoneSnapshotCache.get(normalizedUrl);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      try {
        const zonePayload = await fetchJson(normalizedUrl);
        return {
          center: getGeoGeometryCenter(zonePayload?.geometry),
          state: normalizeWhitespace(zonePayload?.properties?.state) || null
        } satisfies NwsZoneSnapshot;
      } catch {
        return {
          center: null,
          state: null
        } satisfies NwsZoneSnapshot;
      }
    })();

    zoneSnapshotCache.set(normalizedUrl, pending);
    return pending;
  }

  return {
    name: "nws",
    async fetchEvents(): Promise<ProviderCollectedEvent[]> {
      const payload = await fetchJson(apiUrl);
      const features = Array.isArray(payload?.features) ? payload.features : [];
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const collected: ProviderCollectedEvent[] = [];
      const boundedMaxEvents = Math.max(1, maxEvents);
      const sortedFeatures = [...features].sort((left, right) => {
        const leftIso =
          toIsoTimestamp(left?.properties?.effective) ??
          toIsoTimestamp(left?.properties?.sent) ??
          "";
        const rightIso =
          toIsoTimestamp(right?.properties?.effective) ??
          toIsoTimestamp(right?.properties?.sent) ??
          "";
        return rightIso.localeCompare(leftIso);
      });

      for (const feature of sortedFeatures) {
        const properties = feature?.properties ?? {};
        const status = normalizeWhitespace(properties?.status);
        const messageType = normalizeWhitespace(properties?.messageType);
        const rawIdentifier = normalizeWhitespace(properties?.id ?? feature?.id);
        if (!rawIdentifier) {
          continue;
        }
        if (status.toLowerCase() !== "actual") {
          continue;
        }
        if (messageType.toLowerCase() === "cancel" || isNwsTestAlert(properties)) {
          continue;
        }

        const expiresAtIso = toIsoTimestamp(properties?.expires) ?? toIsoTimestamp(properties?.ends);
        if (expiresAtIso && new Date(expiresAtIso).getTime() < nowMs) {
          continue;
        }

        const zoneSnapshots = await Promise.all(
          (Array.isArray(properties?.affectedZones) ? properties.affectedZones : [])
            .slice(0, 2)
            .map((zoneUrl) => resolveZoneSnapshot(zoneUrl))
        );

        const center =
          getGeoGeometryCenter(feature?.geometry) ??
          averageGeoPoints(zoneSnapshots.map((snapshot) => snapshot.center));

        const stateNames = dedupeStrings(zoneSnapshots.map((snapshot) => snapshot.state ?? "").filter(Boolean));
        const category = categoryFromNws(properties);
        const eventId = `nws-${rawIdentifier}`;
        const title =
          normalizeWhitespace(properties?.headline) ||
          normalizeWhitespace(properties?.event) ||
          "NWS Alert";
        const description = normalizeWhitespace(properties?.description);
        const instruction = normalizeWhitespace(properties?.instruction);
        const summary =
          normalizeWhitespace(
            `${description || title}${instruction ? ` Instruction: ${instruction}` : ""}`
          ) || title;
        const createdAtIso =
          toIsoTimestamp(properties?.sent) ??
          toIsoTimestamp(properties?.effective) ??
          nowIso;
        const updatedAtIso =
          toIsoTimestamp(properties?.effective) ??
          toIsoTimestamp(properties?.onset) ??
          createdAtIso;
        const sourceTypes = dedupeStrings(["nws", "official", "warning", category]);
        const signalUrl = normalizeWhitespace(properties?.["@id"]) || null;
        const sourceName = normalizeWhitespace(properties?.senderName) || "NWS";

        const signal: ProviderSignalPair = {
          normalized: {
            signalId: `${eventId}-signal-${Math.floor(new Date(updatedAtIso).getTime() / 1000)}`,
            eventId,
            sourceType: "nws",
            sourceName,
            sourceReliability: null,
            title,
            content: summary,
            url: signalUrl,
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
            url: signalUrl,
            sourceName
          }
        };

        collected.push({
          event: {
            eventId,
            title,
            summary,
            category,
            severity: severityFromNws(properties?.severity),
            sourceTypes,
            sourceTypesRaw: sourceTypes.join(","),
            signalCount: 1,
            isActive: !expiresAtIso || new Date(expiresAtIso).getTime() >= nowMs,
            locationName: normalizeWhitespace(properties?.areaDesc) || null,
            country: "United States",
            region: stateNames.length > 0 ? stateNames.join(", ") : null,
            lat: Number.isFinite(center?.lat) ? Number(center?.lat) : null,
            lng: Number.isFinite(center?.lng) ? Number(center?.lng) : null,
            createdAtIso,
            updatedAtIso,
            fetchedAtIso: nowIso
          },
          rawEvent: feature,
          signals: [signal],
          primarySignalUrl: signalUrl,
          primarySourceName: sourceName
        });

        if (collected.length >= boundedMaxEvents) {
          break;
        }
      }

      collected.sort((a, b) => b.event.updatedAtIso.localeCompare(a.event.updatedAtIso));
      return collected.slice(0, boundedMaxEvents);
    }
  };
}
