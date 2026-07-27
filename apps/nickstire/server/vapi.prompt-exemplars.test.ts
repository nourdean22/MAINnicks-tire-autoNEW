/**
 * Every spoken exemplar in the prompt must obey the prompt's own word cap.
 *
 * THE FAILURE THIS PREVENTS
 * FLOW 2 tells the model to close in "3 beats (≤25 spoken words each, pause
 * between)" and its own exemplars obey that — max 22 words. FLOW 1 — TIRE, which
 * the same prompt calls "THE #1 CALL REASON", handed the model a single 54-word
 * paragraph with five moves in it (price, inclusions, stock, urgency, close) and
 * no pause anywhere. BROKEN-DOWN / TOWED, labelled "highest-value call", handed
 * over 42 words. The two most valuable call types had the worst structure.
 *
 * Measured consequence on 100 real inbound calls: assistant speech ran to p90
 * 16.25s and max 32.65s of continuous talking. A caller cannot answer, agree, or
 * interrupt during a monologue — and FLOW 1's version never asked for the phone
 * number at all, leaving capture to instruction prose the caller never hears.
 *
 * DESIGN UNDER TEST
 * The restructure preserved every word and every fact; it only split the runs
 * into FLOW 2's proven beat cadence. This test pins the RESULT rather than the
 * wording, so the copy stays free to change as long as it stays speakable.
 *
 * DELIBERATELY NOT ASSERTED: any cap on the prompt's total size. Prompt length
 * was measured against real reply latency and does not drive it (context-length
 * ↔ reply-gap r = -0.06), so trading prompt characters for shorter SPOKEN turns
 * is a good trade and this test must not punish it.
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

/** The cap the prompt sets for itself. */
const MAX_SPOKEN_WORDS = 25;

/**
 * A spoken exemplar: a double-quoted run on ONE line, long enough to be speech
 * rather than a token. Line-anchored so it cannot span quote boundaries.
 * Instruction prose is excluded — those quotes are directives to the model, not
 * lines it says aloud.
 */
const INSTRUCTION =
  /\b(?:NEVER|MUST|DO NOT|transferCall|escalate|tireInquiry|bookSlot|sendConfirmationSms|shopInfo|→)\b/;

function spokenExemplars(prompt: string): Array<{ words: number; text: string }> {
  const out: Array<{ words: number; text: string }> = [];
  for (const line of prompt.split("\n")) {
    for (const m of line.matchAll(/"([^"]{25,})"/g)) {
      const q = m[1]!;
      if (INSTRUCTION.test(q)) continue;
      if (!/[a-z]/.test(q)) continue;
      out.push({ words: q.split(/\s+/).filter(Boolean).length, text: q });
    }
  }
  return out;
}

describe("prompt exemplars stay speakable", () => {
  const exemplars = spokenExemplars(ASSISTANT_SYSTEM_PROMPT);

  it("finds exemplars at all (guard against the extractor silently matching nothing)", () => {
    expect(exemplars.length).toBeGreaterThan(40);
  });

  it(`no spoken exemplar exceeds the prompt's own ${MAX_SPOKEN_WORDS}-word cap`, () => {
    const over = exemplars
      .filter((e) => e.words > MAX_SPOKEN_WORDS)
      .map((e) => `${e.words}w: ${e.text.slice(0, 90)}…`);
    expect(over, `exemplars over ${MAX_SPOKEN_WORDS} words:\n${over.join("\n")}`).toEqual([]);
  });

  it("the two highest-value flows still carry their beat structure", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/FLOW 1 — TIRE[\s\S]{0,400}Beat 1/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/BROKEN-DOWN[\s\S]{0,400}Beat 1/);
  });

  it("the tire close asks for the number out loud (it did not before)", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Beat 3 \(CAPTURE\)[\s\S]{0,120}name and best number/);
  });

  it("the restructure kept the facts, not just the shape", () => {
    for (const kept of [
      "sixty dollars installed",
      "computer spin balancing",
      "most standard sizes in stock",
      "First-come first-served",
      "paying for the tow",
      "free written quote",
    ]) {
      expect(ASSISTANT_SYSTEM_PROMPT, `dropped: ${kept}`).toContain(kept);
    }
  });

  it("the detector is not vacuous — it catches the 54-word run that shipped", () => {
    const shipped = `- USED: "Used tires start at sixty dollars installed — that includes mounting, computer spin balancing, new valve stems, an alignment check, and a safety check. We keep most standard sizes in stock. Stock turns fast, easier to come look than describe. First-come first-served, earlier the better. Pull up today, we'll get you taken care of."`;
    const found = spokenExemplars(shipped);
    expect(found).toHaveLength(1);
    expect(found[0]!.words).toBeGreaterThan(MAX_SPOKEN_WORDS);
  });
});
