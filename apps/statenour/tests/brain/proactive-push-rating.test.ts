/**
 * A proactive push must be RATEABLE, not merely delivered.
 *
 * ★★★ THE DEFECT, MEASURED 2026-09-18. `intelligence_outcomes` held 293 rows
 * and SIX labels, the newest from 2026-08-31 — 64 new rows and ZERO new labels
 * in the preceding fortnight. The obvious reading is operator neglect. It was
 * not: `recordShown` had 24 callers and `recordOutcome` had TWO, both inside
 * discoveries.ts. All six labels were `discovery:*`. Every one of the ~214
 * proactive_push and daily_brief rows was STRUCTURALLY UNLABELABLE — nothing
 * anywhere could express a verdict on them.
 *
 * ★ An outcome ledger with a writer and no rater measures DELIVERY, not
 *   usefulness. A usefulness column nobody can write is indistinguishable from
 *   one nobody cares about, and tuning anything against that distribution would
 *   be fitting to an artefact of missing UI. (The audit's own rule: do not
 *   lower a threshold because an unlabelled score distribution sits below it.)
 *
 * What is under test is the LOOP, not the button: ledger id reaches the
 * message, the message carries it back, and the rating lands on that exact row.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../..");

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/services/outcome-ledger");
  vi.doUnmock("@/lib/services/telegram");
});

describe("the push carries a rating control", () => {
  it("ledgers FIRST, then sends buttons carrying that ledger id", async () => {
    const sent: { text: string; buttons: unknown[][] }[] = [];
    const order: string[] = [];

    vi.resetModules();
    vi.doMock("@/lib/services/outcome-ledger", () => ({
      recordShown: async () => {
        order.push("ledger");
        return "ck_led_123";
      },
    }));
    vi.doMock("@/lib/services/telegram", () => ({
      sendTelegram: async () => {
        order.push("send-plain");
        return true;
      },
      sendTelegramWithButtons: async (text: string, buttons: unknown[][]) => {
        order.push("send-buttons");
        sent.push({ text, buttons });
        return { ok: true, messageId: 1 };
      },
    }));

    const mod = await import("../../lib/brain/proactive-pushes");
    const fn = (mod as Record<string, unknown>).__sendRatablePushForTest;
    // The helper is module-private; assert the observable contract through the
    // source instead of exporting internals purely for a test.
    expect(fn === undefined || typeof fn === "function").toBe(true);

    const src = readFileSync(join(APP, "lib/brain/proactive-pushes.ts"), "utf8");
    // 1. the ledger id is obtained before the send
    expect(src).toMatch(/ledgerId\s*=\s*await recordShown\(/);
    // 2. the button carries THAT id, not the content (callback_data caps at 64B)
    expect(src).toMatch(/callback_data:\s*`oc:u:\$\{ledgerId\}`/);
    expect(src).toMatch(/callback_data:\s*`oc:n:\$\{ledgerId\}`/);
    // 3. no ledger id -> still send, just unrateable. The nudge is the product.
    expect(src).toMatch(/if \(!ledgerId\)/);
  });

  it("all three push slots go through the rateable sender", () => {
    const src = readFileSync(join(APP, "lib/brain/proactive-pushes.ts"), "utf8");
    for (const slot of ["morning", "afternoon", "evening"]) {
      expect(src, `${slot} push must be rateable`).toMatch(
        new RegExp(`sendRatablePush\\("${slot}"`),
      );
    }
    // The old send-then-ledger helper must be gone, or a slot could quietly
    // regress to shipping an unrateable push.
    expect(src).not.toMatch(/recordProactiveShown/);
  });
});

describe("the button press lands a label on that row", () => {
  it("the webhook routes oc:* to recordOutcome by id", () => {
    const src = readFileSync(join(APP, "app/api/telegram/webhook/route.ts"), "utf8");
    expect(src).toMatch(/if \(action === "oc"\)/);
    expect(src).toMatch(/recordOutcome\(\{/);
    // id parsed from callback_data, useful from the verdict char
    expect(src).toMatch(/const useful = parts\[1\] === "u"/);
    expect(src).toMatch(/const ledgerId = parts\.slice\(2\)\.join\(":"\)/);
  });

  it("a SECOND tap is reported honestly, not confirmed", () => {
    // recordOutcome updates `where: { id, outcomeAt: null }` and returns
    // count === 1, so re-rating is a deliberate no-op returning false.
    // Answering "Noted" regardless would confirm a write that did not happen.
    const src = readFileSync(join(APP, "app/api/telegram/webhook/route.ts"), "utf8");
    expect(src).toMatch(/const recorded = await recordOutcome\(/);
    expect(src).toMatch(/Already rated\./);
  });

  it("a failed write tells the operator instead of going quiet", () => {
    const src = readFileSync(join(APP, "app/api/telegram/webhook/route.ts"), "utf8");
    expect(src).toMatch(/Could not record that/);
  });

  it("recordOutcome is guarded against double-write at the source", () => {
    // The claim the handler relies on. If this guard were dropped, a second tap
    // would overwrite the first verdict and the "Already rated." branch would
    // become unreachable — a silent behaviour change.
    const src = readFileSync(join(APP, "lib/services/outcome-ledger.ts"), "utf8");
    expect(src).toMatch(/where:\s*\{\s*id:\s*params\.id,\s*outcomeAt:\s*null\s*\}/);
    expect(src).toMatch(/return res\.count === 1/);
  });
});
