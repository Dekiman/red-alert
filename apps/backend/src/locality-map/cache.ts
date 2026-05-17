import { parseVersion } from "./shared.js";

export async function readVersionsCache(kv: KVNamespace, logger?: any) {
  try {
    const parsed = await kv.get("locality_map_versions", "json");
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      cities: parseVersion((parsed as any).cities, null),
      polygons: parseVersion((parsed as any).polygons, null)
    };
  } catch (error: any) {
    logger?.debug?.("locality map versions cache unavailable", {
      error: error?.message
    });
    return null;
  }
}

export async function writeVersionsCache(
  kv: KVNamespace,
  versions: { cities: number | null; polygons: number | null },
  logger?: any
) {
  try {
    await kv.put(
      "locality_map_versions",
      JSON.stringify({
        cities: versions.cities,
        polygons: versions.polygons,
        updatedAtIso: new Date().toISOString()
      })
    );
  } catch (error: any) {
    logger?.warn?.("failed writing locality map versions cache", {
      error: error?.message
    });
  }
}

export async function readPayloadSnapshot(kv: KVNamespace, logger?: any) {
  try {
    const parsed = await kv.get("locality_map_snapshot", "json");
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!Array.isArray((parsed as any).localities) || !Array.isArray((parsed as any).areas)) {
      return null;
    }
    return parsed;
  } catch (error: any) {
    logger?.debug?.("locality map payload snapshot unavailable", {
      error: error?.message
    });
    return null;
  }
}

export async function writePayloadSnapshot(kv: KVNamespace, payload: unknown, logger?: any) {
  try {
    await kv.put("locality_map_snapshot", JSON.stringify(payload));
  } catch (error: any) {
    logger?.warn?.("failed writing locality map payload snapshot", {
      error: error?.message
    });
  }
}
