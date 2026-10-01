/**
 * Demand boost — customer mentions and rising search raise a topic, and the
 * cap keeps declined work on top.
 *
 * Positive control: with `score += demand.boost` removed from
 * mineTopicCandidates, "7 mentions outranks 0" fails with
 * `expected 26 to be greater than 26`.
 */
import { describe, expect, it } from "vitest";
import { demandTokens, mineTopicCandidates, type TopicSignals } from "./contentTopicMiner";

const PHRASE = "steering wheel shakes on the highway";
const DECLINED = "the lower control arm: what a driver actually feels when it is going, and why this is the category we do not tell people to wait on";

const scoreOf = (signals: TopicSignals, topic = PHRASE) => {
  const c = mineTopicCandidates(signals).find((x) => x.topic === topic);
  if (!c) throw new Error(`candidate missing: ${topic}`);
  return c;
};

describe("customer mention counts", () => {
  it("a topic with 7 customer mentions outranks the same topic with 0", () => {
    const seven = scoreOf({ customerQuestions: [PHRASE], customerQuestionCounts: { [PHRASE]: 7 } });
    const zero = scoreOf({ customerQuestions: [PHRASE] });
    expect(seven.score).toBeGreaterThan(zero.score);
    expect(seven.reasons.join(" ")).toContain("customer mentions ×7");
    expect(zero.reasons.join(" ")).not.toContain("customer mentions");
  });

  it("is logarithmic and capped: 1 → +1, 7 → +3, 1000 → +5", () => {
    const base = scoreOf({ customerQuestions: [PHRASE] }).score;
    const at = (n: number) => scoreOf({ customerQuestions: [PHRASE], customerQuestionCounts: { [PHRASE]: n } }).score - base;
    expect(at(1)).toBe(1);
    expect(at(7)).toBe(3);
    expect(at(1000)).toBe(5);
  });

  it("boosts a candidate from ANOTHER source whose subject customers keep raising", () => {
    const quiet = scoreOf({ topThemes: ["steering wheel shaking at speed"] }, "steering wheel shaking at speed");
    const loud = scoreOf(
      { topThemes: ["steering wheel shaking at speed"], customerQuestionCounts: { "steering wheel shakes": 7 } },
      "steering wheel shaking at speed",
    );
    expect(loud.score).toBe(quiet.score + 3);
  });

  it("an unrelated phrase does not boost", () => {
    const s = scoreOf({ customerQuestions: [PHRASE], customerQuestionCounts: { [PHRASE]: 0, "check engine light on": 9 } });
    expect(s.reasons.join(" ")).not.toContain("customer mentions");
  });
});

describe("rising search queries", () => {
  const rising = (impressions: number, deltaImpressions: number) => ({ query: "steering wheel shaking", impressions, deltaImpressions, position: 9.1 });

  it("a rising query that overlaps the subject boosts it, log-scaled", () => {
    const base = scoreOf({ customerQuestions: [PHRASE] }).score;
    expect(scoreOf({ customerQuestions: [PHRASE], gscRising: [rising(10, 4)] }).score - base).toBe(2);
    expect(scoreOf({ customerQuestions: [PHRASE], gscRising: [rising(150, 40)] }).score - base).toBe(3);
    expect(scoreOf({ customerQuestions: [PHRASE], gscRising: [rising(5000, 400)] }).score - base).toBe(4);
  });

  it("a falling or flat query does not boost", () => {
    const base = scoreOf({ customerQuestions: [PHRASE] }).score;
    expect(scoreOf({ customerQuestions: [PHRASE], gscRising: [rising(150, 0)] }).score).toBe(base);
    expect(scoreOf({ customerQuestions: [PHRASE], gscRising: [rising(150, -20)] }).score).toBe(base);
  });

  it("the reason names the query, impressions, delta and position", () => {
    const c = scoreOf({ customerQuestions: [PHRASE], gscRising: [rising(150, 40)] });
    expect(c.reasons.join(" ")).toMatch(/rising search "steering wheel shaking" 150 impr, \+40 wk\/wk, pos 9\.1/);
  });
});

describe("the cap keeps declined work on top", () => {
  it("customer + search demand together never lift a customer question over a counter refusal", () => {
    const out = mineTopicCandidates({
      declinedWork: [DECLINED],
      customerQuestions: [PHRASE],
      customerQuestionCounts: { [PHRASE]: 10000 },
      gscRising: [{ query: "steering wheel shaking", impressions: 100000, deltaImpressions: 50000, position: 3 }],
    });
    expect(out[0].source).toBe("declined_work");
    const q = out.find((c) => c.topic === PHRASE)!;
    expect(q.score).toBe(26 + 7);
    expect(q.reasons.join(" ")).toContain("demand boost capped at +7");
  });
});

describe("demandTokens — the overlap both sides share", () => {
  it("stems and drops stopwords so rephrasings share tokens", () => {
    expect(demandTokens("steering wheel shakes")).toEqual(demandTokens("my steering wheel is shaking"));
    expect(demandTokens("brakes grinding")).toEqual(new Set(["brak", "grind"]));
  });

  it("singular and plural land on one token — tire/tires, battery/batteries, rotor/rotors", () => {
    // Regression: a first stemmer cut "tires" to "tir" and left "tire" alone, so the
    // most common tire phrasing never overlapped a tire topic.
    expect(demandTokens("4 tires")).toEqual(demandTokens("tire"));
    expect(demandTokens("batteries")).toEqual(demandTokens("battery"));
    expect(demandTokens("rotors")).toEqual(demandTokens("rotor"));
    expect(demandTokens("check engine light flashing")).toEqual(demandTokens("check engine light flashes"));
  });
});
