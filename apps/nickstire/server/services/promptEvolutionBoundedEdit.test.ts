/**
 * The optimizer's bounded edit (2026-10-09).
 *
 * WHY. The first two live runs of the receptionist prompt experiment rejected
 * both candidates before any replay: asked to re-emit the COMPLETE edited
 * prompt (32,000 characters), gpt-oss:120b dropped 24 and 5 compliance clauses
 * on the way, and replayPolicy refused the result. The optimizer now returns
 * one FIND/REPLACE excerpt and the code applies it to the full prompt, so
 * every character outside the excerpt survives by construction.
 *
 * Pins: parse both reply shapes; exact and line-trimmed placement; refusals
 * for a missing, ambiguous, blank or over-cap excerpt; the rest of the prompt
 * is byte-identical after an applied edit (the positive control is an edit
 * that DOES change the one section).
 */
import { describe, expect, it } from "vitest";
import { applyBoundedEdit, parseOptimizerReply } from "./promptEvolution";

const PROMPT = [
  "# IDENTITY",
  "You are the receptionist for Nick's Tire & Auto.",
  "",
  "# OPENING",
  "  Start neutral. Ask what the caller needs before specializing.",
  "  Never assume used tires before a tire signal.",
  "",
  "# PRICING",
  "Never quote repair prices. Used tires from $60.",
  "",
  "# TRANSFER",
  "Ask before transferring. Never transfer when closed.",
].join("\n");

describe("parseOptimizerReply", () => {
  it("reads a bounded edit with its rationale, stripping the marker newlines", () => {
    const r = parseOptimizerReply("RATIONALE: route tire repair\n<FIND>\n  Start neutral. Ask what the caller needs before specializing.\n</FIND>\n<REPLACE>\n  Start neutral. Ask what the caller needs before specializing.\n  A caller who says repair is routed to repair, not tire sales.\n</REPLACE>");
    expect(r.rationale).toBe("route tire repair");
    expect(r.edit).toEqual({
      find: "  Start neutral. Ask what the caller needs before specializing.",
      replace: "  Start neutral. Ask what the caller needs before specializing.\n  A caller who says repair is routed to repair, not tire sales.",
    });
    expect(r.whole).toBeNull();
  });

  it("still reads the legacy whole-prompt block, and reads nothing from analysis-only text", () => {
    const whole = parseOptimizerReply(`RATIONALE: x\n<PROMPT>\n${PROMPT}\n</PROMPT>`);
    expect(whole.edit).toBeNull();
    expect(whole.whole).toBe(PROMPT);
    const none = parseOptimizerReply("Thinking about it, the opening section could be clearer.");
    expect(none).toEqual({ rationale: null, edit: null, whole: null });
    // A whole-prompt block under 200 chars is not a prompt.
    expect(parseOptimizerReply("<PROMPT>short</PROMPT>").whole).toBeNull();
  });
});

describe("applyBoundedEdit", () => {
  it("replaces exactly the excerpt and keeps every other character (positive control: the section did change)", () => {
    const r = applyBoundedEdit(PROMPT, {
      find: "  Start neutral. Ask what the caller needs before specializing.",
      replace: "  Start neutral. Ask what the caller needs before specializing.\n  A caller who says repair is routed to repair, not tire sales.",
    });
    expect("prompt" in r).toBe(true);
    const out = (r as { prompt: string }).prompt;
    expect(out).toContain("A caller who says repair is routed to repair");
    expect(out).not.toBe(PROMPT);
    // Everything outside the edited line is byte-identical.
    const [before, after] = PROMPT.split("  Start neutral. Ask what the caller needs before specializing.");
    expect(out.startsWith(before)).toBe(true);
    expect(out.endsWith(after)).toBe(true);
    expect(out).toContain("Never quote repair prices. Used tires from $60.");
    expect(out).toContain("Ask before transferring. Never transfer when closed.");
  });

  it("places a line-trimmed excerpt (the model reflowed indentation), never a reworded one", () => {
    const r = applyBoundedEdit(PROMPT, { find: "Start neutral. Ask what the caller needs before specializing.\nNever assume used tires before a tire signal.", replace: "Start neutral.\nNever assume used tires before a tire signal." });
    expect(r).toEqual({ prompt: PROMPT.replace("  Start neutral. Ask what the caller needs before specializing.\n  Never assume used tires before a tire signal.", "Start neutral.\nNever assume used tires before a tire signal.") });
    const reworded = applyBoundedEdit(PROMPT, { find: "Start neutral and ask what the caller needs.", replace: "x" });
    expect(reworded).toMatchObject({ refused: expect.stringContaining("not found") });
  });

  it("refuses an ambiguous, blank or over-cap excerpt", () => {
    const twice = `${PROMPT}\n\n# NOTE\nAsk before transferring. Never transfer when closed.`;
    expect(applyBoundedEdit(twice, { find: "Ask before transferring. Never transfer when closed.", replace: "x" })).toMatchObject({ refused: expect.stringContaining("occurs 2 times") });
    expect(applyBoundedEdit(PROMPT, { find: "   \n  ", replace: "x" })).toMatchObject({ refused: expect.stringContaining("blank") });
    expect(applyBoundedEdit(PROMPT, { find: "x".repeat(4001), replace: "x" })).toMatchObject({ refused: expect.stringContaining("cap is 4000") });
    expect(applyBoundedEdit(PROMPT, { find: "# PRICING", replace: "# PRICING\n" + "y".repeat(2600) })).toMatchObject({ refused: expect.stringContaining("grows the section") });
  });

  it("a deletion is applied (the policy guard downstream decides whether it was allowed)", () => {
    const r = applyBoundedEdit(PROMPT, { find: "  Never assume used tires before a tire signal.\n", replace: "" });
    expect(r).toEqual({ prompt: PROMPT.replace("  Never assume used tires before a tire signal.\n", "") });
  });

  it("CRLF prompts are handled and come back LF", () => {
    const crlf = PROMPT.replace(/\n/g, "\r\n");
    const r = applyBoundedEdit(crlf, { find: "# PRICING", replace: "# PRICES" });
    expect(r).toEqual({ prompt: PROMPT.replace("# PRICING", "# PRICES") });
  });
});
