export function hasHebrew(text) {
  return /[\u0590-\u05FF]/.test(text || "");
}

export function normalizeLocationText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["'`’]/g, "")
    .replace(/[.,/#!$%^&*;:{}=_~()\-+[\]\\|?<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function setDirection(node, text) {
  if (!node) {
    return;
  }

  if (hasHebrew(text)) {
    node.setAttribute("dir", "rtl");
    node.setAttribute("lang", "he");
    return;
  }

  node.setAttribute("dir", "ltr");
  node.setAttribute("lang", "en");
}

export function formatTime(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString();
}

const USER_TIME_ZONE =
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

const USER_NEWS_TIME_FORMATTER =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: USER_TIME_ZONE,
        timeZoneName: "short"
      })
    : null;

export function formatNewsTime(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  if (USER_NEWS_TIME_FORMATTER) {
    return USER_NEWS_TIME_FORMATTER.format(date);
  }

  return date.toLocaleString();
}
