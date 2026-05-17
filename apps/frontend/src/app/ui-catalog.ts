import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { z } from "zod";

export const uiCatalog = defineCatalog(schema, {
  components: {
    // Standard shadcn components
    Card: shadcnComponentDefinitions.Card,
    Stack: shadcnComponentDefinitions.Stack,
    Text: shadcnComponentDefinitions.Text,
    Badge: shadcnComponentDefinitions.Badge,
    Separator: shadcnComponentDefinitions.Separator,
    Button: shadcnComponentDefinitions.Button,
    Heading: shadcnComponentDefinitions.Heading,

    // Custom components for our app
    AlertCard: {
      props: z.object({
        notificationId: z.string(),
        source: z.string(),
        threat: z.number(),
        isDrill: z.boolean(),
        locations: z.array(z.string()),
        locationCount: z.number(),
        alertTimestampIso: z.string().optional(),
      }),
      description: "A red alert notification card",
    },
    NewsCard: {
      props: z.object({
        eventId: z.string(),
        title: z.string(),
        summary: z.string().nullable(),
        category: z.string().nullable(),
        eventType: z.string().nullable(),
        severity: z.number().nullable(),
        signalCount: z.number().optional(),
        sourceTypes: z.array(z.string()).optional(),
        primarySignalUrl: z.string().nullable(),
        primarySourceName: z.string().nullable(),
        updatedAtIso: z.string().nullable(),
        createdAtIso: z.string().nullable(),
        locationName: z.string().nullable().optional(),
        region: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
      }),
      description: "A global news event card",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.any(),
      }),
      description: "A metric display with label and value",
    }
  },
  actions: {},
});
