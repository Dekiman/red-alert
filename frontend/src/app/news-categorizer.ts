export function categorizeNewsTitleType(newsEvent) {
  const explicitType = String(newsEvent?.eventType ?? "").trim();
  if (explicitType) {
    return explicitType;
  }

  const title = String(newsEvent?.title || "").toLowerCase();
  const summary = String(newsEvent?.summary || "").toLowerCase();
  const category = String(newsEvent?.category || "").toLowerCase();
  const text = `${title} ${summary}`.trim();

  const matchesAny = (patterns) => patterns.some((pattern) => text.includes(pattern));
  const sourceTypesRaw = String(newsEvent?.sourceTypesRaw || "").toLowerCase();
  const sourceTypes = Array.isArray(newsEvent?.sourceTypes)
    ? newsEvent.sourceTypes.map((value) => String(value || "").toLowerCase())
    : [];

  const hasWeatherSignal = () =>
    category.includes("weather") ||
    sourceTypesRaw.includes("weather") ||
    sourceTypesRaw.includes("nws") ||
    sourceTypesRaw.includes("weather_canada") ||
    sourceTypesRaw.includes("meteoalarm") ||
    sourceTypes.includes("weather") ||
    sourceTypes.includes("nws") ||
    sourceTypes.includes("weather_canada") ||
    sourceTypes.includes("meteoalarm") ||
    matchesAny([
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
    ]);

  if (
    matchesAny([
      "incident ended",
      "all clear",
      "resolved",
      "no longer active",
      "under control",
      "threat removed",
      "ceasefire",
      "contained",
      "lifted"
    ])
  ) {
    return "Incident Ended";
  }

  if (hasWeatherSignal()) {
    return "Weather Alert";
  }

  if (
    matchesAny([
      "evacuate",
      "evacuation",
      "shelter",
      "warning",
      "advisory",
      "watch",
      "stay indoors",
      "seek shelter"
    ])
  ) {
    return "Public Advisory";
  }

  if (matchesAny(["injured", "killed", "casualties", "fatalities", "deaths"])) {
    return "Casualties Update";
  }

  if (matchesAny(["investigation", "probe", "suspect", "arrest"])) {
    return "Investigation";
  }

  if (
    matchesAny([
      "reopened",
      "restored",
      "recovery",
      "resumed",
      "back online",
      "return to normal"
    ])
  ) {
    return "Recovery";
  }

  if (
    matchesAny([
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
    ])
  ) {
    return "Incident Ongoing";
  }

  if (category.includes("politic") || category.includes("diplom")) {
    return "Political Update";
  }

  return "General Update";
}
