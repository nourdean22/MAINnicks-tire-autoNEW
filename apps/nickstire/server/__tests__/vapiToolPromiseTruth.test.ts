/**
 * The receptionist must not promise what nothing tracks, and must not tell a
 * caller something happened that did not.
 *
 * 1. The system prompt's RACK-CHECK section says "NEVER promise a callback or a
 *    timeframe — nobody is tracking that promise", but `tireInquiry.notes` told
 *    the model to write "promised 15 min callback" — and a tool description is
 *    an instruction the model reads on every call. No tool text may carry a
 *    timed callback promise.
 * 2. Since 2026-06-05 an ordinary tire inquiry persists nothing but the call
 *    record (operator directive: no admin lead per caller), yet the tool said
 *    "Phone captured = lead saved" and the caller was told "I've sent the tire
 *    info to the shop". The caller then walks in believing the counter has
 *    their size. The reply may say it was noted; it may not say it was sent.
 *
 * Found by the 2026-09-23 customer-corpus research
 * (docs/operations/CUSTOMER-CORPUS-RESEARCH-2026-09-23.md, Part C #1-#2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT, VAPI_TOOLS } from "../services/vapi";
import { ordinaryTireInquiryReply } from "../lib/tireInquiryReply";

type Param = { description?: string };
type Tool = { function?: { name?: string; description?: string; parameters?: { properties?: Record<string, Param> } } };

const toolTexts = (): Array<{ where: string; text: string }> =>
  (VAPI_TOOLS as unknown as Tool[]).flatMap((t) => {
    const fn = t.function;
    if (!fn) return [];
    const params = Object.entries(fn.parameters?.properties ?? {}).map(([k, p]) => ({
      where: `${fn.name}.${k}`,
      text: p.description ?? "",
    }));
    return [{ where: fn.name ?? "?", text: fn.description ?? "" }, ...params];
  });

const TIMED_PROMISE = /promis\w*[^.]{0,30}\b\d+\s*min|\b\d+\s*-?\s*min(ute)?s?\b[^.]{0,20}call\s*-?back|call\s*-?back[^.]{0,20}\b\d+\s*min/i;

describe("receptionist tools promise nothing untracked", () => {
  it("POSITIVE CONTROL: the matcher catches the text that shipped", () => {
    expect(TIMED_PROMISE.test("Use 'PHYSICAL RACK CHECK REQUESTED — promised 15 min callback' when…")).toBe(true);
  });

  it("no tool or parameter description carries a timed callback promise", () => {
    const offenders = toolTexts().filter(({ text }) => TIMED_PROMISE.test(text)).map(({ where }) => where);
    expect(offenders).toEqual([]);
  });

  it("tireInquiry no longer claims a lead is saved — in the tool text or the system prompt", () => {
    const d = toolTexts().find((t) => t.where === "tireInquiry")?.text ?? "";
    expect(d).not.toBe("");
    expect(d).not.toMatch(/lead saved/i);
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/lead saved/i);
    expect(TIMED_PROMISE.test(ASSISTANT_SYSTEM_PROMPT)).toBe(false);
  });
});

describe("the ordinary tire-inquiry reply tells the truth", () => {
  it("never says the info was sent to the shop", () => {
    for (const size of ["225/65R17", undefined]) {
      expect(ordinaryTireInquiryReply(size)).not.toMatch(/sent\b[^.]{0,30}\bshop/i);
    }
  });

  it("still echoes the size back so the caller can correct it", () => {
    expect(ordinaryTireInquiryReply("225/65R17")).toContain("225/65R17");
  });
});

/**
 * 3. A spoken callback is only real if escalate() ran: it is the one tool that
 *    writes callback_requests AND the Promise Ledger row (voiceAgent.ts
 *    escalate). Three prompt sentences promised callbacks with nothing behind
 *    them — the FLOW 1 close ("I'll have the shop check the rack and call you
 *    back"), the price-pushback capture, and CALLBACK CAPTURE ("someone can
 *    follow up" → a text only). CALLBACK CAPTURE is what the warm-transfer
 *    fallbackPlan hands the caller back to after a transfer rings out, so the
 *    one caller the shop has already failed once got the one promise nobody
 *    could see. Rule: every non-negated sentence that promises a callback names
 *    escalate in the same sentence.
 */
const CALLBACK_PROMISE = /\b(call(s)?\s+you\s+(right\s+)?back|get(s)?\s+back\s+to\s+you|someone\s+(can|will)\s+follow\s*-?\s*up|follow\s*-?\s*up\s+with\s+you)\b/i;
const NEGATED = /\b(never|don'?t|do not|no)\b/i;
// A closing quote or bracket can sit between the full stop and the space
// ('…a real answer." Never let…'); without it the next sentence's NEVER would
// exempt the promise before it — the false negative this split once had.
const sentences = (text: string) => text.split(/(?<=[.!?]["\u201d')]?)\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const untrackedCallbackPromises = (text: string) =>
  sentences(text).filter((x) => CALLBACK_PROMISE.test(x) && !NEGATED.test(x) && !/\bescalate\b/.test(x));

describe("every callback the receptionist promises is tracked", () => {
  it("POSITIVE CONTROL: the checker flags the sentences that shipped", () => {
    expect(untrackedCallbackPromises(
      'Capture name + phone + vehicle + issue + urgency → "I\'ll send this to the shop so someone can follow up" → sendConfirmationSms.',
    )).toHaveLength(1);
    expect(untrackedCallbackPromises(
      'offer come-in-today OR a callback to confirm stock ("I\'ll have the shop check the rack and call you back") → tireInquiry + sendConfirmationSms.',
    )).toHaveLength(1);
    // …and passes one that is tracked or forbidden.
    expect(untrackedCallbackPromises('Get name + phone, call escalate({ name, phone }), say "someone calls you back first thing."')).toHaveLength(0);
    expect(untrackedCallbackPromises("NEVER promise a callback or a timeframe.")).toHaveLength(0);
  });

  it("no sentence in the inbound system prompt promises a callback without escalate", () => {
    expect(untrackedCallbackPromises(ASSISTANT_SYSTEM_PROMPT)).toEqual([]);
  });

  it("escalate is allowed for CALLBACK CAPTURE during open hours, not only when closed", () => {
    const d = toolTexts().find((t) => t.where === "escalate")?.text ?? "";
    expect(d).not.toBe("");
    expect(d).toMatch(/CALLBACK CAPTURE/);
    expect(d).not.toMatch(/Never during open hours/i);
  });

  it("the escalate tool response does not name a person who will call back", () => {
    // The shop is Nick's Tire & Auto; its owner is not a "Nick" (shared/business.ts,
    // canonical-business-truth.test.ts). The model relays tool responses to the caller.
    const src = readFileSync(join(process.cwd(), "server/routers/voiceAgent.ts"), "utf-8");
    expect(src).not.toMatch(/Nick will call/);
  });
});

