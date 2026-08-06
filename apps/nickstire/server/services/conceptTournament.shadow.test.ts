/**
 * Shadow judge · doctrine tests for the single-verdict parser.
 *
 * parseSingleVerdict is the mechanism between the judge LLM and the
 * disagreement corpus: it must tolerate prose-wrapped JSON (both shapes have
 * come off this lane) and must REFUSE to fabricate a score when the payload
 * carries none — a fabricated all-clear in a shadow lane would poison the
 * exact dataset the gate-flip decision depends on.
 */
import { describe, expect, it } from "vitest";
import { parseSingleVerdict } from "./conceptTournament";

const verdict = {
  scores: [{ id: "entry_01", total: 74, rejected: false, rejectionReason: "", note: "solid hook" }],
  winnerId: "entry_01",
  judgeReasoning: "clear field of one",
};

describe("parseSingleVerdict", () => {
  it("parses a clean verdict payload", () => {
    const s = parseSingleVerdict(JSON.stringify(verdict));
    expect(s.total).toBe(74);
    expect(s.rejected).toBe(false);
  });

  it("tolerates prose around the JSON", () => {
    const s = parseSingleVerdict(`Here is my verdict:\n${JSON.stringify(verdict)}\nDone.`);
    expect(s.total).toBe(74);
  });

  it("a rejected entry survives with its reason", () => {
    const rejected = {
      ...verdict,
      scores: [{ id: "entry_01", total: 22, rejected: true, rejectionReason: "invented statistic", note: "" }],
    };
    const s = parseSingleVerdict(JSON.stringify(rejected));
    expect(s.rejected).toBe(true);
    expect(s.rejectionReason).toContain("invented");
  });

  it("REFUSES a payload with no usable score — never fabricates one", () => {
    expect(() => parseSingleVerdict(JSON.stringify({ winnerId: "entry_01", judgeReasoning: "?" }))).toThrow(/refusing to fabricate/);
    expect(() => parseSingleVerdict(JSON.stringify({ scores: [{ id: "entry_01", rejected: false }] }))).toThrow(/refusing to fabricate/);
  });

  it("junk input throws rather than returning garbage", () => {
    expect(() => parseSingleVerdict("the judge is out to lunch")).toThrow();
  });
});
