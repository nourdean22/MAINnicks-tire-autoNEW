import { describe, it, expect } from "vitest";
import {
  measure,
  isOk,
  valueOr,
  rollupStatus,
  unhealthySources,
  deriveHealthHeadline,
  errorCodeOf,
  type MetricResult,
} from "@/lib/services/metric-result";

const FIXED = "2026-07-21T00:00:00.000Z";
const at = () => FIXED;

describe("metric-result (audit #3-6 · false-green telemetry)", () => {
  it("measure() marks a successful read ok with a timestamp", async () => {
    const m = await measure("alerts", async () => 7, at);
    expect(m).toEqual({ status: "ok", value: 7, measuredAt: FIXED, source: "alerts" });
  });

  it("measure() marks a THROWN read unavailable — never a fake zero", async () => {
    const m = await measure("alerts", async () => {
      throw Object.assign(new Error("db gone"), { code: "ECONN" });
    }, at);
    expect(m.status).toBe("unavailable");
    if (m.status === "unavailable") {
      expect(m.source).toBe("alerts");
      expect(m.errorCode).toBe("ECONN");
    }
    // The critical property: a failed read is NOT 0.
    expect(valueOr(m, -1)).toBe(-1);
  });

  it("errorCodeOf never leaks the raw message", () => {
    expect(errorCodeOf(new Error("secret connection string leaked here"))).toBe("Error");
    expect(errorCodeOf({ code: "P2021" })).toBe("P2021");
    expect(errorCodeOf("weird")).toBe("ERR");
  });

  it("valueOr uses a stale degraded value but falls back on unavailable", () => {
    const degraded: MetricResult<number> = { status: "degraded", value: 3, source: "x", errorCode: "STALE" };
    const gone: MetricResult<number> = { status: "unavailable", source: "x", errorCode: "ERR" };
    expect(valueOr(degraded, 0)).toBe(3);
    expect(valueOr(gone, 0)).toBe(0);
  });

  it("rollupStatus surfaces the worst state (unavailable > degraded > ok)", async () => {
    const ok = await measure("a", async () => 1, at);
    const bad = await measure("b", async () => { throw new Error("x"); }, at);
    expect(rollupStatus([ok])).toBe("ok");
    expect(rollupStatus([ok, bad])).toBe("unavailable");
    expect(rollupStatus([ok, { status: "degraded", source: "c", errorCode: "S" }])).toBe("degraded");
    expect(rollupStatus([])).toBe("ok");
  });

  it("unhealthySources names exactly what failed", async () => {
    const ok = await measure("alerts", async () => 1, at);
    const bad = await measure("commitments", async () => { throw new Error("x"); }, at);
    expect(unhealthySources([ok, bad])).toEqual(["commitments"]);
  });

  it("isOk narrows to the ok variant", async () => {
    const m = await measure("a", async () => "v", at);
    expect(isOk(m)).toBe(true);
    if (isOk(m)) expect(m.value).toBe("v");
  });

  describe("deriveHealthHeadline (audit #4 · status no longer follows db alone)", () => {
    it("is healthy only when db is up AND every metric is ok", async () => {
      const ok1 = await measure("alerts", async () => 1, at);
      const ok2 = await measure("radar", async () => 2, at);
      expect(deriveHealthHeadline(true, [ok1, ok2])).toEqual({ status: "healthy", degradedSources: [] });
    });

    it("is DEGRADED when db is up but a metric read failed (the false-green fix)", async () => {
      const ok1 = await measure("alerts", async () => 1, at);
      const bad = await measure("radar", async () => { throw new Error("x"); }, at);
      const h = deriveHealthHeadline(true, [ok1, bad]);
      expect(h.status).toBe("degraded");
      expect(h.degradedSources).toEqual(["radar"]);
    });

    it("is DEGRADED and lists 'db' first when the database is down", async () => {
      const ok1 = await measure("alerts", async () => 1, at);
      const h = deriveHealthHeadline(false, [ok1]);
      expect(h.status).toBe("degraded");
      expect(h.degradedSources).toEqual(["db"]);
    });

    it("reports 'db' AND the failed metric when both are down", async () => {
      const bad = await measure("autonomic", async () => { throw new Error("x"); }, at);
      const h = deriveHealthHeadline(false, [bad]);
      expect(h.status).toBe("degraded");
      expect(h.degradedSources).toEqual(["db", "autonomic"]);
    });
  });
});
