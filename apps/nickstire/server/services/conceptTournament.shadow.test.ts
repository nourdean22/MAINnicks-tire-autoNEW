/**
 * Shadow judge · doctrine tests for the single-verdict parser.
 *
 * parseSingleVerdict is the mechanism between the judge LLM and the
 * disagreement corpus: it must tolerate prose-wrapped JSON (both shapes have
 * come off this lane) and must REFUSE to fabricate a score when the payload
 * carries none — a fabricated all-clear in a shadow lane would poison the
 * exact dataset the gate-flip decision depends on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONCEPT_JUDGE_MODEL, parseSingleVerdict } from "./conceptTournament";
import { resolveEffectiveModel } from "../_core/llm";

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

/**
 * Judge-lane independence (operator-instructed pin, 2026-08-07).
 *
 * The defect this pins: the concept tournament exists to kill self-evaluation,
 * but its judge was UNPINNED. Under prod's AI_FORCE_OLLAMA=true the reroute
 * flattened judge and generator onto the same deepseek-v4-pro — and that
 * arrangement gated live IG publishes from #1419. The pin only became
 * effective once resolveEffectiveModel started honouring Ollama-native names.
 *
 * Env hygiene per AGENTS §3: singleFork shares one process.env.
 */
describe("CONCEPT_JUDGE_MODEL — the judge must not be the generator's family", () => {
  const TOUCHED = ["AI_FORCE_OLLAMA", "AI_FORCE_GEMINI", "OLLAMA_MODEL", "OLLAMA_API_KEY"] as const;
  const orig: Record<string, string | undefined> = {};
  for (const k of TOUCHED) orig[k] = process.env[k];
  afterEach(() => {
    for (const k of TOUCHED) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
    vi.unstubAllEnvs();
  });

  it("defaults to an Ollama-native, non-deepseek family", () => {
    expect(CONCEPT_JUDGE_MODEL).toBe("gpt-oss:120b");
    expect(CONCEPT_JUDGE_MODEL).not.toContain("deepseek");
  });

  it("SURVIVES the prod force-flag — the pin is real in prod, not just locally", () => {
    process.env.AI_FORCE_OLLAMA = "true";
    delete process.env.OLLAMA_MODEL; // the exact Railway config
    expect(resolveEffectiveModel(CONCEPT_JUDGE_MODEL)).toBe("gpt-oss:120b");
  });

  it("REGRESSION: judge and generator resolve to different models under the prod flag", () => {
    process.env.AI_FORCE_OLLAMA = "true";
    delete process.env.OLLAMA_MODEL;
    // pitchRole/igAutopost pass no model, so the generator takes the default.
    const generator = resolveEffectiveModel(undefined);
    const judge = resolveEffectiveModel(CONCEPT_JUDGE_MODEL);
    expect(generator).toBe("deepseek-v4-pro");
    expect(judge).not.toBe(generator);
  });

  /**
   * MECHANISM, not the constant. Everything above would still pass if
   * judgeSingleConcept never actually forwarded the pin — the exact
   * "exercised it but asserted nothing" trap. No mock needed: with the flag on
   * and the key removed, resolveApiUrl throws naming the model it resolved, so
   * the message is proof of which lane the call was really headed for.
   */
  it("judgeSingleConcept actually SENDS the pinned model — proven by the resolved-lane error", async () => {
    process.env.AI_FORCE_OLLAMA = "true";
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_API_KEY;
    const { judgeSingleConcept } = await import("./conceptTournament");
    await expect(
      judgeSingleConcept({
        campaignAsk: "pin proof",
        concept: { title: "t", hook: "h", coreIdea: "c", visualIdea: "v", whyItWorks: "w" },
      }),
    ).rejects.toThrow(/gpt-oss:120b/);
  });
});
