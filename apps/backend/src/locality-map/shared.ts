export function parseVersion(value: unknown, fallback: number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function normalizeLocationText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueSortedNumbers(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
    )
  ).sort((a, b) => a - b);
}

export function buildVersionedUrl(baseUrl: string, version: number | null) {
  const separator = String(baseUrl).includes("?") ? "&" : "?";
  return `${baseUrl}${separator}v=${version}`;
}
