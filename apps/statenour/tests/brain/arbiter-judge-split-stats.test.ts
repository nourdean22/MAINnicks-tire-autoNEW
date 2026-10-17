/**
 * tests/brain/arbiter-judge-split-stats.test.ts · 2026-10-17 (deep scout v2 item 1)
 *
 * The 2026-10-23 keep/kill read of NICK_RECALL_ARBITER prints a cluster-robust
 * interval and a verdict word. Pins: the clustered SE formula (cross-checked
 * against inspect_ai std.py `_clustered_stderr`), unknown-is-NaN for G < 2, the
 * verdict thresholds (interval, never point estimate), the t table, and the
 * cluster key (conversationId, else the judge row's ET day, never the message).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  summarizeArm,
  compareArms,
  tQuantile975,
  clusterKeyOf,
  splitJudgments,
  parseWindow,
  controlArmNote,
  DECISION_RULE,
  FLAG_FLIP_AT,
  assignmentForSplit,
} from "../../scripts/arbiter-judge-split";

const src = readFileSync(new URL("../../scripts/arbiter-judge-split.ts", import.meta.url), "utf8");

type Row = { composite: number; cluster: string };

/** `clusters` clusters of `per` identical rows each; cluster i gets values[i % values.length]. */
function arm(prefix: string, clusters: number, per: number, values: number[]): Row[] {
  const rows: Row[] = [];
  for (let g = 0; g < clusters; g++) {
    for (let k = 0; k < per; k++) rows.push({ composite: values[g % values.length], cluster: `${prefix}${g}` });
  }
  return rows;
}

describe("(a) a 0.3 gap whose interval crosses zero is `cannot tell`, never `better`", () => {
  it("means 7.3 vs 7.0, 10 clusters each, between-cluster spread +/-1", () => {
    const treat = summarizeArm(arm("t", 10, 3, [6.3, 8.3]));
    const control = summarizeArm(arm("c", 10, 3, [6.0, 8.0]));
    expect(treat.mean).toBeCloseTo(7.3, 10);
    expect(control.mean).toBeCloseTo(7.0, 10);
    const cmp = compareArms(treat, control);
    expect(cmp.diff).toBeCloseTo(0.3, 10);
    expect(cmp.ciLow).toBeLessThan(0);
    expect(cmp.ciHigh).toBeGreaterThan(0);
    expect(cmp.verdict).toBe("cannot tell");
  });
});

describe("(b) POSITIVE CONTROL: a planted large gap reads `better`, mirrored reads `worse`", () => {
  const high = () => summarizeArm(arm("t", 20, 2, [8.0, 8.2]));
  const low = () => summarizeArm(arm("c", 20, 2, [5.0, 5.2]));
  it("treat far above control -> better", () => {
    const cmp = compareArms(high(), low());
    expect(cmp.diff).toBeCloseTo(3, 10);
    expect(cmp.ciLow).toBeGreaterThan(0);
    expect(cmp.verdict).toBe("better");
  });
  it("treat far below control -> worse", () => {
    const cmp = compareArms(low(), high());
    expect(cmp.ciHigh).toBeLessThan(0);
    expect(cmp.verdict).toBe("worse");
  });
  it("df is the conservative min(G_t, G_c) - 1 and se adds the arms in quadrature", () => {
    const h = high();
    const small = summarizeArm(arm("s", 6, 4, [7.0, 9.0]));
    const cmp = compareArms(h, small);
    const se = Math.sqrt(h.se ** 2 + small.se ** 2);
    expect(cmp.se).toBeCloseTo(se, 12);
    expect(cmp.ciHigh - cmp.diff).toBeCloseTo(tQuantile975(5) * se, 12);
  });
});

