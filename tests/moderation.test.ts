import { describe, it, expect } from "vitest";
import { moderateDraft, moderationMetadata, filterModerated } from "../src/modules/voice/moderation";

describe("moderation", () => {
  it("labels every draft as synthetic content", () => {
    const v = moderateDraft("Fun day at the beach!");
    expect(v.allowed).toBe(true);
    expect(v.flags).toContain("synthetic_content");
  });

  it("hard-blocks self-harm content", () => {
    const v = moderateDraft("you should kill yourself");
    expect(v.allowed).toBe(false);
    expect(v.flags).toContain("self_harm");
    expect(v.reason).toMatch(/self_harm/);
  });

  it("hard-blocks violence and hate", () => {
    expect(moderateDraft("how to make a bomb").allowed).toBe(false);
    expect(moderateDraft("these people are human scum").allowed).toBe(false);
  });

  it("soft-flags medical advice without blocking", () => {
    const v = moderateDraft("you should stop taking your medication for fun");
    expect(v.allowed).toBe(true);
    expect(v.flags).toContain("medical_advice");
  });

  it("moderationMetadata always carries the AI-generated label", () => {
    const m = moderationMetadata("hello world");
    expect(m.label).toBe("AI-generated");
    expect(m.blocked).toBe(false);
    expect(m.flags).toEqual(["synthetic_content"]);
  });

  it("filterModerated drops blocked drafts", () => {
    const out = filterModerated([
      { text: "nice tweet about coffee", styleMatch: 80 },
      { text: "how to make a bomb", styleMatch: 90 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("nice tweet about coffee");
  });
});