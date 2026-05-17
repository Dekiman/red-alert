const GEObOUNDARIES_METADATA_URL = "https://www.geoboundaries.org/api/current/gbOpen/ALL/ALL/";
const SUPPORTED_LEVELS = new Set(["ADM1", "ADM2"]);
const STATIC_ASSET_ISO_CODES = new Set(['FRA', 'DEU', 'ISR', 'USA', 'GBR', 'ITA', 'ESP', 'CAN', 'AUS', 'JPN']);

const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  "antigua and barb": ["antigua and barbuda"],
  "ashmore and cartier is": ["ashmore and cartier islands"],
  bolivia: ["bolivia plurinational state of"],
  "bosnia and herz": ["bosnia and herzegovina"],
  "br indian ocean ter": ["british indian ocean territory"],
  brunei: ["brunei darussalam"],
  "british virgin is": ["british virgin islands"],
  "cape verde": ["cabo verde"],
  "cayman is": ["cayman islands"],
  "central african rep": ["central african republic"],
  "cook is": ["cook islands"],
  czechia: ["czech republic"],
  "dem rep congo": ["democratic republic of the congo", "congo democratic republic of the", "dr congo"],
  "dominican rep": ["dominican republic"],
  "eq guinea": ["equatorial guinea"],
  "faeroe is": ["faroe islands", "faeroe islands"],
  "falkland is": ["falkland islands"],
  "fr polynesia": ["french polynesia"],
  "fr s antarctic lands": ["french southern and antarctic lands", "french southern territories"],
  "heard i and mcdonald is": ["heard island and mcdonald islands"],
  "indian ocean ter": ["british indian ocean territory"],
  "ivory coast": ["cote divoire", "cote d ivoire"],
  iran: ["iran islamic republic of"],
  "judea and samaria": ["state of palestine", "palestine", "palestinian territory"],
  laos: ["lao peoples democratic republic"],
  "marshall is": ["marshall islands"],
  moldova: ["republic of moldova"],
  myanmar: ["burma"],
  "n cyprus": ["northern cyprus", "north cyprus"],
  "n mariana is": ["northern mariana islands"],
  "north korea": ["democratic peoples republic of korea", "korea democratic peoples republic of"],
  palestine: ["state of palestine", "palestinian territory"],
  "pitcairn is": ["pitcairn islands"],
  russia: ["russian federation"],
  "s geo and the is": ["south georgia and the south sandwich islands"],
  "s sudan": ["south sudan"],
  "south korea": ["republic of korea", "korea republic of"],
  "solomon is": ["solomon islands"],
  "st kitts and nevis": ["saint kitts and nevis"],
  "st pierre and miquelon": ["saint pierre and miquelon"],
  "st vin and gren": ["saint vincent and the grenadines"],
  syria: ["syrian arab republic"],
  tanzania: ["united republic of tanzania"],
  "turks and caicos is": ["turks and caicos islands"],
  "u s virgin is": ["virgin islands of the united states", "united states virgin islands"],
  "united states": ["united states of america"],
  venezuela: ["venezuela bolivarian republic of"],
  "w sahara": ["western sahara"],
  "wallis and futuna is": ["wallis and futuna"]
};

function normalizeCountryName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getMetadataNameCandidates(boundaryName: string) {
  const normalized = normalizeCountryName(boundaryName);
  const candidates = new Set<string>();
  if (!normalized) {
    return candidates;
  }

  candidates.add(normalized);
  if (normalized.startsWith("the ")) {
    candidates.add(normalized.slice(4));
  }

  const prefixPatterns = [
    /^republic of /,
    /^state of /,
    /^kingdom of /,
    /^federative republic of /,
    /^federal republic of /,
    /^democratic republic of /,
    /^islamic republic of /,
    /^united republic of /,
    /^the former yugoslav republic of /
  ];
  for (const pattern of prefixPatterns) {
    if (pattern.test(normalized)) {
      candidates.add(normalized.replace(pattern, ""));
    }
  }

  if (normalized === "united states of america") {
    candidates.add("united states");
  }
  if (normalized === "russian federation") {
    candidates.add("russia");
  }
  if (normalized === "syrian arab republic") {
    candidates.add("syria");
  }
  if (normalized === "iran islamic republic of") {
    candidates.add("iran");
  }
  if (normalized === "lao peoples democratic republic") {
    candidates.add("laos");
  }
  if (normalized === "republic of korea") {
    candidates.add("south korea");
  }
  if (normalized === "democratic peoples republic of korea") {
    candidates.add("north korea");
  }
  if (normalized === "state of palestine" || normalized === "palestinian territory") {
    candidates.add("palestine");
    candidates.add("judea and samaria");
  }

  return candidates;
}

