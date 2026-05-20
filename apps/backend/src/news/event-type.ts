const EARTHQUAKE_PATTERNS = [
  "earthquake",
  "seismic",
  "tremor",
  "quake",
  "aftershock",
  "magnitude",
  "epicenter",
  "richter"
];

const WEATHER_PATTERNS = [
  "marine weather",
  "small craft",
  "gale",
  "storm",
  "thunderstorm",
  "tornado",
  "hurricane",
  "typhoon",
  "cyclone",
  "blizzard",
  "snow",
  "ice",
  "freezing rain",
  "sleet",
  "wind chill",
  "heat",
  "cold",
  "fog",
  "rain",
  "flood",
  "hail",
  "fire weather",
  "red flag",
  "high surf",
  "coastal flood"
];

export const KNOWN_NEWS_EVENT_TYPES = [
  "News",
  "Earthquake",
  "Weather",
  "Other"
];

function matchesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function isWeatherNewsEvent(newsEvent: {
  title?: string | null;
  summary?: string | null;
  category?: string | null;
  sourceTypes?: string[] | null;
  sourceTypesRaw?: string | null;
}) {
  const title = String(newsEvent?.title || "").toLowerCase();
  const summary = String(newsEvent?.summary || "").toLowerCase();
  const category = String(newsEvent?.category || "").toLowerCase();
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((value) => String(value || "").toLowerCase())
    : [];
  const text = `${title} ${summary}`.trim();

  return (
    category.includes("weather") ||
    category.includes("cyclone") ||
    category.includes("drought") ||
    category.includes("wildfire") ||
    sourceTypesRaw.includes("weather") ||
    sourceTypesRaw.includes("nws") ||
    sourceTypesRaw.includes("weather_canada") ||
    sourceTypesRaw.includes("meteoalarm") ||
    sourceTypes.includes("weather") ||
    sourceTypes.includes("nws") ||
    sourceTypes.includes("weather_canada") ||
    sourceTypes.includes("meteoalarm") ||
    matchesAny(text, WEATHER_PATTERNS)
  );
}

export function isEarthquakeNewsEvent(newsEvent: {
  title?: string | null;
  summary?: string | null;
  category?: string | null;
  sourceTypes?: string[] | null;
  sourceTypesRaw?: string | null;
}) {
  const title = String(newsEvent?.title || "").toLowerCase();
  const summary = String(newsEvent?.summary || "").toLowerCase();
  const category = String(newsEvent?.category || "").toLowerCase();
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((value) => String(value || "").toLowerCase())
    : [];
  const text = `${title} ${summary}`.trim();

  return (
    category.includes("earthquake") ||
    sourceTypesRaw.includes("usgs") ||
    sourceTypes.includes("usgs") ||
    matchesAny(text, EARTHQUAKE_PATTERNS)
  );
}

export function isNewsEvent(newsEvent: {
  category?: string | null;
  sourceTypes?: string[] | null;
  sourceTypesRaw?: string | null;
}) {
  const category = String(newsEvent?.category || "").toLowerCase();
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((value) => String(value || "").toLowerCase())
    : [];

  return (
    category.includes("news") ||
    sourceTypesRaw.includes("gdelt") ||
    sourceTypesRaw.includes("rss") ||
    sourceTypes.includes("gdelt") ||
    sourceTypes.includes("news")
  );
}

export function categorizeNewsEventType(newsEvent: {
  title?: string | null;
  summary?: string | null;
  category?: string | null;
  eventType?: string | null;
  sourceTypes?: string[] | null;
  sourceTypesRaw?: string | null;
}) {
  // Earthquake takes top priority — it's unambiguous
  if (isEarthquakeNewsEvent(newsEvent)) {
    return "Earthquake";
  }

  // Weather next — dedicated weather sources / patterns
  if (isWeatherNewsEvent(newsEvent)) {
    return "Weather";
  }

  // News — GDELT, RSS, and news-category sourced events
  if (isNewsEvent(newsEvent)) {
    return "News";
  }

  return "Other";
}

export function compareNewsEventTypes(left: string, right: string) {
  const leftIndex = KNOWN_NEWS_EVENT_TYPES.indexOf(left);
  const rightIndex = KNOWN_NEWS_EVENT_TYPES.indexOf(right);
  const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeftIndex !== normalizedRightIndex) {
    return normalizedLeftIndex - normalizedRightIndex;
  }
  return left.localeCompare(right);
}
