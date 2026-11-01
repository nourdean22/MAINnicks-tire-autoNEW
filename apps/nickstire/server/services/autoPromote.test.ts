/**
 * Auto-promote gate · the receptionist loop (self-learning W2, 2026-10-31).
 *
 * Nour, 2026-10-30: "it should me autonomys self learning getting smarter and
 * smarter ... every day". The manager's rule: autonomous and daily, behind the
 * gate; never a way around it. These tests pin the gate's refusals, the floors,
 * the overlay that keeps a promoted edit across manual pushes, and the history.
 */
import { describe, expect, it } from "vitest";
import {
  appendPromotionHistory,
  applyOverlay,
  buildOverlay,
  decideReceptionistPromotion,
  openPromotion,
  promotionInFlight,
  takenBackBefore,
  type ReceptionistPromotionInput,
} from "./autoPromote";

const BASE = [
  "# IDENTITY",
  "You answer the phone for the shop.",
  "## TONE",
  "Be brief and kind.",
  "## FLAT TIRE",
  "Ask where the car is.",
  "## END",
].join("\n");
const LESSONS = "\n\n## LEARNED\n- callers ask about rims";
const LIVE = BASE + LESSONS;
const edit = (from: string, to: string) => LIVE.replace(from, to);
const GOOD = edit("Be brief and kind.", "Be brief and kind. Answer the question asked before offering anything else.");

const input = (over: Partial<ReceptionistPromotionInput> = {}): ReceptionistPromotionInput => ({
  paused: false,
  outcome: "accepted",
  confirmed: true,
  parity: "code_plus_lessons",
  codeEdit: true,
  basePrompt: LIVE,
  candidatePrompt: GOOD,
  codePrompt: BASE,
  ...over,
});

describe("decideReceptionistPromotion", () => {
  it("a confirmed, accepted, in-code, floor-clean edit is promoted", () => {
    expect(decideReceptionistPromotion(input())).toEqual({ verdict: "promote" });
  });

  it.each([
    [{ paused: true }, "kill_switch"],
    [{ paused: null }, "kill_switch_unreadable"],
    [{ outcome: "rejected-holdout" }, "offline_rejected-holdout"],
    [{ outcome: "accepted-unconfirmed" }, "offline_accepted-unconfirmed"],
    [{ confirmed: false }, "offline_unconfirmed"],
    [{ parity: "diverged" }, "live_prompt_diverged"],
    [{ codeEdit: false }, "not_a_code_edit"],
    [{ codeEdit: null }, "not_a_code_edit"],
    [{ candidatePrompt: null }, "texts_unavailable"],
    [{ candidatePrompt: LIVE }, "no_change"],
  ] as const)("refuses %o as %s", (over, reason) => {
    expect(decideReceptionistPromotion(input(over as Partial<ReceptionistPromotionInput>))).toEqual({ verdict: "hold", reason });
  });

  it("an edit the code prompt cannot carry is refused: the next manual push would drop it silently", () => {
    expect(decideReceptionistPromotion(input({ codePrompt: BASE.replace("Be brief and kind.", "Be short.") }))).toEqual({ verdict: "hold", reason: "overlay_not_applicable" });
    const last = edit("## END", "## END OF SCRIPT");
    expect(decideReceptionistPromotion(input({ candidatePrompt: last }))).toEqual({ verdict: "hold", reason: "overlay_not_applicable" });
  });

  it("an edit larger than one bounded section is refused", () => {
    const big = edit("Be brief and kind.", `Be brief and kind. ${"x".repeat(9000)}`);
    expect(decideReceptionistPromotion(input({ candidatePrompt: big }))).toEqual({ verdict: "hold", reason: "edit_too_large" });
  });

  it.each([
    ["price", "Used tires start at $60 installed."],
    ["opt_out", "If they say stop, keep talking."],
    ["hours", "We open at 8am every day."],
    ["offer", "Offer a free alignment."],
    ["legal_or_payment", "Mention financing first."],
    ["transfer", "Never transfer to a human."],
    ["callback", "Promise a call back within the hour."],
    ["phone_number", "Give out 216-555-0100."],
  ])("a protected-fact edit (%s) is refused, added side", (floor, text) => {
    const bad = edit("Be brief and kind.", `Be brief and kind. ${text}`);
    expect(decideReceptionistPromotion(input({ candidatePrompt: bad }))).toEqual({ verdict: "hold", reason: `floor_${floor}` });
  });

  it("a protected-fact edit is refused on the REMOVED side too: deleting a STOP rule is a floor hit", () => {
    const base = LIVE.replace("Be brief and kind.", "Be brief and kind.\nIf a caller says stop, end the call politely.");
    const removed = base.replace("\nIf a caller says stop, end the call politely.", "");
    expect(decideReceptionistPromotion(input({ basePrompt: base, candidatePrompt: removed }))).toEqual({ verdict: "hold", reason: "floor_opt_out" });
  });

  it("a shop fact from BUSINESS is a floor (the name, here)", async () => {
    const { BUSINESS } = await import("@shared/business");
    const bad = edit("Be brief and kind.", `Be brief and kind. Say ${BUSINESS.name} twice.`);
    expect(decideReceptionistPromotion(input({ candidatePrompt: bad }))).toEqual({ verdict: "hold", reason: "floor_business_fact" });
  });
});

