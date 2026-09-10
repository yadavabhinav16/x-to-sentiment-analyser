import { describe, it, expect, vi } from "vitest";
import {
  runShadowValidation,
  buildShadowValidatorPrompt,
} from "../src/modules/llm/shadow-validator";

function clientReturning(content: string) {
  return { complete: vi.fn().mockResolvedValue({ content, tokensIn: 1, tokensOut: 1 }) };
}

describe("shadow validator — LLM madness check", () => {
  it("returns yes when secondary model approves", async () => {
    const validators = [{ name: "secondary", client: clientReturning('{"answer":"yes"}') }];
    const r = await runShadowValidation(validators, "write tweets", ["good tweet one"], "primary");
    expect(r.verdict).toBe("yes");
    expect(r.validator).toBe("secondary");
  });

  it("returns no when the validator flags madness", async () => {
    const validators = [{ name: "secondary", client: clientReturning('{"answer":"no"}') }];
    const r = await runShadowValidation(validators, "write tweets", ["banana piano quantum", "x"], "primary");
    expect(r.verdict).toBe("no");
  });

  it("skips the generator model (independent judge)", async () => {
    const primary = { name: "primary-model", client: clientReturning('{"answer":"yes"}') };
    const secondary = { name: "secondary-model", client: clientReturning('{"answer":"yes"}') };
    const r = await runShadowValidation([primary, secondary], "task", ["out"], "primary-model");
    expect(primary.client.complete).not.toHaveBeenCalled();
    expect(r.validator).toBe("secondary-model");
  });

  it("never throws — validator failure degrades to unknown", async () => {
    const validators = [
      { name: "broken", client: { complete: vi.fn().mockRejectedValue(new Error("down")) } },
    ];
    const r = await runShadowValidation(validators, "task", ["out"], "primary");
    expect(r.verdict).toBe("unknown");
    expect(r.validator).toBeNull();
  });

  it("tries the next validator when the first returns garbage", async () => {
    const first = { name: "garbage", client: clientReturning("hello world not json") };
    const second = { name: "good", client: clientReturning('{"answer":"no"}') };
    const r = await runShadowValidation([first, second], "task", ["out"], "primary");
    expect(r.verdict).toBe("no");
    expect(r.validator).toBe("good");
  });

  it("returns unknown when the only validator IS the generator", async () => {
    const only = { name: "same-model", client: clientReturning('{"answer":"yes"}') };
    const r = await runShadowValidation([only], "task", ["out"], "same-model");
    expect(only.client.complete).not.toHaveBeenCalled();
    expect(r.verdict).toBe("unknown");
  });

  it("parses bare yes/no answers", async () => {
    const r = await runShadowValidation(
      [{ name: "v", client: clientReturning("yes") }],
      "task",
      ["out"],
      "primary"
    );
    expect(r.verdict).toBe("yes");
  });

  it("prompt contains task, numbered output, and yes/no constraint", () => {
    const p = buildShadowValidatorPrompt("write tweets about ai", ["draft one", "draft two"]);
    expect(p.system).toContain("coherent");
    expect(p.user).toContain("write tweets about ai");
    expect(p.user).toContain("1. draft one");
    expect(p.user).toContain("2. draft two");
    expect(p.user).toContain("yes or no");
  });
});
