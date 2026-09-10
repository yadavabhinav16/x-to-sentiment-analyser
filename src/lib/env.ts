import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional().default("file:./data/app.db"),
  BEARER_TOKEN: z.string().min(10, "X API bearer token required for fetching"),
  OPENROUTER_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("nvidia/nemotron-3.5-lightning:free"),
  AUTH_SECRET: z.string().default("dev-secret-change-me"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
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