describe("(c) clustering matters: correlated rows widen the interval", () => {
  const values = [6, 7, 8, 9];
  const four = arm("g", 4, 10, values); // 40 rows, 4 clusters, identical within a cluster
  const forty: Row[] = four.map((r, i) => ({ composite: r.composite, cluster: `solo${i}` }));

  it("same 40 values: 4 clusters give a wider CI than 40 clusters", () => {
    const a = summarizeArm(four);
    const b = summarizeArm(forty);
    expect(a.n).toBe(40);
    expect(b.n).toBe(40);
    expect(a.clusters).toBe(4);
    expect(b.clusters).toBe(40);
    expect(a.mean).toBeCloseTo(b.mean, 12);
    expect(a.ciHigh - a.ciLow).toBeGreaterThan(b.ciHigh - b.ciLow);
  });

  it("the clustered SE is the inspect_ai formula: sqrt(G/(G-1) * sum_g s_g^2) / n", () => {
    // mean 7.5; cluster residual sums -15, -5, 5, 15 -> sum of squares 500
    expect(summarizeArm(four).se).toBeCloseTo(Math.sqrt((4 / 3) * 500) / 40, 12);
    // 40 singleton clusters: residuals +/-1.5, +/-0.5 (10 each) -> sum of squares 50
    expect(summarizeArm(forty).se).toBeCloseTo(Math.sqrt((40 / 39) * 50) / 40, 12);
  });

  it("CI = mean +/- t(0.975, G-1) * se", () => {
    const a = summarizeArm(four);
    expect(a.ciLow).toBeCloseTo(a.mean - tQuantile975(3) * a.se, 12);
    expect(a.ciHigh).toBeCloseTo(a.mean + tQuantile975(3) * a.se, 12);
  });

  it("G < 5 clusters on either arm -> `cannot tell (n too small)`, even with a huge gap", () => {
    const tiny = summarizeArm(arm("t", 4, 10, [9.9, 9.8]));
    const big = summarizeArm(arm("c", 20, 2, [1.0, 1.1]));
    expect(compareArms(tiny, big).verdict).toBe("cannot tell (n too small)");
    expect(compareArms(big, tiny).verdict).toBe("cannot tell (n too small)");
  });

  it("n < 20 on either arm -> `cannot tell (n too small)` even with 19 clusters", () => {
    const thin = summarizeArm(arm("t", 19, 1, [9.9, 9.8]));
    const big = summarizeArm(arm("c", 20, 2, [1.0, 1.1]));
    expect(thin.n).toBe(19);
    expect(compareArms(thin, big).verdict).toBe("cannot tell (n too small)");
    const enough = summarizeArm(arm("t", 20, 1, [9.9, 9.8]));
    expect(compareArms(enough, big).verdict).toBe("better");
  });
});

describe("(d) one cluster is UNKNOWN, never a confident zero", () => {
  it("G = 1 -> se, ciLow, ciHigh are NaN; mean is still the sample mean", () => {
    const one = summarizeArm(arm("only", 1, 25, [6.5]).map((r, i) => ({ ...r, composite: 6 + (i % 2) })));
    expect(one.clusters).toBe(1);
    expect(one.n).toBe(25);
    expect(Number.isNaN(one.se)).toBe(true);
    expect(Number.isNaN(one.ciLow)).toBe(true);
    expect(Number.isNaN(one.ciHigh)).toBe(true);
    expect(one.mean).toBeCloseTo(6 + 12 / 25, 12);
  });
  it("an empty arm is NaN everywhere and compares as `cannot tell (n too small)`", () => {
    const empty = summarizeArm([]);
    expect(empty.n).toBe(0);
    expect(empty.clusters).toBe(0);
    expect(Number.isNaN(empty.mean)).toBe(true);
    expect(Number.isNaN(empty.se)).toBe(true);
    const big = summarizeArm(arm("c", 20, 2, [1.0, 1.1]));
    expect(compareArms(empty, big).verdict).toBe("cannot tell (n too small)");
  });
});

describe("(e) the hard-coded t(0.975) table", () => {
  it("matches published values", () => {
    expect(tQuantile975(1)).toBe(12.706);
    expect(tQuantile975(2)).toBe(4.303);
    expect(tQuantile975(5)).toBe(2.571);
    expect(tQuantile975(10)).toBe(2.228);
    expect(tQuantile975(20)).toBe(2.086);
    expect(tQuantile975(30)).toBe(2.042);
  });
  it("1.96 above 30, NaN below 1", () => {
    expect(tQuantile975(31)).toBe(1.96);
    expect(tQuantile975(500)).toBe(1.96);
    expect(Number.isNaN(tQuantile975(0))).toBe(true);
  });
});

