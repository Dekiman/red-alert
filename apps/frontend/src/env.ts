import { z } from "zod";

const envSchema = z.object({
  VITE_UI_SOCKET_PATH: z.string().optional().default("/ui-socket"),
  VITE_BACKEND_TARGET: z.string().url().optional().default("http://127.0.0.1:8787"),
  MODE: z.enum(["development", "production", "test"]).default("development"),
  DEV: z.boolean().default(false),
  PROD: z.boolean().default(false),
});

const _env = envSchema.safeParse(import.meta.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables");
}

export const env = _env.data;
