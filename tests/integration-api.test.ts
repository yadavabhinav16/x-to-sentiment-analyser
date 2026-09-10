/**
 * Integration tests for the API routes — auth-scoped, fully mocked:
 * - No live X API calls (fixtures used via MockTweetSource shape / USE_MOCK_X).
 * - No live OpenRouter calls (LlmClient is a fake).
 *
 * Route handlers are called directly as functions with mocked auth + NextRequest.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";

// 1. Isolated temp DB per test run (must run before route/db imports resolve getDb).
const dir = mkdtempSync(join(tmpdir(), "int-"));
process.chdir(dir);

const testUser = { id: "user-test-1", email: "int-test@example.com", name: "Int Test" };

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
vi.mock("@/modules/llm/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/llm/openrouter")>();
  return {
    ...actual,
    getLlmClient: () => fakeLlmClient(),
  };
});

function fakeLlmClient() {
  return {
    complete: async () => ({
      content: JSON.stringify({
        drafts: [
          "just shipped a new build and the tests are green — small wins compound",
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
import { GET as listDraftsRoute } from "@/app/api/drafts/[id]/route";
import { resetBreakers } from "@/lib/circuit-breaker";
import { rateLimit } from "@/lib/rate-limit";
import { getDb } from "@/db";
import { drafts, voiceProfiles, users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { MockTweetSource } from "@/modules/ingestion/mock-tweet-source";

const FIXTURES_DIR = "/Users/abhi/Desktop/okara-assessment/test-fixtures";

// MockTweetSource defaults to cwd/../test-fixtures; the test's cwd is a temp
// dir, so route it at the repo's fixture directory explicitly.
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
  // ensure migrations applied for this temp DB, and back the session user with a real row
  const db = getDb();
  db.insert(usersTable)
    .values({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      passwordHash: "x",
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
});

beforeEach(() => {
  resetBreakers();
  rateLimit._reset?.();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
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
    const rows = db.select().from(drafts).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.moderationLabel).toBe("AI-generated");
      const flags = r.moderationFlags as unknown as string[];
      expect(flags).toContain("synthetic_content");
    }
    const profile = db.select().from(voiceProfiles).all()[0];
    expect(profile.userId).toBe(testUser.id);
  });
});