describe("(f) the cluster key is the conversation, else the judge row's ET day, never the message", () => {
  it("conversationId when the message row exists", () => {
    expect(clusterKeyOf("conv_abc", new Date("2026-10-17T02:30:00Z"))).toBe("conv_abc");
  });
  it("ET calendar day when the message row is gone (02:30 UTC on the 17th is the 16th in ET)", () => {
    expect(clusterKeyOf(undefined, new Date("2026-10-17T02:30:00Z"))).toBe("day:2026-10-16");
    expect(clusterKeyOf(undefined, new Date("2026-10-17T05:00:00Z"))).toBe("day:2026-10-17");
  });
  it("splitJudgments groups by conversation and by ET day, so G counts conversations, not messages", () => {
    const at = new Date("2026-10-17T03:00:00Z");
    const split = splitJudgments([
      { composite: 8, tokenUsage: { contextReceipt: { arbiterAssigned: true } }, conversationId: "c1", judgedAt: at },
      { composite: 6, tokenUsage: { contextReceipt: { arbiterAssigned: true } }, conversationId: "c1", judgedAt: at },
      { composite: 7, tokenUsage: { contextReceipt: { arbiterAssigned: true } }, conversationId: "c2", judgedAt: at },
      { composite: 5, tokenUsage: undefined, conversationId: undefined, judgedAt: at },
      { composite: 4, tokenUsage: undefined, conversationId: undefined, judgedAt: new Date("2026-10-17T03:30:00Z") },
    ]);
    expect(split.clustered.true.map((r) => r.cluster).sort()).toEqual(["c1", "c1", "c2"]);
    expect(split.clustered.unknown.map((r) => r.cluster)).toEqual(["day:2026-10-16", "day:2026-10-16"]);
    expect(summarizeArm(split.clustered.true).clusters).toBe(2);
    expect(summarizeArm(split.clustered.unknown).clusters).toBe(1);
  });
});

