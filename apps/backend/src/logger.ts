const LEVEL_PRIORITIES = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

type LogLevel = keyof typeof LEVEL_PRIORITIES;
type LogContext = Record<string, unknown> | undefined;

const DEFAULT_LEVEL = "info";
const rawLevel = String(process.env.RED_ALERT_LOG_LEVEL ?? DEFAULT_LEVEL).toLowerCase();
const ACTIVE_LEVEL = LEVEL_PRIORITIES[rawLevel] ? rawLevel : DEFAULT_LEVEL;
const LOG_ENGLISH_ONLY = !["false", "0", "no"].includes(
  String(process.env.RED_ALERT_LOG_ENGLISH_ONLY ?? "true").trim().toLowerCase()
);

function shouldLog(level: LogLevel) {
  return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[ACTIVE_LEVEL];
}

function sanitizeEnglishText(value: unknown) {
  if (!LOG_ENGLISH_ONLY) {
    return String(value ?? "");
  }

  const normalized = String(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "[non-english]";
}

function sanitizeContextValue(value: unknown, seen = new WeakSet()) {
  if (!LOG_ENGLISH_ONLY || value == null) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeEnglishText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContextValue(item, seen));
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);

  const safeObject = {};
  let unknownKeyIndex = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const sanitizedKey = sanitizeEnglishText(rawKey)
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const key = sanitizedKey || `field_${unknownKeyIndex++}`;
    safeObject[key] = sanitizeContextValue(rawValue, seen);
  }
  return safeObject;
}

function formatContext(context: LogContext) {
  if (!context || Object.keys(context).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(sanitizeContextValue(context))}`;
  } catch {
    return " {\"context\":\"unserializable\"}";
  }
}

function write(level: LogLevel, scope: string, message: string, context?: LogContext) {
  if (!shouldLog(level)) {
    return;
  }

  const safeMessage = sanitizeEnglishText(message);
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${safeMessage}${formatContext(
    context
  )}\n`;
  process.stderr.write(line);
}

export function createLogger(scope: string) {
  return {
    debug(message: string, context?: LogContext) {
      write("debug", scope, message, context);
    },
    info(message: string, context?: LogContext) {
      write("info", scope, message, context);
    },
    warn(message: string, context?: LogContext) {
      write("warn", scope, message, context);
    },
    error(message: string, context?: LogContext) {
      write("error", scope, message, context);
    }
  };
}

export function getActiveLogLevel() {
  return ACTIVE_LEVEL;
}
