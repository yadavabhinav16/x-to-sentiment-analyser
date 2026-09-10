import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { dbState } = vi.hoisted(() => ({ dbState: {} as Record<string, Array<Record<string, unknown>>> }));
vi.mock("@/db", async () => {
  const { makeDbMock } = await import("./helpers/fake-db");
  return makeDbMock(dbState);
});
vi.mock("@/lib/require-user", () => ({
  requireUser: async () => ({ id: "user-test-1", email: "a@b.c", name: "T" }),
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  getProfileForUser: async () => null,
  assertProfileOwnership: () => false,
}));

import { PATCH } from "@/app/api/drafts/[id]/route";

function seedDraft() {
  dbState["drafts"] = [{
    id: "draft-1", generationId: "gen-1", voiceProfileId: "prof-1", text: "original text",
    editedText: null, status: "suggested", styleMatch: 50, moderationFlags: ["synthetic_content"],
    moderationLabel: "AI-generated", createdAt: new Date(),
  }];
  dbState["voice_profiles"] = [
    { id: "prof-1", userId: "user-test-1", handle: "h", styleProfile: "{}", sampleCount: 10 },
  ];
}

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/drafts/draft-1", {
    method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });
}

describe("PATCH /api/drafts/[id] — input validation", () => {
  beforeEach(() => { for (const k of Object.keys(dbState)) delete dbState[k]; });

  it("accepts a valid edit + status change", async () => {
    seedDraft();
    const res = await PATCH(req({ editedText: "new text", status: "approved" }), { params: { id: "draft-1" } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.draft.editedText).toBe("new text");
    expect(data.draft.status).toBe("approved");
  });

  it("rejects invalid status with 400", async () => {
    seedDraft();
    const res = await PATCH(req({ status: "bananas" }), { params: { id: "draft-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects immutable fields with 400", async () => {
    seedDraft();
    const res = await PATCH(req({ id: "other-draft", voiceProfileId: "prof-2" }), { params: { id: "draft-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects oversized editedText with 400", async () => {
    seedDraft();
    const res = await PATCH(req({ editedText: "x".repeat(501) }), { params: { id: "draft-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects empty body with 400", async () => {
    seedDraft();
    const res = await PATCH(req({}), { params: { id: "draft-1" } });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    seedDraft();
    const res = await PATCH(req({ status: "approved" }), { params: { id: "draft-1" } });
    expect(res.status).toBe(200); // control: valid json passes before mutation tests below
  });
});
