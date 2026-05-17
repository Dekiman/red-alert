export function parseBooleanLike(value: unknown, fallback = false): boolean {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function firstDefined<T>(...values: T[]): T | null {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function dedupeStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  
  return result;
}
