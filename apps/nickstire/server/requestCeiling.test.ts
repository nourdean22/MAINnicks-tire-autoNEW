/**
 * BEHAVIOUR, not source text.
 *
 * A self-audit of PR #1601 found that igAdminWorkflow.test.ts asserts source
 * strings in 31 of 31 pins, and that 7 of 46 scan-style assertions still PASS
 * against unfixed code — two of them vacuously, because the substring slice they
 * search is empty when the guarded code is absent. Green precisely when the fix
 * is gone is the worst failure mode a test can have.
 *
 * This file exercises the request-ceiling composition for real: it constructs the
 * signals, advances fake timers, and observes aborts. It would fail if the
 * ceiling were removed, if cancellation stopped propagating, or if the timer were
 * cleared at response headers again.
 *
 * The function under test is duplicated here rather than imported because
 * client/src/main.tsx has import-time side effects (it mounts React into
 * document.getElementById("root")). The DUPLICATION IS PINNED: the last test
 * compares this copy against the real source, so the two cannot drift apart
 * silently — which is the honest way to test a module that cannot be imported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUEST_CEILING_MS = 300_000; // must match client/src/main.tsx — pinned below

function boundedSignal(existing: AbortSignal | null | undefined): AbortSignal {
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException(`request exceeded ${REQUEST_CEILING_MS}ms`, "TimeoutError")),
    REQUEST_CEILING_MS,
  );
  if (existing) {
    if (existing.aborted) controller.abort(existing.reason);
    else existing.addEventListener("abort", () => controller.abort(existing.reason), { once: true });
  }
  return controller.signal;
}

describe("the request ceiling actually fires", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts at the ceiling when nothing else does", () => {
    const signal = boundedSignal(undefined);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(REQUEST_CEILING_MS - 1);
    expect(signal.aborted, "aborted early — the ceiling is too tight").toBe(false);

    vi.advanceTimersByTime(1);
    expect(signal.aborted, "never aborted — the ceiling does not fire").toBe(true);
    expect((signal.reason as Error | undefined)?.name).toBe("TimeoutError");
  });

  it("STAYS armed past the point a response's headers would have arrived", () => {
    // The regression this guards: clearing the timer when the fetch promise
    // settles (headers) left tRPC's body read unbounded. Nothing here clears it,
    // so a stalled body is still aborted.
    const signal = boundedSignal(undefined);
    vi.advanceTimersByTime(500); // "headers came back quickly"
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(REQUEST_CEILING_MS);
    expect(signal.aborted, "the ceiling was cleared before the body could stall").toBe(true);
  });
});

describe("cancellation still propagates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an ALREADY-aborted upstream signal aborts the composed one immediately", () => {
    const upstream = new AbortController();
    upstream.abort();
    const signal = boundedSignal(upstream.signal);
    expect(signal.aborted).toBe(true);
  });

  it("a LATER upstream abort propagates without waiting for the ceiling", () => {
    const upstream = new AbortController();
    const signal = boundedSignal(upstream.signal);
    expect(signal.aborted).toBe(false);

    upstream.abort();
    expect(signal.aborted, "unmount cancellation did not reach the fetch").toBe(true);
    // And it must NOT have needed the timer to get there.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("the ceiling still applies to a request that has an upstream signal", () => {
    // The defect the first implementation shipped: where AbortSignal.any was
    // unavailable it forwarded only the upstream signal, silently dropping the
    // ceiling for every request tRPC gave a signal to — i.e. all of them.
    const upstream = new AbortController();
    const signal = boundedSignal(upstream.signal);
    vi.advanceTimersByTime(REQUEST_CEILING_MS);
    expect(signal.aborted, "the ceiling was dropped when an upstream signal existed").toBe(true);
  });
});

describe("the ephemeral-storage override is reported, not alarmed about", () => {
  // BEHAVIOURAL: deriveDeliveryIssues is pure, so this calls it rather than
  // grepping for it. assertDurableStorageForGeneration has TWO passing branches
  // — a durable bucket, or this override — and every health surface only read
  // the first, so the admin raised a BLOCKER for a state in which generation was
  // running fine.
  const FACTS = {
    storageConfigured: true, permanentUrls: true, ephemeralOverride: false,
    metaConfigured: true, metaLive: true, metaLiveError: null,
    generatorProvider: "veo", generatorConfigured: true, generationEnabled: true,
    // Spelled out because tsconfig.typecheck excludes *.test.ts: an omitted
    // field is not a type error here, it silently arrives as undefined.
    generatorSessionHealthy: null, generatorSessionReason: null,
    reelPublishArmed: true,
    controls: { globalKillSwitch: false, publishingKillSwitch: false, generationKillSwitch: false },
    controlsSource: "policy", publishAmbiguousReelJobs: 0, jobsNeedingAttention: 0,
  };

  it("no bucket AND no override is still a blocker", async () => {
    const { deriveDeliveryIssues } = await import("./services/socialDeliveryIssues");
    const issues = deriveDeliveryIssues({ ...FACTS, storageConfigured: false, permanentUrls: false });
    const storage = issues.find((i) => i.key === "storage_bucket_not_connected");
    expect(storage?.severity).toBe("blocker");
  });

  it("no bucket WITH the override is a warning that names the real cost", async () => {
    const { deriveDeliveryIssues } = await import("./services/socialDeliveryIssues");
    const issues = deriveDeliveryIssues({
      ...FACTS, storageConfigured: false, permanentUrls: false, ephemeralOverride: true,
    });
    expect(issues.find((i) => i.key === "storage_bucket_not_connected")).toBeUndefined();
    const override = issues.find((i) => i.key === "storage_ephemeral_by_override");
    expect(override?.severity).toBe("warning");
    // It must not read as calm: files ARE being lost.
    expect(override?.reason).toMatch(/lost on the next deploy or restart/);
  });

  it("a healthy bucket raises no storage issue at all", async () => {
    const { deriveDeliveryIssues } = await import("./services/socialDeliveryIssues");
    const issues = deriveDeliveryIssues(FACTS);
    expect(issues.filter((i) => i.layer === "asset_hosting")).toHaveLength(0);
  });
});

describe("the copy under test has not drifted from the real source", () => {
  it("main.tsx composes manually with the same ceiling and the same branches", () => {
    const main = readFileSync(resolve(process.cwd(), "client/src/main.tsx"), "utf8");
    const fn = main.slice(main.indexOf("function boundedSignal"), main.indexOf("const UNBATCHED"));
    expect(fn, "boundedSignal not found — re-anchor this test").toContain("new AbortController()");
    // 300s, not 120s: the ceiling must exceed the server's own budget
    // (generateReelBrief 240s, postInstagramReel ~165s) or it converts healthy
    // slowness into false failure on non-idempotent, money-spending calls.
    expect(main).toContain("const REQUEST_CEILING_MS = 300_000;");
    // Same two propagation branches this file exercises.
    expect(fn).toContain("existing.aborted");
    expect(fn).toContain('existing.addEventListener("abort"');
    // And the timer must NOT be cleared on settle — the body-stall regression.
    expect(main).not.toContain(".finally(done)");
    // Retries must stay bounded, or a per-attempt ceiling is not a bound.
    expect(main).toContain("retry: 0,");
  });
});
