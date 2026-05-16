import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseVersion } from "./shared.js";

export function readVersionsCache(cachePath: string, logger?: any) {
  try {
    const content = readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      cities: parseVersion(parsed.cities, null),
      polygons: parseVersion(parsed.polygons, null)
    };
  } catch (error) {
    logger?.debug?.("locality map versions cache unavailable", {
      path: cachePath,
      error: error?.message
    });
    return null;
  }
}

export function writeVersionsCache(
  cachePath: string,
  versions: { cities: number | null; polygons: number | null },
  logger?: any
) {
  try {
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify(
        {
          cities: versions.cities,
          polygons: versions.polygons,
          updatedAtIso: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    logger?.warn?.("failed writing locality map versions cache", {
      path: cachePath,
      error: error?.message
    });
  }
}

export function readPayloadSnapshot(snapshotPath: string, logger?: any) {
  try {
    const content = readFileSync(snapshotPath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!Array.isArray(parsed.localities) || !Array.isArray(parsed.areas)) {
      return null;
    }
    return parsed;
  } catch (error) {
    logger?.debug?.("locality map payload snapshot unavailable", {
      path: snapshotPath,
      error: error?.message
    });
    return null;
  }
}

export function writePayloadSnapshot(snapshotPath: string, payload: unknown, logger?: any) {
  try {
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(payload), "utf8");
  } catch (error) {
    logger?.warn?.("failed writing locality map payload snapshot", {
      path: snapshotPath,
      error: error?.message
    });
  }
}
