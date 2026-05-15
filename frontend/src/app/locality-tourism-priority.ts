import { normalizeLocationText } from "./text-utils.js";

interface TourismCityPriorityDefinition {
  city: string;
  rank: number;
  boost: number;
  aliases: string[];
}

interface TourismCityPriorityEntry {
  city: string;
  rank: number;
  boost: number;
  aliases: string[];
}

export interface TourismCityPriorityMatch {
  city: string | null;
  rank: number | null;
  boost: number;
  isMajor: boolean;
}

// Source: Israel Ministry of Tourism, "Incoming Tourism Summary 2018":
// "Overnight stays in hotels by incoming tourists by city".
// Ranked cities in that chart: Jerusalem, Tel Aviv, Tiberias, Eilat,
// Dead Sea, Nazareth, Netanya.
const TOURISM_CITY_PRIORITY_DEFINITIONS: TourismCityPriorityDefinition[] = [
  {
    city: "Jerusalem",
    rank: 1,
    boost: 3100,
    aliases: ["Jerusalem", "Yerushalayim", "ירושלים"]
  },
  {
    city: "Tel Aviv",
    rank: 2,
    boost: 2800,
    aliases: ["Tel Aviv", "Tel Aviv Yafo", "Tel Aviv Jaffa", "תל אביב", "תל אביב יפו"]
  },
  {
    city: "Tiberias",
    rank: 3,
    boost: 2400,
    aliases: ["Tiberias", "טבריה"]
  },
  {
    city: "Eilat",
    rank: 4,
    boost: 2250,
    aliases: ["Eilat", "אילת"]
  },
  {
    city: "Dead Sea",
    rank: 5,
    boost: 2100,
    aliases: ["Dead Sea", "Dead Sea Hotels", "ים המלח", "בתי מלון ים המלח", "מלונות ים המלח"]
  },
  {
    city: "Nazareth",
    rank: 6,
    boost: 1950,
    aliases: ["Nazareth", "נצרת"]
  },
  {
    city: "Netanya",
    rank: 7,
    boost: 1825,
    aliases: ["Netanya", "נתניה"]
  }
];

const TOURISM_CITY_PRIORITY_ENTRIES: TourismCityPriorityEntry[] = TOURISM_CITY_PRIORITY_DEFINITIONS
  .map((entry) => ({
    city: entry.city,
    rank: entry.rank,
    boost: entry.boost,
    aliases: entry.aliases
      .map((alias) => normalizeLocationText(alias))
      .filter((alias, index, list) => alias.length > 0 && list.indexOf(alias) === index)
  }))
  .sort((a, b) => a.rank - b.rank);

function labelMatchesAlias(normalizedLabel: string, normalizedAlias: string) {
  if (!normalizedLabel || !normalizedAlias) {
    return false;
  }

  return (
    normalizedLabel === normalizedAlias ||
    normalizedLabel.startsWith(`${normalizedAlias} `) ||
    normalizedLabel.endsWith(` ${normalizedAlias}`) ||
    normalizedLabel.includes(` ${normalizedAlias} `)
  );
}

export function getTourismCityPriority(labelText: string): TourismCityPriorityMatch {
  const normalizedLabel = normalizeLocationText(labelText);
  if (!normalizedLabel) {
    return { city: null, rank: null, boost: 0, isMajor: false };
  }

  for (const entry of TOURISM_CITY_PRIORITY_ENTRIES) {
    if (entry.aliases.some((alias) => labelMatchesAlias(normalizedLabel, alias))) {
      return {
        city: entry.city,
        rank: entry.rank,
        boost: entry.boost,
        isMajor: true
      };
    }
  }

  return { city: null, rank: null, boost: 0, isMajor: false };
}