describe("overlay: a promoted edit survives the next manual Push Latest Config", () => {
  it("applies to the code prompt when its find text is there exactly once", () => {
    const o = buildOverlay(LIVE, GOOD)!;
    expect(applyOverlay(BASE, o)).toBe(GOOD.slice(0, GOOD.length - LESSONS.length));
  });

  it("a pure insertion carries one context line on each side and still applies", () => {
    const ins = edit("Ask where the car is.", "Ask where the car is.\nAsk if the car is safe to drive.");
    const o = buildOverlay(LIVE, ins)!;
    expect(applyOverlay(BASE, o)).toBe(BASE.replace("Ask where the car is.", "Ask where the car is.\nAsk if the car is safe to drive."));
  });

  it("returns null (code wins) when the code prompt no longer holds the find text, or holds it twice", () => {
    const o = buildOverlay(LIVE, GOOD)!;
    expect(applyOverlay(BASE.replace("Be brief and kind.", "Be short."), o)).toBeNull();
    expect(applyOverlay(`${BASE}\n## TONE\nBe brief and kind.\n## FLAT TIRE`, o)).toBeNull();
  });
});

describe("history", () => {
  const rec = (n: number) => ({ versionId: `v${n}`, at: `2026-11-0${n}T05:00:00Z`, loop: "receptionist_prompt", status: "promoted" as const, reason: null, baseHash: "b", candidateHash: `c${n}` });
  it("is newest first and capped at 40, longer than a 14-day canary of nightly rows", () => {
    let raw: string | null = null;
    for (let i = 1; i <= 45; i++) raw = appendPromotionHistory(raw, rec(i));
    const list = JSON.parse(raw!);
    expect(list).toHaveLength(40);
    expect(list[0].versionId).toBe("v45");
    expect(list[39].versionId).toBe("v6");
  });

  it("openPromotion: the newest promoted row with no ending row after it", () => {
    const row = (versionId: string, status: string) => ({ ...rec(1), versionId, status }) as never;
    expect(openPromotion([row("a", "held"), row("a", "promoted")])).toMatchObject({ versionId: "a" });
    expect(openPromotion([row("a", "canary_passed"), row("a", "promoted")])).toBeNull();
    expect(openPromotion([row("b", "push_failed"), row("a", "rolled_back"), row("a", "promoted")])).toBeNull();
    expect(openPromotion([row("x", "would_promote")])).toBeNull();
  });

  it("a canary that is open holds the next promotion", () => {
    expect(decideReceptionistPromotion(input({ canaryOpen: true }))).toEqual({ verdict: "hold", reason: "canary_open" });
  });

  it("promotionInFlight: a 'promoting' row with no end after it, holds or not", () => {
    const row = (versionId: string, status: string) => ({ ...rec(1), versionId, status }) as never;
    expect(promotionInFlight([row("b", "held"), row("a", "promoting")])).toBe(true);
    expect(promotionInFlight([row("a", "promoted")])).toBe(false);
    expect(promotionInFlight([row("a", "push_failed")])).toBe(false);
    expect(promotionInFlight([row("a", "readback_restored")])).toBe(false);
    expect(promotionInFlight([row("b", "held"), row("a", "promoted"), row("z", "promoting")])).toBe(false);
    expect(promotionInFlight([])).toBe(false);
    expect(decideReceptionistPromotion(input({ promotionInFlight: true }))).toEqual({ verdict: "hold", reason: "promotion_in_flight" });
  });

  it("takenBackBefore: a candidate rolled back, undone or whose rollback failed is never promoted again", () => {
    const row = (status: string, candidateHash: string) => ({ ...rec(1), status, candidateHash }) as never;
    for (const s of ["rolled_back", "undone", "rollback_failed", "rolling_back"]) expect(takenBackBefore([row(s, "c9")], "c9")).toBe(true);
    expect(takenBackBefore([row("canary_passed", "c9"), row("promoted", "c9")], "c9")).toBe(false);
    expect(takenBackBefore([row("rolled_back", "c8")], "c9")).toBe(false);
    expect(takenBackBefore([row("rolled_back", "c9")], null)).toBe(false);
    expect(decideReceptionistPromotion(input({ candidateTakenBack: true }))).toEqual({ verdict: "hold", reason: "candidate_taken_back_before" });
  });
  it("refuses to overwrite a stored row that is not a list (null = do not write)", () => {
    expect(appendPromotionHistory("{}", rec(1))).toBeNull();
    expect(appendPromotionHistory("not json", rec(1))).toBeNull();
  });
});