describe("the CLI prints the interval, the verdict and the rule verbatim", () => {
  it("selects conversationId and uses the stats helpers", () => {
    expect(src).toMatch(/conversationId:\s*true/);
    expect(src).toMatch(/compareArms\(/);
    expect(src).toMatch(/difference true-false:/);
  });
  it("states the rule and the before/after caveat verbatim, pointing the re-read at --since", () => {
    expect(DECISION_RULE).toBe(
      "rule: worse -> switch the flag off; better or cannot tell -> keep it on and re-read in a week with --since 2026-10-02 (the window must reach before the 2026-10-17 flip: false = before, true = after). Before/after split, not randomized: a difference can be time, not the arbiter.",
    );
    expect(DECISION_RULE).not.toMatch(/--days/);
    expect(src).toMatch(/console\.log\(DECISION_RULE\)/);
  });
});

describe("review fix · --since pins the window start before the flip", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  it("--since YYYY-MM-DD sets the window start to that UTC midnight and overrides --days", () => {
    const w = parseWindow(["node", "s.ts", "--since", "2026-10-09"], now);
    expect("error" in w).toBe(false);
    if ("error" in w) return;
    expect(w.since.toISOString()).toBe("2026-10-09T00:00:00.000Z");
    const both = parseWindow(["node", "s.ts", "--days", "14", "--since", "2026-10-09"], now);
    expect("error" in both ? null : both.since.toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  it("without --since the window is still --days back from now (7 by default)", () => {
    const d = parseWindow(["node", "s.ts"], now);
    expect("error" in d ? null : d.since.toISOString()).toBe("2026-10-23T12:00:00.000Z");
    const d14 = parseWindow(["node", "s.ts", "--days", "14"], now);
    expect("error" in d14 ? null : d14.since.toISOString()).toBe("2026-10-16T12:00:00.000Z");
  });

  it("garbage --since is an error, like garbage --days (main exits 1 on it)", () => {
    for (const bad of ["garbage", "2026-13-01", "2026-02-30", "10/09/2026", "2026-10-9", "2026-11-01"]) {
      expect(parseWindow(["node", "s.ts", "--since", bad], now), bad).toHaveProperty("error");
    }
    expect(parseWindow(["node", "s.ts", "--since"], now)).toHaveProperty("error");
    expect(parseWindow(["node", "s.ts", "--days", "abc"], now)).toHaveProperty("error");
    expect(parseWindow(["node", "s.ts", "--days", "-3"], now)).toHaveProperty("error");
    expect(src).toMatch(/"error" in window[\s\S]{0,200}process\.exit\(1\)/);
  });
});

describe("round 3 · pre-flip turns without a receipt field are the control arm (flag provably off)", () => {
  const before = new Date("2026-10-16T20:39:00Z");
  const after = new Date("2026-10-17T10:00:00Z");
  const absent = { contextReceipt: { entries: [] } };
  const receipt = (arbiterAssigned: boolean) => ({ contextReceipt: { arbiterAssigned, entries: [] } });

  it("FLAG_FLIP_AT is the audited override instant", () => {
    expect(FLAG_FLIP_AT.toISOString()).toBe("2026-10-17T04:49:22.000Z");
  });
  it("absent + before the flip -> false", () => {
    expect(assignmentForSplit(absent, before)).toBe("false");
    expect(assignmentForSplit(null, before)).toBe("false");
    expect(assignmentForSplit(absent, new Date(FLAG_FLIP_AT.getTime() - 1))).toBe("false");
  });
  it("absent + at or after the flip -> unknown", () => {
    expect(assignmentForSplit(absent, FLAG_FLIP_AT)).toBe("unknown");
    expect(assignmentForSplit(absent, after)).toBe("unknown");
  });
  it("a receipt's true/false wins on either side of the flip", () => {
    expect(assignmentForSplit(receipt(true), before)).toBe("true");
    expect(assignmentForSplit(receipt(false), before)).toBe("false");
    expect(assignmentForSplit(receipt(true), after)).toBe("true");
    expect(assignmentForSplit(receipt(false), after)).toBe("false");
  });
  it("message row gone (no createdAt) -> unknown", () => {
    expect(assignmentForSplit(undefined, undefined)).toBe("unknown");
    expect(assignmentForSplit(absent, undefined)).toBe("unknown");
  });
  it("97 absent pre-flip judged rows in 21 conversations give a 21-cluster control arm, nothing unknown", () => {
    const rows = Array.from({ length: 97 }, (_, i) => ({
      composite: 6 + (i % 4),
      tokenUsage: absent,
      conversationId: `conv${i % 21}`,
      messageCreatedAt: new Date(Date.parse("2026-10-02T14:08:00Z") + i * 3_600_000),
      judgedAt: before,
    }));
    const split = splitJudgments(rows);
    expect(split.buckets.false).toHaveLength(97);
    expect(split.buckets.unknown).toHaveLength(0);
    expect(split.buckets.true).toHaveLength(0);
    const control = summarizeArm(split.clustered.false);
    expect(control.clusters).toBe(21);
    expect(controlArmNote(control)).toBeNull();
  });
  it("the script selects the message createdAt and splits with it", () => {
    // the chatMessage select is the only one carrying tokenUsage
    expect(src).toMatch(/select:\s*\{\s*id:\s*true,\s*tokenUsage:\s*true,\s*conversationId:\s*true,\s*createdAt:\s*true\s*\}/);
    expect(src).toMatch(/messageCreatedAt:/);
  });
});

describe("review fix · a small control arm says why and how to widen it", () => {
  it("prints the line when the control arm is under 5 conversations or 20 turns", () => {
    const fewConvos = summarizeArm(arm("c", 3, 10, [6, 7]));
    expect(controlArmNote(fewConvos)).toBe(
      "control arm (before the flip) has 30 turns in 3 conversations: widen the window with --since",
    );
    const fewTurns = summarizeArm(arm("c", 19, 1, [6, 7]));
    expect(controlArmNote(fewTurns)).toBe(
      "control arm (before the flip) has 19 turns in 19 conversations: widen the window with --since",
    );
    expect(controlArmNote(summarizeArm([]))).toBe(
      "control arm (before the flip) has 0 turns in 0 conversations: widen the window with --since",
    );
  });
  it("prints nothing when the control arm is big enough, even if the treated arm is small", () => {
    expect(controlArmNote(summarizeArm(arm("c", 20, 2, [6, 7])))).toBeNull();
    expect(src).toMatch(/controlArmNote\(arms\.false\)/);
  });
});
