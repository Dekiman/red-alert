import { z } from "zod";

export const AlertSchema = z.object({
  source: z.string(),
  notificationId: z.string(),
  threat: z.number(),
  isDrill: z.boolean(),
  locations: z.array(z.string()),
  locationCount: z.number(),
  locationIds: z.array(z.number()).optional(),
  alertTimestampIso: z.string().optional(),
  receivedAtIso: z.string().optional(),
});

export type Alert = z.infer<typeof AlertSchema>;

export const NewsEventSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  eventType: z.string().nullable().optional(),
  severity: z.number().nullable().optional(),
  signalCount: z.number().optional(),
  sourceTypes: z.array(z.string()).optional(),
  sourceTypesRaw: z.string().optional(),
  locationName: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  createdAtIso: z.string().nullable().optional(),
  updatedAtIso: z.string().nullable().optional(),
  primarySignalUrl: z.string().nullable().optional(),
  primarySourceName: z.string().nullable().optional(),
});

export type NewsEvent = z.infer<typeof NewsEventSchema>;

export const SystemMessageSchema = z.object({
  kind: z.string().nullable().optional(),
  instruction: z.string().nullable().optional(),
  instructionType: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  textParts: z.array(z.string()).optional(),
  locationNames: z.array(z.string()).optional(),
  locationIds: z.array(z.number()).optional(),
});

export type SystemMessage = z.infer<typeof SystemMessageSchema>;
