type EnvLogger = {
  warn?: (message: string, context?: Record<string, unknown>) => void;
};

type NumberEnvOptions = {
  minValue?: number;
  logger?: EnvLogger;
};

export function parseNumberEnv(name: string, defaultValue: number, options: NumberEnvOptions = {}) {
  const { minValue = 0, logger } = options;
  const raw = process.env[name];
  if (raw == null) {
    return defaultValue;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    logger?.warn?.("invalid numeric env value, using default", {
      env: name,
      value: raw,
      defaultValue
    });
    return defaultValue;
  }

  return Math.floor(parsed);
}

export function parseBooleanEnv(name: string, defaultValue: boolean, logger?: EnvLogger) {
  const raw = process.env[name];
  if (raw == null) {
    return defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  logger?.warn?.("invalid boolean env value, using default", {
    env: name,
    value: raw,
    defaultValue
  });
  return defaultValue;
}

export function parseCsvEnv(name: string, defaultValue = "") {
  const raw = process.env[name];
  const source = raw == null ? defaultValue : String(raw);
  return source
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
