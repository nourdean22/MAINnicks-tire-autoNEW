import type { StrategicFramework } from "../types";

/**
 * OKRs (Objectives + Key Results) — Andy Grove via John Doerr.
 * Aligns the org around a small set of qualitative Objectives, each
 * measured by 3-5 quantitative Key Results. Designed to be ambitious
 * (graded on a 0.0-1.0 scale, 0.7 is "good", 1.0 means it wasn't
 * ambitious enough).
 */
export const okrs: StrategicFramework = {
  id: "okrs",
  name: "OKRs (Objectives + Key Results)",
  oneLiner: "Qualitative Objective · 3-5 quantitative Key Results · graded 0.0-1.0 · 0.7 = good · 1.0 = wasn't ambitious enough.",
  triggers: [
    /\b(okrs?|objectives?\s+and\s+key\s+results?)\b/i,
    /\b(grove|john\s+doerr|measure\s+what\s+matters)/i,
    /\b(quarterly\s+(goals?|planning))\b/i,
    /\b(stretch\s+(goals?|targets?))\b/i,
    /\b(key\s+results?|kr1|kr2|kr3)\b/i,
    /\b(cascading\s+goals?|alignment\s+across\s+teams?)\b/i,
    /\b(annual\s+plan|company\s+goals?)\b/i,
  ],
  weight: 0.95,
  lens: `Apply the OKR framework. The point isn't tracking · it's
ALIGNMENT and AMBITION. Two parts ·

  · OBJECTIVE · qualitative · inspirational · "what do we want to
    achieve." Should be ambitious enough that the team feels it ·
    not a thing you'd do anyway.

  · KEY RESULTS · 3-5 quantitative outcomes that, taken together,
    prove the objective was achieved. NOT activities ("publish
    blog posts") — outcomes ("3,000 organic visits/mo by EOQ").

Grading scale (the secret of why OKRs work) ·

  0.0-0.3 · we missed badly · learn from it
  0.4-0.6 · we made progress but didn't hit
  0.7    · the SUCCESS line · this is what good looks like
  1.0    · we hit every KR · the OKR wasn't ambitious enough ·
            recalibrate next quarter

This calibration matters · if the team scores 1.0 every quarter
they're sandbagging. If they score 0.2 every quarter they're
either incompetent or the OKRs are unrealistic. The 0.7 target
forces stretch goals without making people feel like failures
when they don't fully land.

Common mistakes ·
  · Too many OKRs · 3-5 max per team. If everything is a priority,
    nothing is.
  · KRs as activities · "ship feature X" is an output, not an
    outcome. Output is "how" · outcome is "what changed because of it."
  · Cascading top-down only · OKRs should also flow bottom-up so
    teams own their interpretation.
  · Tying to compensation · kills the ambition. Score lower to be
    safe. Keep grading separate from comp.

For Nick · quarterly OKRs around revenue · CAC payback · review
volume · repeat-customer rate. Each KR a number with a deadline.

Surface · the 1-2 Objectives that would matter most this quarter ·
3-5 quantitative KRs for each · honest baseline + ambitious target.`,
};
