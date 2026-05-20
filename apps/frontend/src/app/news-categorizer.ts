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

function matchesAny(patterns: string[], text: string) {
  return patterns.some((pattern) => text.includes(pattern));
}

function isWeatherEvent(newsEvent: any): boolean {
  const category = String(newsEvent?.category || "").toLowerCase();
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes: string[] = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((v: any) => String(v || "").toLowerCase())
    : [];
  const title = String(newsEvent?.title || "").toLowerCase();
  const summary = String(newsEvent?.summary || "").toLowerCase();
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
    matchesAny(WEATHER_PATTERNS, text)
  );
}

function isEarthquakeEvent(newsEvent: any): boolean {
  const category = String(newsEvent?.category || "").toLowerCase();
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes: string[] = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((v: any) => String(v || "").toLowerCase())
    : [];
  const title = String(newsEvent?.title || "").toLowerCase();
  const summary = String(newsEvent?.summary || "").toLowerCase();
  const text = `${title} ${summary}`.trim();

  return (
    category.includes("earthquake") ||
    sourceTypesRaw.includes("usgs") ||
    sourceTypes.includes("usgs") ||
    matchesAny(EARTHQUAKE_PATTERNS, text)
  );
}

function isNewsEvent(newsEvent: any): boolean {
  const category = String(newsEvent?.category || "").toLowerCase();
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes: string[] = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((v: any) => String(v || "").toLowerCase())
    : [];

  return (
    category.includes("news") ||
    sourceTypesRaw.includes("gdelt") ||
    sourceTypesRaw.includes("rss") ||
    sourceTypes.includes("gdelt") ||
    sourceTypes.includes("news")
  );
}

export function categorizeNewsTitleType(newsEvent: any): string {
  if (isEarthquakeEvent(newsEvent)) {
    return "Earthquake";
  }
  if (isWeatherEvent(newsEvent)) {
    return "Weather";
  }
  if (isNewsEvent(newsEvent)) {
    return "News";
  }
  return "Other";
}

