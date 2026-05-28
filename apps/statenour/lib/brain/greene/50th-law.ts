/**
 * 2026-05-28 · Power Atlas · The 50th Law · 10 fearless principles.
 *
 * Greene's collaboration with Curtis "50 Cent" Jackson. The throughline:
 * acting from a place where fear has been processed, not denied. Each
 * fearless principle is mapped to triggers in the operator's schema +
 * concrete actions.
 *
 * Source: Robert Greene & 50 Cent, "The 50th Law" (2009).
 */

import type { GreeneEntry } from "./schema";

export const FEARLESS_LAWS: GreeneEntry[] = [
  {
    key: "fearless_1",
    book: "50L",
    type: "fearless_law",
    number: 1,
    title: "See things for what they are — intense realism",
    summary: "Strip away wishful thinking. Look without filter.",
    fullText:
      "Most people see what they want to see. The fearless see what actually is. Intense realism strips away the consoling story and leaves only the working facts. From there, every move is grounded; without it, every move is built on sand.",
    triggers: [
      "operator's planning depends on assumptions that haven't been verified",
      "wishful framing of a person, market, or trend",
      "important signal being filtered out because it's uncomfortable",
    ],
    actions: [
      "Write down the situation in one paragraph with no adjectives",
      "Strip out hopes; list only confirmed facts",
      "Stress-test the plan against the cold version of reality",
      "Adjust based on what's actually there",
    ],
    relatedKeys: ["law_29", "law_48", "strategy_intelligence"],
    applicabilityPrompt:
      "Is the operator's planning leaning on wishful framing rather than confirmed reality? If yes, Fearless 1 applies.",
  },
  {
    key: "fearless_2",
    book: "50L",
    type: "fearless_law",
    number: 2,
    title: "Make everything your own — self-reliance",
    summary: "Don't outsource your fate. Own it.",
    fullText:
      "The fearless build the foundation themselves. They don't depend on benefactors, lucky breaks, or someone else's permission. Every skill they need, they go acquire. Every decision they need to make, they make.",
    triggers: [
      "operator waiting for someone else's permission, decision, or approval",
      "fate handed to a benefactor or platform",
      "skills gap being filled by hope rather than learning",
    ],
    actions: [
      "Identify what you're waiting for; replace it with what you can do today",
      "Build the skill you've been outsourcing",
      "Make every major decision yours",
      "Refuse the dependency trap",
    ],
    relatedKeys: ["law_11", "mastery_apprenticeship", "law_25"],
    applicabilityPrompt:
      "Is the operator waiting for someone else's permission, decision, or approval that they could just earn themselves? If yes, Fearless 2 applies.",
  },
  {
    key: "fearless_3",
    book: "50L",
    type: "fearless_law",
    number: 3,
    title: "Turn shit into sugar — opportunism",
    summary: "Every setback contains the seed of a counter-move.",
    fullText:
      "The fearless treat reversals as raw material. Inside every disaster is a hidden angle that, found and worked, becomes the next advantage. The skill is the conversion rate from setback to setup.",
    triggers: [
      "operator recently took a hit (lost deal, public failure, betrayal)",
      "self-pity loop forming around the loss",
      "hidden opportunity in the same situation not yet identified",
    ],
    actions: [
      "Ask: what does this setback enable that wasn't possible before?",
      "Find the angle the loss opened up",
      "Move on the new angle before the loss settles",
      "Don't dwell; convert",
    ],
    relatedKeys: ["law_22", "strategy_counterattack", "fearless_8"],
    applicabilityPrompt:
      "Did the operator recently take a hit that contains a hidden counter-move opportunity? If yes, Fearless 3 applies.",
  },
  {
    key: "fearless_4",
    book: "50L",
    type: "fearless_law",
    number: 4,
    title: "Keep moving — calculated momentum",
    summary: "Motion creates options that stasis can't.",
    fullText:
      "Stop moving and your enemies find you, the market passes you, and confidence evaporates. Even imperfect motion beats perfect stasis. Momentum is its own asset; it creates options that don't exist when you're still.",
    triggers: [
      "operator stuck in analysis or recovery for >14 days",
      "decision deferred because no option seems clearly best",
      "comfort with the current state masking decline",
    ],
    actions: [
      "Pick the directionally-correct move; commit to it this week",
      "Take one tangible action toward the next chapter today",
      "Generate momentum through small visible wins",
      "Don't let perfection block motion",
    ],
    relatedKeys: ["law_28", "strategy_lightning", "strategy_polarity"],
    applicabilityPrompt:
      "Is the operator stuck in analysis or recovery for too long when motion would create new options? If yes, Fearless 4 applies.",
  },
  {
    key: "fearless_5",
    book: "50L",
    type: "fearless_law",
    number: 5,
    title: "Know when to be bad — aggression",
    summary: "Calibrated edge prevents being walked on.",
    fullText:
      "Pure niceness invites exploitation. The fearless cultivate calibrated edge — knowing when to push, when to refuse, when to make the hard call. Aggression isn't being a jerk; it's not being a doormat.",
    triggers: [
      "operator being walked on by a counterparty",
      "passivity being mistaken for agreement",
      "calibrated edge needed but absent from operator's repertoire",
    ],
    actions: [
      "Say no firmly the next time it's warranted",
      "Set the limit visibly and hold it",
      "Show the edge once so it's clear it exists",
      "Don't apologize for being clear",
    ],
    relatedKeys: ["law_15", "strategy_counterattack", "dark_drainer"],
    applicabilityPrompt:
      "Is the operator being walked on or having niceness exploited by a counterparty? If yes, Fearless 5 applies.",
  },
  {
    key: "fearless_6",
    book: "50L",
    type: "fearless_law",
    number: 6,
    title: "Lead from the front — authority",
    summary: "Earn followership by doing first.",
    fullText:
      "You cannot lead by demanding. You lead by being the first to act in service of the mission. The fearless do the work they ask others to do, take the risk they ask others to take, and earn the right to direct.",
    triggers: [
      "operator giving instructions they haven't modeled",
      "team waiting to see commitment before committing themselves",
      "credibility gap between operator's asks and operator's actions",
    ],
    actions: [
      "Do the work first; ask second",
      "Take the visible risk before delegating",
      "Lead with action, not directive",
      "Close the credibility gap with one visible move",
    ],
    relatedKeys: ["law_9", "law_28", "strategy_command"],
    applicabilityPrompt:
      "Is the operator asking others to do what they haven't visibly done themselves? If yes, Fearless 6 applies.",
  },
  {
    key: "fearless_7",
    book: "50L",
    type: "fearless_law",
    number: 7,
    title: "Know your environment from the inside out — connection",
    summary: "Be close to the ground; surface signals shape the map.",
    fullText:
      "The fearless are connected to the ground their work touches. They know their customers, audience, neighborhood, scene. Distance from the environment is distance from the signals that matter.",
    triggers: [
      "operator scaling out of touch with the actual context their work serves",
      "decisions being made from second-hand reports",
      "ground-level signal not reaching the decision room",
    ],
    actions: [
      "Spend time in the environment your work touches every week",
      "Talk directly to the people you serve",
      "Audit what you've stopped seeing",
      "Bring ground-level signal into the decision room",
    ],
    relatedKeys: ["strategy_intelligence", "law_14", "mastery_apprenticeship"],
    applicabilityPrompt:
      "Is the operator scaling out of touch with the ground their work actually touches? If yes, Fearless 7 applies.",
  },
  {
    key: "fearless_8",
    book: "50L",
    type: "fearless_law",
    number: 8,
    title: "Respect the process — mastery",
    summary: "There is no shortcut to depth.",
    fullText:
      "Surface-level skill peaks fast and plateaus quickly. Deep mastery requires the unglamorous middle — thousands of hours of refinement. The fearless respect the process; they don't try to skip the apprentice phase.",
    triggers: [
      "operator chasing shortcuts in a skill that compounds with depth",
      "impatience with the unglamorous middle phase",
      "comparison to people further along inducing the wrong move",
    ],
    actions: [
      "Commit to the long arc of skill",
      "Trust the process where shortcuts have proven fragile",
      "Find a mentor for the middle phase, not just the start",
      "Measure progress in years, not weeks",
    ],
    relatedKeys: ["mastery_apprenticeship", "mastery_creative", "law_30"],
    applicabilityPrompt:
      "Is the operator chasing shortcuts where depth would compound? If yes, Fearless 8 applies.",
  },
  {
    key: "fearless_9",
    book: "50L",
    type: "fearless_law",
    number: 9,
    title: "Push beyond your limits — self-belief",
    summary: "Belief is a forward-loaded asset.",
    fullText:
      "If you don't believe the move is possible, you won't make it. The fearless invest in self-belief as a forward-loaded asset — they act as if the outcome is possible until the evidence catches up.",
    triggers: [
      "operator stalling on an ambitious move because of internal doubt",
      "self-talk that frames the goal as unrealistic",
      "evidence that others' similar moves succeeded",
    ],
    actions: [
      "Make the ambitious commitment publicly enough that backing off costs",
      "Anchor self-belief in concrete past wins",
      "Borrow conviction from people who've done it",
      "Act before you fully believe; the evidence catches up",
    ],
    relatedKeys: ["law_28", "law_34", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator stalling on an ambitious move because of internal doubt the evidence doesn't justify? If yes, Fearless 9 applies.",
  },
  {
    key: "fearless_10",
    book: "50L",
    type: "fearless_law",
    number: 10,
    title: "Confront your mortality — the sublime",
    summary: "Knowing time is finite makes today count.",
    fullText:
      "The fearless don't deny death; they use it as the anchor for what matters. Knowing time is finite makes the trivial visible as trivial. Use mortality to clarify priority.",
    triggers: [
      "operator stuck in trivial work because the long arc feels infinite",
      "priority drift away from what would matter at the end of life",
      "frame of 'someday' postponing what matters today",
    ],
    actions: [
      "Run the 5-year regret test on current priorities",
      "Cut the things that wouldn't matter at the end",
      "Make the things that would matter visible this week",
      "Use mortality as clarifying agent, not as panic trigger",
    ],
    relatedKeys: ["law_25", "law_29", "mastery_creative"],
    applicabilityPrompt:
      "Has the operator's priority drifted toward trivial work that wouldn't matter on the long arc? If yes, Fearless 10 applies.",
  },
];
