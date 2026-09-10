// Load .env.local for tests (DATABASE_URL etc).
// HARD RULE: tests must never hit the live X API or OpenRouter, so those
// credentials are stripped after loading. DATABASE_URL is ALSO stripped and
// replaced with a canary value: the test suite must never run against a real
// (let alone production) database. Integration tests that need DB semantics
// mock at the module boundary; unit tests never touch a DB.
import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";

const local = join(process.cwd(), ".env.local");
if (existsSync(local)) config({ path: local });

// Strip credentials that could trigger live paid API calls from tests.
delete process.env.OPENROUTER_API_KEY;
delete process.env.BEARER_TOKEN;

// Strip the real database: no test may write to a live/production DB.
delete process.env.DATABASE_URL;
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test-canary";

// Fixture directory: portable (relative to repo layout), not an absolute
// per-developer path. Fixtures live one level above the app package.
process.env.TEST_FIXTURES_DIR = process.env.TEST_FIXTURES_DIR ?? "";
delete process.env.TEST_FIXTURES_DIR;