function getRequestedNameCandidates(countryName: string) {
  const normalized = normalizeCountryName(countryName);
  const candidates = new Set<string>();
  if (!normalized) {
    return candidates;
  }

  candidates.add(normalized);
  for (const alias of COUNTRY_NAME_ALIASES[normalized] ?? []) {
    candidates.add(alias);
  }
  return candidates;
}

function createGeoBoundariesCountryLookup(metadataEntries: GeoBoundariesMetadata[]) {
  const lookup = new Map<string, string>();
  for (const entry of metadataEntries) {
    if (entry.boundaryType !== "ADM0") {
      continue;
    }
    for (const candidate of getMetadataNameCandidates(entry.boundaryName)) {
      if (!lookup.has(candidate)) {
        lookup.set(candidate, entry.boundaryISO);
      }
    }
  }
  return lookup;
}

function slugifyBoundarySnapshotValue(value: string) {
  const normalized = normalizeCountryName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

function buildBoundarySnapshotKey(countryName: string, level: string) {
  const normalizedLevel = String(level ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return `boundary_${normalizedLevel || "UNKNOWN"}__${slugifyBoundarySnapshotValue(countryName)}`;
}

async function readBoundarySnapshot(kv: KVNamespace, snapshotKey: string, logger?: any) {
  try {
    const parsed = await kv.get(snapshotKey, "json");
    if (!parsed || typeof parsed !== "object" || !(parsed as any).featureCollection || typeof (parsed as any).featureCollection !== "object") {
      return null;
    }

    return {
      ...parsed,
      source: "geoBoundaries_snapshot"
    };
  } catch (error: any) {
    logger?.debug?.("boundary detail snapshot unavailable", {
      key: snapshotKey,
      error: error?.message
    });
    return null;
  }
}

async function writeBoundarySnapshot(kv: KVNamespace, snapshotKey: string, payload: unknown, logger?: any) {
  try {
    await kv.put(snapshotKey, JSON.stringify(payload));
  } catch (error: any) {
    logger?.warn?.("failed writing boundary detail snapshot", {
      key: snapshotKey,
      error: error?.message
    });
  }
}

type GeoBoundariesMetadata = {
  boundaryName: string;
  boundaryISO: string;
  boundaryType: string;
  simplifiedGeometryGeoJSON?: string;
  gjDownloadURL?: string;
};

type BoundaryDetailQuery = {
  countryName: string;
  level: string;
};

export function createBoundaryDetailService({ kv, logger }: { kv: KVNamespace; logger?: any }) {
  let metadataPromise: Promise<GeoBoundariesMetadata[]> | null = null;
  const detailCache = new Map<string, Promise<any | null>>();

  async function getMetadataEntries() {
    if (!metadataPromise) {
      metadataPromise = (async () => {
        const cacheKey = "geoboundaries_metadata_v1";
        try {
          const cached = await kv.get(cacheKey, "json") as GeoBoundariesMetadata[] | null;
          if (cached) {
            return cached;
          }
        } catch (e) {
          logger?.warn?.("failed reading metadata from KV", { error: (e as any).message });
        }

        const response = await fetch(GEObOUNDARIES_METADATA_URL, {
          headers: {
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          throw new Error(`geoBoundaries metadata HTTP ${response.status}`);
        }

        const data = (await response.json()) as GeoBoundariesMetadata[];
        
        try {
          await kv.put(cacheKey, JSON.stringify(data), { expirationTtl: 86400 * 7 });
        } catch (e) {
          logger?.warn?.("failed writing metadata to KV", { error: (e as any).message });
        }

        return data;
      })().catch((error) => {
        metadataPromise = null;
        throw error;
      });
    }

    return metadataPromise;
  }

  async function resolveMetadata(countryName: string, level: string) {
    const metadataEntries = await getMetadataEntries();
    const countryLookup = createGeoBoundariesCountryLookup(metadataEntries);
    const requestedCandidates = getRequestedNameCandidates(countryName);
    let boundaryISO: string | null = null;

    for (const candidate of requestedCandidates) {
      boundaryISO = countryLookup.get(candidate) ?? null;
      if (boundaryISO) {
        break;
      }
    }

    if (!boundaryISO) {
      return null;
    }

    return (
      metadataEntries.find(
        (entry) => entry.boundaryISO === boundaryISO && entry.boundaryType === level && (entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL)
      ) ?? null
    );
  }

  async function getBoundaryDetail({ countryName, level }: BoundaryDetailQuery) {
    const normalizedLevel = String(level ?? "").toUpperCase();
    const requestedCountryName = String(countryName ?? "").trim();
    if (!requestedCountryName || !SUPPORTED_LEVELS.has(normalizedLevel)) {
      return null;
    }

    const requestSnapshotKey = buildBoundarySnapshotKey(
      requestedCountryName,
      normalizedLevel
    );

    // Try KV snapshot first for immediate response
    const cached = await readBoundarySnapshot(kv, requestSnapshotKey, logger);
    if (cached) {
      return cached;
    }

    let metadata = null;
    try {
      metadata = await resolveMetadata(requestedCountryName, normalizedLevel);
    } catch (error: any) {
      logger?.warn?.("boundary metadata fetch failed; using snapshot fallback if available", {
        countryName: requestedCountryName,
        level: normalizedLevel,
        error: error?.message
      });
      // Fallback already checked above, but keep for safety/retry if something changed
      return await readBoundarySnapshot(kv, requestSnapshotKey, logger);
    }

    if (!metadata) {
      return await readBoundarySnapshot(kv, requestSnapshotKey, logger);
    }

    // Phase 2: Static asset redirect if available
    if (STATIC_ASSET_ISO_CODES.has(metadata.boundaryISO)) {
      return {
        ok: true,
        source: "static_asset",
        staticPath: `/boundaries/${metadata.boundaryISO.toLowerCase()}-${normalizedLevel.toLowerCase()}.topo.json`,
        countryName: requestedCountryName,
        matchedBoundaryName: metadata.boundaryName,
        boundaryISO: metadata.boundaryISO,
        level: normalizedLevel
      };
    }

    const cacheKey = `${metadata.boundaryISO}:${normalizedLevel}`;
    const matchedSnapshotKey = buildBoundarySnapshotKey(
      metadata.boundaryName,
      normalizedLevel
    );
    if (!detailCache.has(cacheKey)) {
      const fetchStart = Date.now();
      detailCache.set(
        cacheKey,
        fetch(metadata.simplifiedGeometryGeoJSON ?? metadata.gjDownloadURL!, {
          headers: {
            Accept: "application/geo+json, application/json"
          }
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`geoBoundaries detail HTTP ${response.status}`);
            }
            const geojson = await response.json();
            const duration = Date.now() - fetchStart;
            logger?.info?.("fetched boundary detail from geoBoundaries", {
              countryName: requestedCountryName,
              boundaryISO: metadata.boundaryISO,
              level: normalizedLevel,
              durationMs: duration
            });
            const payload = {
              ok: true,
              source: "geoBoundaries",
              countryName: requestedCountryName,
              matchedBoundaryName: metadata.boundaryName,
              boundaryISO: metadata.boundaryISO,
              level: normalizedLevel,
              featureCollection: geojson
            };
            await writeBoundarySnapshot(kv, requestSnapshotKey, payload, logger);
            if (matchedSnapshotKey !== requestSnapshotKey) {
              await writeBoundarySnapshot(kv, matchedSnapshotKey, payload, logger);
            }
            return payload;
          })
          .catch(async (error) => {
            detailCache.delete(cacheKey);
            logger?.warn?.("boundary detail fetch failed", {
              countryName: requestedCountryName,
              boundaryISO: metadata.boundaryISO,
              level: normalizedLevel,
              error: error?.message
            });
            const fallback = await readBoundarySnapshot(kv, requestSnapshotKey, logger) ?? await readBoundarySnapshot(kv, matchedSnapshotKey, logger);
            return fallback;
          })
      );
    }

    const payload = await detailCache.get(cacheKey)!;
    if (payload && (payload as any).source !== "geoBoundaries_snapshot") {
      await writeBoundarySnapshot(kv, requestSnapshotKey, payload, logger);
      if (matchedSnapshotKey !== requestSnapshotKey) {
        await writeBoundarySnapshot(kv, matchedSnapshotKey, payload, logger);
      }
    }
    return payload;
  }

  return {
    getBoundaryDetail
  };
}