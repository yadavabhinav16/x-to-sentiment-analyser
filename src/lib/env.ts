import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "Neon Postgres connection string required"),
  BEARER_TOKEN: z.string().min(10, "X API bearer token required for fetching"),
  OPENROUTER_API_KEY: z.string().optional(),
  // Comma-separated provider chain for the LLM router; takes precedence over
  // the deprecated single-model LLM_MODEL.
  LLM_PROVIDERS: z.string().optional(),
  // Deprecated: single-model fallback when LLM_PROVIDERS is unset.
  LLM_MODEL: z.string().default("nvidia/nemotron-3.5-lightning:free"),
  AUTH_SECRET: z.string().default("dev-secret-change-me"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function hasOpenRouter(): boolean {
  return !!getEnv().OPENROUTER_API_KEY;
}
