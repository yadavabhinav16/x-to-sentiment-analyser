// Load .env.local for tests (DATABASE_URL etc).
// HARD RULE: tests must never hit the live X API or OpenRouter, so those
// credentials are stripped after loading. DB access (DATABASE_URL) is kept.
import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

const local = join(process.cwd(), ".env.local");
if (existsSync(local)) config({ path: local });

// Strip credentials that could trigger live paid API calls from tests.
delete process.env.OPENROUTER_API_KEY;
delete process.env.BEARER_TOKEN;
