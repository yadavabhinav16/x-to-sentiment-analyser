import { describe, it, expect, beforeEach } from "vitest";
import { inc, observeMs, setGauge, snapshot, resetMetrics, timed } from "../src/lib/metrics";
import { killSwitchActive, KillSwitchError } from "../src/modules/llm/token-ledger";

describe("metrics registry", () => {
  beforeEach(() => resetMetrics());

  it("counters increment and snapshot", () => {
    inc("llm.provider.p.ok");
    inc("llm.provider.p.ok", 2);
    expect(snapshot().counters["llm.provider.p.ok"]).toBe(3);
  });

  it("timings track count/avg/min/max", async () => {
    observeMs("llm.provider.p.ms", 100);
    observeMs("llm.provider.p.ms", 200);
    const t = snapshot().timings["llm.provider.p.ms"];
    expect(t.count).toBe(2);
    expect(t.avgMs).toBe(150);
    expect(t.minMs).toBe(100);
    expect(t.maxMs).toBe(200);
  });

  it("timed() records ok/fail and latency", async () => {
    await timed("op", async () => 1);
    await expect(timed("op", async () => { throw new Error("x"); })).rejects.toThrow();
    const s = snapshot();
    expect(s.counters["op.ok"]).toBe(1);
    expect(s.counters["op.fail"]).toBe(1);
    expect(s.timings["op.ms"].count).toBe(2);
  });

  it("gauges set and reset clears everything", () => {
    setGauge("x", 5);
    expect(snapshot().gauges.x).toBe(5);
    resetMetrics();
    expect(Object.keys(snapshot().gauges)).toHaveLength(0);
  });
});

describe("kill switch", () => {
  it("is off by default and detects env", () => {
    expect(killSwitchActive()).toBe(false);
    process.env.LLM_KILL_SWITCH = "true";
    expect(killSwitchActive()).toBe(true);
    delete process.env.LLM_KILL_SWITCH;
  });

  it("KillSwitchError carries a clear message", () => {
    const e = new KillSwitchError();
    expect(e.message).toContain("LLM_KILL_SWITCH");
    expect(e.name).toBe("KillSwitchError");
  });
});
