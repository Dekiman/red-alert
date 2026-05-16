import type { NormalizedNewsEvent, NormalizedNewsSignal } from "./types.js";

export type ProviderSignalPair = {
  normalized: NormalizedNewsSignal;
  raw: unknown;
};

export type ProviderCollectedEvent = {
  event: NormalizedNewsEvent;
  rawEvent: unknown;
  signals?: ProviderSignalPair[];
  primarySignalUrl?: string | null;
  primarySourceName?: string | null;
};

export type OsintNewsProvider = {
  name: string;
  fetchEvents: () => Promise<ProviderCollectedEvent[]>;
};
