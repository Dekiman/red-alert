import type { Alert, NewsEvent } from "../../../../packages/shared/src/schemas.js";

export interface Persistence {
  alerts: AlertRepository;
  news: NewsRepository;
  close(): Promise<void>;
}

export interface AlertRepository {
  /**
   * Saves a normalized alert to the database.
   * Returns whether it was a new insertion and its internal ID.
   */
  save(normalizedAlert: Alert, rawPayload: unknown): Promise<{ inserted: boolean; id: number | null }>;

  /**
   * Retrieves recent alerts, limited by count.
   */
  getRecent(limit?: number): Promise<Alert[]>;

  /**
   * Retrieves alerts for a specific time range, optimized for polygon state inference.
   */
  getForInference(fromUnix: number, toUnix: number, limit?: number): Promise<Alert[]>;
}

export interface NewsFeedOptions {
  limit?: number;
  fromUnix?: number;
  toUnix?: number;
  eventTypes?: string[];
  severities?: number[];
}

export interface NewsFeed {
  limit: number;
  matchingCount: number;
  selectedEventTypes: string[];
  selectedSeverities: string[];
  availableEventTypes: Array<{ eventType: string; count: number }>;
  availableSeverities: Array<{ severity: number; count: number }>;
  events: NewsEvent[];
}

export interface NewsRepository {
  /**
   * Retrieves a specific news event by its ID.
   */
  getEvent(eventId: string): Promise<NewsEvent | null>;

  /**
   * Saves or updates a live news event.
   */
  saveEvent(normalizedEvent: NewsEvent, rawPayload: unknown): Promise<{ changed: boolean }>;

  /**
   * Saves or updates a batch of news events efficiently.
   */
  saveEventsBatch(updates: Array<{ normalizedEvent: NewsEvent, rawPayload: unknown }>): Promise<{ changedCount: number }>;

  /**
   * Saves new signals for an existing event.
   */
  saveSignals(eventId: string, normalizedSignals: any[], rawSignals: unknown[]): Promise<{ inserted: number }>;

  /**
   * Retrieves a filtered feed of news events.
   */
  getFeed(options?: NewsFeedOptions): Promise<NewsFeed>;

  /**
   * Retrieves the backoff state for a news provider.
   */
  getProviderBackoff(providerName: string): Promise<{ backoffUntilMs: number; rateLimitCount: number; transientErrorCount: number } | null>;

  /**
   * Saves the backoff state for a news provider.
   */
  setProviderBackoff(providerName: string, state: { backoffUntilMs: number; rateLimitCount: number; transientErrorCount: number }): Promise<void>;

  /**
   * Internal method to retrieve all raw news events.
   */
  _getAllRaw(): Promise<NewsEvent[]>;
}
