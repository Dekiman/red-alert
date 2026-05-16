import { z } from "zod";

export const envSchema = z.object({
  RED_ALERT_WS_URL: z.string().default("wss://ws.tzevaadom.co.il/socket?platform=WEB"),
  RED_ALERT_NOTIFICATIONS_URL: z.string().default("https://api.tzevaadom.co.il/notifications?"),
  RED_ALERT_WS_ORIGIN: z.string().default("https://www.tzevaadom.co.il"),
  RED_ALERT_WS_USER_AGENT: z.string().default("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"),
  RED_ALERT_TIMEZONE: z.string().default("Asia/Jerusalem"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: any): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return result.data;
}
