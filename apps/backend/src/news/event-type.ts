const SAFE_PATTERNS = [
  "incident ended",
  "all clear",
  "resolved",
  "no longer active",
  "under control",
  "threat removed",
  "ceasefire",
  "contained",
  "lifted"
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

const ADVISORY_PATTERNS = [
  "evacuate",
  "evacuation",
  "shelter",
  "warning",
  "advisory",
  "watch",
  "stay indoors",
  "seek shelter"
];

const CASUALTY_PATTERNS = ["injured", "killed", "casualties", "fatalities", "deaths"];
const INVESTIGATION_PATTERNS = ["investigation", "probe", "suspect", "arrest"];
const RECOVERY_PATTERNS = ["reopened", "restored", "recovery", "resumed", "back online", "return to normal"];
const ONGOING_PATTERNS = [
  "breaking",
  "new incident",
  "attack",
  "strike",
  "explosion",
  "fire",
  "wildfire",
  "missile",
  "rocket",
  "drone",
  "earthquake",
  "flood",
  "sirens"
];

export const KNOWN_NEWS_EVENT_TYPES = [
  "Incident Ongoing",
  "General Update",
  "Political Update",
  "Public Advisory",
  "Casualties Update",
  "Investigation",
  "Incident Ended",
  "Weather Alert",
  "Recovery"
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

export function categorizeNewsEventType(newsEvent: {
  title?: string | null;
  summary?: string | null;
  category?: string | null;
  eventType?: string | null;
  sourceTypes?: string[] | null;
  sourceTypesRaw?: string | null;
}) {
  const explicitType = String(newsEvent?.eventType ?? "").trim();
  if (explicitType) {
    return explicitType;
  }

  const title = String(newsEvent?.title || "").toLowerCase();
  const summary = String(newsEvent?.summary || "").toLowerCase();
  const category = String(newsEvent?.category || "").toLowerCase();
  const text = `${title} ${summary}`.trim();

  if (matchesAny(text, SAFE_PATTERNS)) {
    return "Incident Ended";
  }

  if (isWeatherNewsEvent(newsEvent)) {
    return "Weather Alert";
  }

  if (matchesAny(text, ADVISORY_PATTERNS)) {
    return "Public Advisory";
  }

  if (matchesAny(text, CASUALTY_PATTERNS)) {
    return "Casualties Update";
  }

  if (matchesAny(text, INVESTIGATION_PATTERNS)) {
    return "Investigation";
  }

  if (matchesAny(text, RECOVERY_PATTERNS)) {
    return "Recovery";
  }

  if (matchesAny(text, ONGOING_PATTERNS)) {
    return "Incident Ongoing";
  }

  if (category.includes("politic") || category.includes("diplom")) {
    return "Political Update";
  }

  return "General Update";
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
