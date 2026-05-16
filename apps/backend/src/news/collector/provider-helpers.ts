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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalizeWhitespace(value));
  }
  return deduped;
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
    if (numeric > 1e14) {
      numeric /= 1000;
    }
    if (numeric > 1e12) {
      numeric /= 1000;
    }
    if (numeric > 1e10) {
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

  const gdeltMatch = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
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
