export { dedupeStrings } from "../../utils/primitives.js";

export function normalizeWhitespace(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtmlTags(value: unknown) {
  return normalizeWhitespace(String(value ?? "").replace(/<[^>]*>/g, " "));
}

export function decodeXmlEntities(value: unknown) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

export function extractFirstTwoSentences(text: string): string {
  if (!text) return "";
  const normalized = text.trim();
  if (!normalized) return "";

  const sentences: string[] = [];
  let currentSentence = "";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    currentSentence += char;

    if (char === "." || char === "!" || char === "?") {
      const nextChar = normalized[i + 1];
      if (!nextChar || /\s/.test(nextChar)) {
        const words = currentSentence.trim().split(/\s+/);
        const lastWord = words[words.length - 1];

        const lowerLast = lastWord.toLowerCase().replace(/[^a-z.]/g, "");
        const isAbbreviation =
          /^[a-z]\.$/i.test(lastWord) ||
          [
            "vs.",
            "ca.",
            "eg.",
            "ie.",
            "dr.",
            "mr.",
            "ms.",
            "co.",
            "inc.",
            "ltd.",
            "gen.",
            "col.",
            "maj.",
            "capt.",
            "sgt.",
            "sen.",
            "rep."
          ].includes(lowerLast);

        if (!isAbbreviation) {
          sentences.push(currentSentence.trim());
          currentSentence = "";
        }
      }
    }
  }

  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  return sentences.slice(0, 2).join(" ");
}

export function cleanAndLimitSummary(value: unknown): string {
  const decoded = decodeXmlEntities(value);
  const stripped = stripHtmlTags(decoded);
  return extractFirstTwoSentences(stripped);
}

export function toIsoTimestamp(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    let numeric = value;
    // Handle seconds vs milliseconds for modern dates (roughly 2010 to 2050)
    // 1e11 is a good threshold: 
    //   1e11 seconds is in the year 5138.
    //   1e11 milliseconds is in the year 1973.
    if (numeric < 1e11) {
      numeric *= 1000;
    }

    const parsed = new Date(numeric);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  const raw = normalizeWhitespace(value);
  if (!raw) {
    return null;
  }

  // GDELT format: YYYYMMDDHHMMSS (no T, no Z sometimes)
  const gdeltMatch = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z?$/);
  if (gdeltMatch) {
    const [, year, month, day, hour, minute, second] = gdeltMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  const withTimeZone = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)
    ? raw
    : /^\d{4}-\d{2}-\d{2}T/.test(raw)
      ? `${raw}Z`
      : raw;
  const parsed = new Date(withTimeZone);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function toLooseIsoTimestamp(value: unknown) {
  const normalizedIso = toIsoTimestamp(value);
  if (normalizedIso) {
    return normalizedIso;
  }

  const raw = normalizeWhitespace(value);
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function clampSeverity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(5, Math.max(1, Math.round(numeric)));
}

export function parseCountryFromPlace(place: unknown) {
  const normalized = normalizeWhitespace(place);
  if (!normalized) {
    return null;
  }
  const parts = normalized.split(",").map((part) => normalizeWhitespace(part)).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return parts[parts.length - 1] ?? null;
}

export function averageGeoPoints(points: Array<{ lat: number; lng: number } | null | undefined>) {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;

  for (const point of points) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }

    const latRadians = (lat * Math.PI) / 180;
    const lngRadians = (lng * Math.PI) / 180;
    const cosLat = Math.cos(latRadians);

    x += cosLat * Math.cos(lngRadians);
    y += cosLat * Math.sin(lngRadians);
    z += Math.sin(latRadians);
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  const averageX = x / count;
  const averageY = y / count;
  const averageZ = z / count;
  const hypotenuse = Math.sqrt(averageX * averageX + averageY * averageY);

  return {
    lat: (Math.atan2(averageZ, hypotenuse) * 180) / Math.PI,
    lng: (Math.atan2(averageY, averageX) * 180) / Math.PI
  };
}

export function getGeoGeometryCenter(geometry: any) {
  const collectedPoints: Array<{ lat: number; lng: number }> = [];

  function visitCoordinates(candidate: unknown) {
    if (!Array.isArray(candidate)) {
      return;
    }

    const [lngRaw, latRaw] = candidate;
    if (candidate.length >= 2 && typeof lngRaw !== "object" && typeof latRaw !== "object") {
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        collectedPoints.push({ lat, lng });
      }
      return;
    }

    for (const child of candidate) {
      visitCoordinates(child);
    }
  }

  visitCoordinates(geometry?.coordinates);
  return averageGeoPoints(collectedPoints);
}
