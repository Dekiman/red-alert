export function parseBooleanLike(value, fallback = false) {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
}

export function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

export function isObjectLike(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function dedupeStrings(values) {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}
