/**
 * tests/inngest/intelligence-brief-ratable.test.ts · 2026-10-02 · full-circle wave 2 (Lane D)
 *
 * The daily brief must be rateable on the path it normally ARRIVES on. The
 * outcome-ledger census found the combined push (intelligence-brief step 5)
 * carried no ledger id and no actions: `recordShown`'s id was discarded in
 * step 4, so the only rateable brief was the 35-minute backstop's
 * (morning-brief.ts sendBriefPush). Pinned here: the shared affordance
 * produces the shapes sw.js and the Telegram webhook already parse, and the
 * brief function keeps the id and spreads the affordance on BOTH delivery
 * paths. Source-level for the Inngest steps, as tests/services/daily-brief-
 * ratable.test.ts pins the backstop.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ratingPushActions, ratingTelegramButtons } from "@/lib/services/outcome-rating-affordance";

const BRIEF = readFileSync(join(__dirname, "../../lib/inngest/functions/intelligence-brief.ts"), "utf8");
const MORNING = readFileSync(join(__dirname, "../../lib/inngest/functions/morning-brief.ts"), "utf8");
const PROACTIVE = readFileSync(join(__dirname, "../../lib/brain/proactive-pushes.ts"), "utf8");
const SW = readFileSync(join(__dirname, "../../public/sw.js"), "utf8");
const WEBHOOK = readFileSync(join(__dirname, "../../app/api/telegram/webhook/route.ts"), "utf8");

describe("ratingPushActions / ratingTelegramButtons · the one owner of the rating affordance", () => {
  it("a ledger id yields the oc_* actions the service worker routes, with the id in data", () => {
    const fields = ratingPushActions("led-1");
    expect(fields).toEqual({
      data: { ledgerId: "led-1" },
      actions: [
        { action: "oc_useful", title: "👍 Useful" },
        { action: "oc_not_useful", title: "👎 Not useful" },
      ],
    });
    // The consumer that makes these actions mean anything.
    expect(SW).toContain("oc_");
    expect(SW).toContain("/api/outcomes/rate");
  });

  it("a ledger id yields the oc:<u|n>:<id> buttons the Telegram webhook parses", () => {
    expect(ratingTelegramButtons("led-1")).toEqual([
      [
        { text: "👍 Useful", callback_data: "oc:u:led-1" },
        { text: "👎 Not useful", callback_data: "oc:n:led-1" },
      ],
    ]);
    expect(WEBHOOK).toContain('action === "oc"');
    expect(WEBHOOK).toContain('parts[1] === "u"');
  });

  it("no ledger id → no affordance, never a button that rates nothing", () => {
    expect(ratingPushActions(null)).toEqual({});
    expect(ratingPushActions(undefined)).toEqual({});
    expect(ratingTelegramButtons(null)).toBeNull();
  });
});

describe("intelligence-brief keeps the ledger id and rates on both delivery paths", () => {
  const stepBody = (src: string, name: string) => {
    const start = src.indexOf(`step.run("${name}"`);
    expect(start, `step ${name} exists`).toBeGreaterThan(-1);
    const next = src.indexOf("step.run(", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };

  it("save-brief-log RETURNS the id recordShown gives back (it used to discard it)", () => {
    const save = stepBody(BRIEF, "save-brief-log");
    expect(save).toMatch(/const id = await recordShown\(/);
    expect(save).toContain("return { ledgerId: id }");
    // Read defensively: a run that memoized this step before it returned anything
    // replays null, and a destructure there would fail the brief for the buttons.
    expect(BRIEF).toContain('const savedBrief = await step.run("save-brief-log"');
    expect(BRIEF).toContain("savedBrief?.ledgerId ?? null");
  });

  it("dispatch-push spreads the rating actions", () => {
    expect(stepBody(BRIEF, "dispatch-push")).toContain("...ratingPushActions(ledgerId)");
  });

  it("the Telegram fallback carries the rating buttons when there is a row to rate", () => {
    const tg = stepBody(BRIEF, "telegram-fallback");
    expect(tg).toContain("ratingTelegramButtons(ledgerId)");
    expect(tg).toContain("sendTelegramWithButtons(text, buttons)");
    // …and still ships the brief when there is no row (plain send).
    expect(tg).toContain("sendTelegram(text)");
  });

  it("the backstop and the proactive pushes consume the SAME owner — no hand-built copy survives", () => {
    expect(MORNING).toContain("...ratingPushActions(ledgerId)");
    expect(MORNING).not.toContain('action: "oc_useful"');
    expect(PROACTIVE).toContain("ratingTelegramButtons(ledgerId)");
    expect(PROACTIVE).not.toContain("callback_data: `oc:u:");
  });
});
