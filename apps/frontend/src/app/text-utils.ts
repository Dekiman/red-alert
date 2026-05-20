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

export function stripHtmlTags(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: unknown): string {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

export function extractFirstTwoSentences(text: string): string {
  if (!text) return "";
  const normalized = text.trim();
  if (!normalized) return "";

  const sentences: string[] = [];
  let currentSentence = "";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    currentSentence += char;

    if (char === "." || char === "!" || char === "?") {
      const nextChar = normalized[i + 1];
      if (!nextChar || /\s/.test(nextChar)) {
        const words = currentSentence.trim().split(/\s+/);
        const lastWord = words[words.length - 1];

        const lowerLast = lastWord.toLowerCase().replace(/[^a-z.]/g, "");
        const isAbbreviation =
          /^[a-z]\.$/i.test(lastWord) ||
          [
            "vs.",
            "ca.",
            "eg.",
            "ie.",
            "dr.",
            "mr.",
            "ms.",
            "co.",
            "inc.",
            "ltd.",
            "gen.",
            "col.",
            "maj.",
            "capt.",
            "sgt.",
            "sen.",
            "rep."
          ].includes(lowerLast);

        if (!isAbbreviation) {
          sentences.push(currentSentence.trim());
          currentSentence = "";
        }
      }
    }
  }

  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  return sentences.slice(0, 2).join(" ");
}

export function cleanAndLimitSummary(value: unknown): string {
  const decoded = decodeHtmlEntities(value);
  const stripped = stripHtmlTags(decoded);
  return extractFirstTwoSentences(stripped);
}
