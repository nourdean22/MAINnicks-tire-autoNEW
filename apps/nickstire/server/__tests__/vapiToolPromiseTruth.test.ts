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
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT, VAPI_TOOLS } from "../services/vapi";
import { ordinaryTireInquiryReply } from "../routers/voiceAgent";

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
