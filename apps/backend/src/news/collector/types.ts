export type SourceTypesSet = Set<string>;
export type RealtimeTriggerTablesSet = Set<string>;

export type NormalizedNewsEvent = {
  eventId: string;
  title: string;
  summary: string;
  category: string;
  severity: number | null;
  sourceTypes: string[];
  sourceTypesRaw: string;
  signalCount: number;
  isActive: boolean;
  locationName: string | null;
  country: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  createdAtIso: string;
  updatedAtIso: string;
  fetchedAtIso: string;
};

export type NormalizedNewsSignal = {
  signalId: string;
  eventId: string;
  sourceType: string | null;
  sourceName: string | null;
  sourceReliability: number | null;
  title: string | null;
  content: string | null;
  url: string | null;
  timestampIso: string | null;
  createdAtIso: string | null;
  accountHandle: string | null;
  tweetId: string | null;
  mediaUrls: string[];
  fetchedAtIso: string;
};
