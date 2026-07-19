/**
 * The static path must be governed by the SAME boundary as the reel path.
 *
 * reelPipeline.ts and selectiveRepair.ts both pass through enforceAtBoundary, so
 * the reel path honours the kill switch, the operating mode, the daily generation
 * budget, and writes an audit event. Static posts — the format the operator uses
 * most — reached the model and the renderer with none of that.
 *
 * That is not a missing nicety: the emergency stop did not stop everything, and
 * the daily spend shown on the Control tab counted no static generation at all.
 * A limit that covers one of two paths is not a limit; it is a description of
 * one path.
 *
 * Asserted against SOURCE because the alternative — booting the tRPC router with
 * a live policy store and a real database — tests the harness, not the rule.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "server/routers/instagramStudio.ts"), "utf8");

describe("every paid static step passes the autonomy boundary", () => {
  it("routes through enforceAtBoundary at all", () => {
    expect(source).toContain("enforceAtBoundary");
  });

  it("gates GENERATE — the model spend", () => {
    expect(source).toMatch(/enforceStudioBoundary\("generate_campaign"/);
  });

  it("gates RENDER separately — the Queue can re-render without generate ever running", () => {
    // A gate you can reach around is not a gate: QueueV2 re-renders stored
    // drafts, so render cannot rely on generate having checked.
    expect(source).toMatch(/enforceStudioBoundary\("enqueue_render"/);
  });

  it("declares itself an OPERATOR actor, not cron", () => {
    // enforceAtBoundary lets operators proceed loudly when policy storage is
    // unreachable while automated actors fail closed. Claiming to be cron would
    // silently lock the operator out of their own studio during an outage.
    expect(source).toMatch(/type: "operator"/);
  });
});

describe("the format vocabularies are mapped, not cast", () => {
  it("maps every Studio format the router accepts to a policy format", () => {
    // INSTAGRAM_FORMATS drives the input enum; each must have a policy
    // equivalent or its permissions silently never apply.
    // Plain containment, not a built regex: `` inside a template literal is the
    // BACKSPACE escape, not a word boundary, so the constructed pattern silently
    // searched for a control character. It cost one red test to notice.
    for (const format of ["post", "carousel", "story", "ad", "reel"]) {
      expect(source).toContain(`${format}: "`);
    }
  });

  it("maps `ad` to paidAd — the one format that can spend paid media", () => {
    expect(source).toMatch(/ad: "paidAd"/);
  });

  it("REFUSES an unmapped format instead of passing an unknown key through", () => {
    // An unrecognised key matches no permission rule, so the format permission
    // would silently not apply. Failing loudly is fixable; passing is permanent.
    expect(source).toMatch(/has no autonomy-policy equivalent/);
  });

  it("does not smuggle the format past the type system with `as never`", () => {
    // The previous code cast to `as never` and mapped post/ad to "single" — a
    // key that does not exist in formatPermissions at all. The cast is what hid it.
    expect(source).not.toMatch(/format: \(.*\) as never/);
    expect(source).not.toContain('"single"');
  });
});

describe("a budget check that cannot read spend does not invent a zero", () => {
  it("omits today's counter rather than reporting the day as untouched", () => {
    // Passing generationCostUsd: 0 on an unreadable ledger would report the day
    // as untouched and let every spend limit pass — unknown-as-healthy, in the
    // one place where it costs money.
    expect(source).toMatch(/spendToday !== null \? \{ today:/);
  });
});
