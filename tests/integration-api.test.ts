/**
 * Integration tests for the API routes — auth-scoped, fully mocked:
 * - No live X API calls (fixtures used via MockTweetSource shape / USE_MOCK_X).
 * - No live OpenRouter calls (LlmClient is a fake).
 *
 * Route handlers are called directly as functions with mocked auth + NextRequest.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

// DB is an in-memory fake (tests/helpers/fake-db.ts) — the suite NEVER touches
// a real database. The real DATABASE_URL is stripped in tests/setup-env.ts.
// No live X API and no live OpenRouter calls below.

const testUser = { id: "user-test-1", email: "int-test@example.com", name: "Int Test" };

// 1. Mock the DB module with the in-memory fake BEFORE importing route modules.
// (vi.mock is hoisted above the const — use vi.hoisted so dbState exists first.)
const { dbState } = vi.hoisted(() => ({ dbState: {} as Record<string, Array<Record<string, unknown>>> }));
vi.mock("@/db", async () => {
  const { makeDbMock } = await import("./helpers/fake-db");
  return makeDbMock(dbState);
});

// 2. Mock auth entirely (avoid loading next-auth → next/server ESM interop issue in vitest).
vi.mock("@/modules/auth/auth", () => ({
  auth: async () => ({
    user: { id: testUser.id, email: testUser.email, name: testUser.name },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
  handlers: {},
  signIn: async () => null,
  signOut: async () => null,
}));

// next-auth itself is never loaded in tests.
vi.mock("next-auth", () => ({ default: () => ({}) }));

// 3. Mock the LLM client — NO live OpenRouter calls.
// generate/route.ts now constructs OpenRouterClient instances directly for the
// router chain, so mock the class as well as the factory.
vi.mock("@/modules/llm/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/llm/openrouter")>();
  return {
    ...actual,
    getLlmClient: () => fakeLlmClient(),
    OpenRouterClient: class {
      complete = async () => fakeLlmClient().complete();
    },
  };
});

function fakeLlmClient() {
  return {
    complete: async () => ({
      content: JSON.stringify({
        drafts: [
          "just shipped a new build and the tests are green. small wins compound.",
          "coffee count today: 3. deploy count: also 3. coincidence? definitely not",
        ],
      }),
      tokensIn: 10,
      tokensOut: 10,
    }),
  };
}

import { POST as createProfile } from "@/app/api/profiles/route";
import { POST as generate } from "@/app/api/generate/route";
import { resetBreakers } from "@/lib/circuit-breaker";
import { _reset as resetRateLimit } from "@/lib/rate-limit";
import { rateLimit } from "@/lib/rate-limit";
import { getDb } from "@/db";
import { drafts, voiceProfiles, users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { MockTweetSource } from "@/modules/ingestion/mock-tweet-source";

// Fixtures live one level above the app package, portably resolved from this
// test file's location (works on any machine/CI runner).
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test-fixtures"
);

vi.mock("@/modules/ingestion/mock-tweet-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ingestion/mock-tweet-source")>();
  return {
    ...actual,
    MockTweetSource: class extends actual.MockTweetSource {
      constructor() {
        super(FIXTURES_DIR);
      }
    },
  };
});

function req(url: string, body: unknown, method = "POST") {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function createProfileViaApi(handle = "elonmusk", idempotencyKey?: string) {
  return createProfile(
    req("/api/profiles", { handle, mode: "test", ...(idempotencyKey ? { idempotencyKey } : {}) })
  );
}

beforeAll(async () => {
  // back the session user with a real row (migrations applied by vitest setup)
  const db = getDb();
  await db
    .insert(usersTable)
    .values({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      passwordHash: "x",
      createdAt: new Date(),
    })
    .onConflictDoNothing();
});

beforeEach(() => {
  resetBreakers();
  resetRateLimit();
});

describe("POST /api/profiles (integration)", () => {
  it("creates a profile in test mode (mock source, zero X API spend)", async () => {
    const res = await createProfileViaApi("elonmusk");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.handle).toBe("elonmusk");
    expect(data.sampleCount).toBeGreaterThan(0);
    expect(data.profileId).toBeTruthy();
  });

  it("rejects invalid handles with 400", async () => {
    const res = await createProfileViaApi("bad handle!");
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { POST } = await import("@/app/api/profiles/route");
    const { auth } = await import("@/modules/auth/auth");
    const realAuth = (auth as unknown as { getMockImplementation(): unknown }).getMockImplementation?.();
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce?.(null);
    // Fallback: temporarily override requireUser via auth mock is covered above;
    // simplest reliable check uses a null session:
    const mod = await import("@/lib/require-user");
    const spy = vi.spyOn(mod, "requireUser").mockResolvedValueOnce(null);
    const res = await createProfile(req("/api/profiles", { handle: "elonmusk", mode: "test" }));
    spy.mockRestore();
    expect(res.status).toBe(401);
    void realAuth;
    void POST;
  });

  it("is idempotent when the same idempotencyKey is reused", async () => {
    const r1 = await createProfileViaApi("elonmusk", "idem-key-123");
    expect(r1.status).toBe(200);
    const d1 = await r1.json();
    const r2 = await createProfileViaApi("elonmusk", "idem-key-123");
    const d2 = await r2.json();
    expect(d2.replayed).toBe(true);
    expect(d2.profileId).toBe(d1.profileId);
  });
});

describe("POST /api/generate (integration)", () => {
  it("generates drafts for the authenticated user's profile with mocked LLM", async () => {
    await createProfileViaApi("elonmusk");
    const res = await generate(req("/api/generate", { handle: "elonmusk", count: 2 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);
    expect(data.blockedCount).toBe(0);
    for (const d of data.drafts) {
      expect(typeof d.styleMatch).toBe("number");
      // synthetic-content labeling on every generated draft
      expect(d.moderationLabel).toBe("AI-generated");
      expect(d.moderationFlags).toContain("synthetic_content");
    }
  });

  it("returns 404 when the profile belongs to another user (auth scoping)", async () => {
    // Create profile as testUser, then query as another user.
    await createProfileViaApi("elonmusk");
    const requireUserMod = await import("@/lib/require-user");
    const spy = vi
      .spyOn(requireUserMod, "requireUser")
      .mockResolvedValueOnce({ id: "user-other-2", email: "other@example.com", name: null });
    const res = await generate(req("/api/generate", { handle: "elonmusk", count: 2 }));
    spy.mockRestore();
    expect(res.status).toBe(404);
  });

  it("rejects unauthenticated generation with 401", async () => {
    const requireUserMod = await import("@/lib/require-user");
    const spy = vi.spyOn(requireUserMod, "requireUser").mockResolvedValueOnce(null);
    const res = await generate(req("/api/generate", { handle: "elonmusk" }));
    spy.mockRestore();
    expect(res.status).toBe(401);
  });
});

describe("draft persistence and moderation columns (integration)", () => {
  it("persists drafts with moderation metadata and scoped reads", async () => {
    await createProfileViaApi("elonmusk");
    await generate(req("/api/generate", { handle: "elonmusk", count: 2 }));
    const db = getDb();
    const rows = await db.select().from(drafts);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.moderationLabel).toBe("AI-generated");
      const flags = r.moderationFlags as unknown as string[];
      expect(flags).toContain("synthetic_content");
    }
    const profiles = await db.select().from(voiceProfiles);
    const profile = profiles.find((x) => x.userId === testUser.id);
    expect(profile).toBeTruthy();
  });
});