/**
 * `recordMetric` swallows write failures. `recordMetricStrict` does not.
 *
 * WHY BOTH EXIST. Review caught a P1: the `action.done.shadow` instrument was
 * wired to `recordMetric`, whose body ends in `.catch(() => {})` — "never fail
 * the main operation". So the shadow's await could never reject, its recorder
 * always returned "recorded", and the non-silent catch that module advertises
 * was dead code on the only path that runs in production. A dead writer and a
 * run with no gaps produced the same observable: nothing.
 *
 * Its unit test passed anyway, because the injected mock rejected where the
 * real dependency cannot. A test can only be as honest as its double.
 *
 * The fail-soft behaviour is still correct for incidental telemetry on a hot
 * path. What was wrong was using it where THE WRITE IS THE MEASUREMENT. These
 * tests pin the difference so neither function drifts into the other.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` factories are hoisted above module-level consts, so the spy has to
// be created inside `vi.hoisted` or the factory closes over a TDZ binding.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { systemMetric: { create } } }));

import { recordMetric, recordMetricStrict } from "@/lib/services/metrics";

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: "row-1" });
});

describe("recordMetricStrict · the write is the measurement", () => {
  it("POSITIVE CONTROL: it writes, and returns a receipt naming the row", async () => {
    // Without this, a function that never called prisma at all would satisfy
    // the rejection test below by simply never rejecting.
    const receipt = await recordMetricStrict("x.y", 1, { unit: "count", source: "test" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(receipt).toEqual({ id: "row-1" });
  });

  it("PROPAGATES a write failure to the caller", async () => {
    create.mockRejectedValueOnce(new Error("system_metrics unreachable"));
    await expect(recordMetricStrict("x.y", 1)).rejects.toThrow("system_metrics unreachable");
  });

  it("returns a RECEIPT rather than void — a swallowing writer cannot fake one", async () => {
    // This is the compile-time guard's runtime shadow. `ActionDoneShadowDeps`
    // demands `Promise<MetricWriteReceipt>`, and `Promise<void>` is not
    // assignable to it, so the fail-soft writer cannot be wired to an
    // instrument again without a type error. Asserting the shape here keeps
    // that guarantee from being refactored away by loosening the return type.
    const receipt = await recordMetricStrict("x.y", 1);
    expect(typeof receipt.id).toBe("string");
  });
});

describe("recordMetric · fail-soft, deliberately", () => {
  it("SWALLOWS a write failure — this is the behaviour that caused the P1", async () => {
    create.mockRejectedValueOnce(new Error("system_metrics unreachable"));
    await expect(recordMetric("x.y", 1)).resolves.toBeUndefined();
  });

  it("still performs the write on the happy path", async () => {
    await recordMetric("x.y", 2, { source: "test" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("delegates to the strict writer, so there is ONE insert definition", async () => {
    // Two hand-written copies of the same `prisma.systemMetric.create` would be
    // free to drift — a column added to one and not the other is the exact
    // shape of defect this repo keeps finding. The fail-soft path must be a
    // wrapper, not a second implementation.
    await recordMetric("x.y", 3, { unit: "count", tags: { a: 1 }, source: "test" });
    const arg = create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ metric: "x.y", value: 3, unit: "count", source: "test" });
    // The strict writer selects the id back; the wrapper must not lose that.
    expect(arg.select).toEqual({ id: true });
  });
});
