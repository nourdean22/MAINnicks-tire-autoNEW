import { describe, it, expect } from "vitest";

import { evaluateHeavySync, HEAVY_SYNC_COOLDOWN_MS } from "./bridge-routes";

// Guards the 2026-07-05 adversarial-audit fix: the three DESTRUCTIVE heavy-
// sync bridge ops (backfill-history, trigger-mirror, full-sync) must not run
// on an accidental single call, and must not be loopable within the cooldown.
// evaluateHeavySync is pure (time + prior-run state are parameters), so these
// need no clock, no mocks, no Express, and no env — safe under singleFork.
describe("evaluateHeavySync — heavy-sync safety gate", () => {
  const OP = "full-sync";
  const T0 = 1_000_000;

  it("blocks when confirm is omitted (safe default no-op, 200)", () => {
    const d = evaluateHeavySync(OP, {}, undefined, T0);
    expect(d.action).toBe("reject");
    if (d.action === "reject") {
      expect(d.status).toBe(200);
      expect(d.body.skipped).toBe(true);
      expect(d.body.confirmRequired).toBe(true);
      expect(d.body.op).toBe(OP);
    }
  });

  it("blocks when confirm is explicitly false (200 no-op)", () => {
    const d = evaluateHeavySync(OP, { confirm: false }, undefined, T0);
    expect(d.action).toBe("reject");
    if (d.action === "reject") expect(d.status).toBe(200);
  });

  it("treats an undefined/missing body as a safe no-op, never a crash", () => {
    const d = evaluateHeavySync(OP, undefined, undefined, T0);
    expect(d.action).toBe("reject");
    if (d.action === "reject") expect(d.status).toBe(200);
  });

  it("rejects a non-boolean confirm as invalid input (400)", () => {
    const d = evaluateHeavySync(OP, { confirm: "yes" }, undefined, T0);
    expect(d.action).toBe("reject");
    if (d.action === "reject") expect(d.status).toBe(400);
  });

  it("runs on the first confirmed call (no prior run)", () => {
    const d = evaluateHeavySync(OP, { confirm: true }, undefined, T0);
    expect(d.action).toBe("run");
  });

  it("rate-limits a confirmed call within the cooldown window (429)", () => {
    const d = evaluateHeavySync(OP, { confirm: true }, T0, T0 + HEAVY_SYNC_COOLDOWN_MS - 1);
    expect(d.action).toBe("reject");
    if (d.action === "reject") {
      expect(d.status).toBe(429);
      expect(d.body.error).toBe("rate_limited");
      expect(d.body.retryAfterMs).toBe(1);
    }
  });

  it("allows a confirmed call once the cooldown has fully elapsed", () => {
    const d = evaluateHeavySync(OP, { confirm: true }, T0, T0 + HEAVY_SYNC_COOLDOWN_MS);
    expect(d.action).toBe("run");
  });
});
