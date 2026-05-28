/**
 * 2026-05-28 · Power Atlas · The Laws of Human Nature · 13 dark traits +
 * principle laws drawn from the book's 18 chapters.
 *
 * Greene's psychology atlas. Dark traits are personality patterns to
 * detect in others; principles are operator-side practices grounded in
 * what the book reveals about human nature.
 *
 * Source: Robert Greene, "The Laws of Human Nature" (2018).
 */

import type { GreeneEntry } from "./schema";

export const HUMAN_NATURE_ENTRIES: GreeneEntry[] = [
  // ── 13 Dark Traits (extended from 2026-05-27's 12) ─────────────
  {
    key: "dark_narcissist",
    book: "HN",
    type: "dark_trait",
    chapter: "Chapter 2 · Narcissism",
    title: "Narcissist (Deep)",
    summary: "Cannot tolerate criticism + drains others' attention.",
    fullText:
      "Deep narcissists need constant attention and cannot tolerate criticism. They drain energy from any interaction. Surface-level competence often masks the deep insecurity that drives the behavior.",
    triggers: [
      "person responds defensively + aggressively to mild critique 3+ times",
      "interactions disproportionately about them",
      "compliments and attention are the operating currency",
    ],
    actions: [
      "Lower investment; preserve energy",
      "Don't offer critique that won't be received",
      "Avoid being the audience for their endless self-narrative",
      "Formalize distance if they're high-cost to maintain",
    ],
    relatedKeys: ["law_10", "law_46", "dark_grandiose"],
    applicabilityPrompt:
      "Has this person responded defensively + aggressively to mild critique 3+ times? Tag dark_narcissist.",
  },
  {
    key: "dark_envious",
    book: "HN",
    type: "dark_trait",
    chapter: "Chapter 10 · Envy",
    title: "Envious",
    summary: "Resents operator's successes; subtly undermines.",
    fullText:
      "The envious type cannot bear to see others rise. They quietly undermine while professing support. The undermining is often subtle: faint praise, change of subject, deferred follow-up on your wins.",
    triggers: [
      "person responds coldly or critically to operator's recent wins",
      "support deferred or withheld around significant moments",
      "subtle digs after operator's announcements",
    ],
    actions: [
      "Stop sharing wins with them",
      "Don't seek their support; build alternative networks",
      "Match their cadence — formal, not intimate",
      "Recognize the pattern; don't internalize the critique",
    ],
    relatedKeys: ["law_2", "law_46", "dark_fault_finder"],
    applicabilityPrompt:
      "Has this person responded coldly or critically to operator's recent wins? Tag dark_envious.",
  },
  {
    key: "dark_grandiose",
    book: "HN",
    type: "dark_trait",
    chapter: "Chapter 11 · Grandiosity",
    title: "Grandiose",
    summary: "Self-image vastly exceeds actual contribution.",
    fullText:
      "Grandiose types live in a self-image far above reality. Their stories grow with each retelling. The gap between claim and contribution widens over time.",
    triggers: [
      "person's stated achievements drift inconsistent or inflated",
      "stories grow with each retelling",
      "verifiable contributions don't match the claims",
    ],
    actions: [
      "Don't bet on their delivery without independent verification",
      "Audit the claim against the evidence quietly",
      "Don't repeat their inflated claims as fact",
      "Calibrate your trust to demonstrated, not declared, capacity",
    ],
    relatedKeys: ["dark_narcissist", "law_30", "fearless_1"],
    applicabilityPrompt:
      "Do this person's stated achievements drift inconsistent or inflated over time? Tag dark_grandiose.",
  },
  {
    key: "dark_defensive",
    book: "HN",
    type: "dark_trait",
    title: "Defensive",
    summary: "Cannot accept feedback; every input becomes attack.",
    fullText:
      "Defensive types treat all input as attack. They cannot accept feedback or differing perspectives. Collaboration with them requires constant deference; the cost compounds.",
    triggers: [
      "person interprets neutral input as personal attack 3+ times",
      "feedback consistently produces escalation",
      "operator self-censors around them to avoid friction",
    ],
    actions: [
      "Stop offering feedback that won't be received",
      "Constrain collaboration to areas not requiring iteration",
      "Don't normalize the self-censorship around them",
      "Evaluate whether the relationship still serves",
    ],
    relatedKeys: ["dark_narcissist", "law_38", "dark_passive_aggressive"],
    applicabilityPrompt:
      "Has this person interpreted neutral input as personal attack 3+ times? Tag dark_defensive.",
  },
  {
    key: "dark_manipulator",
    book: "HN",
    type: "dark_trait",
    title: "Manipulator",
    summary: "Uses guilt, obligation, false intimacy as levers.",
    fullText:
      "Manipulators read what you need and use it as a control lever. Guilt and obligation are their favorite tools. They cultivate intimacy to position the levers, then deploy them when needed.",
    triggers: [
      "person uses guilt or obligation 2+ times to extract effort",
      "intimacy seems calibrated to position leverage",
      "operator finds self acting against own judgment after their pressure",
    ],
    actions: [
      "Refuse to act from guilt or obligation",
      "Make decisions cold, away from their influence",
      "Reduce intimacy proportional to the manipulation pattern",
      "Don't engage with their crisis frames",
    ],
    relatedKeys: ["law_10", "victim_rescuer", "fearless_5"],
    applicabilityPrompt:
      "Has this person used guilt or obligation 2+ times to extract effort? Tag dark_manipulator.",
  },
  {
    key: "dark_passive_aggressive",
    book: "HN",
    type: "dark_trait",
    title: "Passive-aggressive",
    summary: "Hostility expressed indirectly through forgetting, delay, hint.",
    fullText:
      "Hostility is never expressed openly. Always through forgetting, lateness, subtle digs, plausibly-deniable jabs. The pattern protects them from accountability while expressing the underlying anger.",
    triggers: [
      "person expresses dissatisfaction through delay + forgetting rather than direct conversation",
      "lateness or forgotten commitments cluster around specific contexts",
      "explicit confrontation followed by 'I didn't mean it that way'",
    ],
    actions: [
      "Name the pattern explicitly to them once, calmly",
      "Document the pattern for yourself",
      "Reduce the dependencies that the pattern can exploit",
      "Don't accept 'I forgot' as an explanation for repeated misses",
    ],
    relatedKeys: ["dark_defensive", "strategy_passive_aggression", "law_44"],
    applicabilityPrompt:
      "Does this person express dissatisfaction through delay + forgetting rather than direct conversation? Tag dark_passive_aggressive.",
  },
  {
    key: "dark_drainer",
    book: "HN",
    type: "dark_trait",
    title: "Drainer",
    summary: "Every interaction leaves operator with less energy than before.",
    fullText:
      "Drainers monopolize emotional space without reciprocation. Time with them feels heavier than it should. The drain compounds across weeks and months even from small doses.",
    triggers: [
      "cross-ref of operator's daily score on days this person was chat-mentioned shows 0.5+ drop avg",
      "fatigue noticeably elevated after interactions",
      "no proportional energy returned in either direction",
    ],
    actions: [
      "Cut cadence in half for 30 days",
      "Replace the slot with an energy-positive person",
      "Set strict time boundaries on any contact",
      "Formalize distance if pattern persists",
    ],
    relatedKeys: ["law_10", "dark_chronic_victim", "strategy_withdraw"],
    applicabilityPrompt:
      "Has cross-ref of operator's daily score on days this person was chat-mentioned shown 0.5+ drop avg? Tag dark_drainer.",
  },
  {
    key: "dark_saint",
    book: "HN",
    type: "dark_trait",
    chapter: "Chapter 13 · Self-righteousness",
    title: "False Saint",
    summary: "Performs virtue + uses moral high ground as weapon.",
    fullText:
      "The false saint performs virtue. They use moral high ground to control others and win arguments by reframing disagreement as failing. The performance hides the same self-interest everyone else has.",
    triggers: [
      "person frames disagreements as moral failings rather than differences",
      "moral high ground deployed as conversation-ender",
      "their stated virtue exceeds their demonstrated practice",
    ],
    actions: [
      "Don't accept the moral frame they offer",
      "Engage on substance, not their virtue claim",
      "Notice the gap between stated virtue and practice",
      "Refuse to perform contrition you don't feel",
    ],
    relatedKeys: ["dark_grandiose", "strategy_disinformation", "law_38"],
    applicabilityPrompt:
      "Does this person frame disagreements as moral failings rather than differences? Tag dark_saint.",
  },
  {
    key: "dark_status_obsessed",
    book: "HN",
    type: "dark_trait",
    chapter: "Chapter 14 · Status",
    title: "Status-obsessed",
    summary: "All decisions filtered through status optics.",
    fullText:
      "Every choice they make is filtered through 'how does this look.' Authenticity is suppressed. Their stated preferences shift to match the highest-status person in the room.",
    triggers: [
      "person's stated preferences shift to match highest-status person in the room",
      "decisions consistently optimized for visible status",
      "behavior changes by audience",
    ],
    actions: [
      "Don't take their preferences as fixed signal",
      "Engage privately for less performative input",
      "Calibrate trust to revealed-preference patterns",
      "Don't compete with them on status terrain",
    ],
    relatedKeys: ["law_46", "law_38", "dark_envious"],
    applicabilityPrompt:
      "Do this person's stated preferences shift to match the highest-status person in the room? Tag dark_status_obsessed.",
  },
  {
    key: "dark_fault_finder",
    book: "HN",
    type: "dark_trait",
    title: "Fault-finder",
    summary: "Sees flaws first; rarely volunteers praise.",
    fullText:
      "The fault-finder leads with criticism. Their first instinct on hearing news is to spot the problem. Whether or not the critique is accurate, the disposition shapes every interaction.",
    triggers: [
      "first responses to operator's news critical 60%+ of the time",
      "praise consistently absent or perfunctory",
      "critique unsolicited and frequent",
    ],
    actions: [
      "Stop seeking their take on new work",
      "Filter their critique for the genuinely useful 10%",
      "Don't let their disposition shape your assessment of your work",
      "Cultivate evaluative input from balanced sources",
    ],
    relatedKeys: ["dark_envious", "dark_narcissist", "law_36"],
    applicabilityPrompt:
      "Are this person's first responses to operator's news critical 60%+ of the time? Tag dark_fault_finder.",
  },
  {
    key: "dark_drama",
    book: "HN",
    type: "dark_trait",
    title: "Drama-seeking",
    summary: "Generates and feeds crisis to maintain centrality.",
    fullText:
      "Drama-seekers manufacture crisis when the world is calm. The crisis keeps them at center stage. The pattern is reliable enough that they will create one when nothing real is happening.",
    triggers: [
      "person initiates crises out of calm periods 3+ times",
      "their centrality scales with the surrounding drama",
      "operator pulled into crises that resolve when ignored",
    ],
    actions: [
      "Don't engage with manufactured crises",
      "Let their drama burn out without you in it",
      "Reduce visibility into their dramas",
      "Distinguish real emergencies from theater",
    ],
    relatedKeys: ["law_10", "law_36", "dark_chronic_victim"],
    applicabilityPrompt:
      "Does this person initiate crises out of calm periods 3+ times? Tag dark_drama.",
  },
  {
    key: "dark_chronic_victim",
    book: "HN",
    type: "dark_trait",
    title: "Chronic Victim",
    summary: "Every story positions them as wronged; never the actor.",
    fullText:
      "The chronic victim narrates a life of being wronged. They are never the actor, always the recipient of others' wrongs. The frame is self-reinforcing — they organize their attention around grievance.",
    triggers: [
      "their stories about themselves 80%+ where they are wronged or harmed by external forces",
      "no accountability for their own role in repeated patterns",
      "grievance is the throughline across years",
    ],
    actions: [
      "Don't take on responsibility for fixing their grievance loop",
      "Reduce time spent in their narrative",
      "Refuse to be cast as either rescuer or villain in their story",
      "Cut cadence; let the grievance burn without your audience",
    ],
    relatedKeys: ["law_10", "dark_drainer", "victim_rescuer"],
    applicabilityPrompt:
      "Are this person's stories about themselves 80%+ where they are wronged or harmed by external forces? Tag dark_chronic_victim.",
  },
  {
    key: "dark_short_sighted",
    book: "HN",
    type: "dark_trait",
    chapter: "Chapter 6 · Short-sightedness",
    title: "Short-sighted",
    summary: "Maximizes the next 10 minutes; pays compounding interest later.",
    fullText:
      "The short-sighted type optimizes the immediate moment without weighing 6-month consequences. Each small win sets up a larger loss they don't see coming.",
    triggers: [
      "person's pattern of immediate-gratification choices compounding into visible long-arc damage",
      "their advice optimizes for the next move, never the chain",
      "operator absorbing the cost of their compounded short-sightedness",
    ],
    actions: [
      "Don't take long-arc advice from short-sighted people",
      "Constrain their decisions in shared work to short-arc questions",
      "Build buffers against their compounding misses",
      "Audit your own short-sightedness when this trait shows up",
    ],
    relatedKeys: ["law_29", "law_47", "fearless_8"],
    applicabilityPrompt:
      "Is this person consistently optimizing the immediate moment at the expense of compounded long-arc outcomes? Tag dark_short_sighted.",
  },
  // ── Principles drawn from chapters ─────────────────────────────
  {
    key: "principle_irrationality_law",
    book: "HN",
    type: "principle",
    chapter: "Chapter 1 · Irrationality",
    title: "Master your emotional self",
    summary: "Emotions hijack judgment unless they're observed.",
    fullText:
      "The default human mode is reactive emotion that imagines itself as rational. The first move toward judgment is observing the emotional state in real time. Without that, your strategy is colored by feelings you didn't notice.",
    triggers: [
      "operator about to make a decision while emotionally activated",
      "anger, fear, or desire driving the next move",
      "internal narrative is over-explaining a feeling",
    ],
    actions: [
      "Name the emotion you're feeling before deciding",
      "Postpone irreversible decisions by 24 hours when activated",
      "Audit which choices recently were emotion-driven and review the outcomes",
      "Build observation into the daily routine",
    ],
    relatedKeys: ["strategy_present_mind", "fearless_1", "law_35"],
    applicabilityPrompt:
      "Is the operator about to make a decision while emotionally activated? If yes, Principle of Irrationality applies.",
  },
  {
    key: "principle_role_playing",
    book: "HN",
    type: "principle",
    chapter: "Chapter 3 · Role-playing",
    title: "See through people's masks",
    summary: "Stated identity often differs from operating identity.",
    fullText:
      "Everyone presents a chosen identity in public. The operating identity — what they actually do under pressure — usually differs. The skill is reading both layers and trusting the operating one.",
    triggers: [
      "person's stated values and revealed behavior diverging",
      "operator surprised by their behavior under pressure",
      "stated identity doesn't predict their pattern",
    ],
    actions: [
      "Watch behavior under pressure; that's the operating identity",
      "Don't make decisions based on stated values alone",
      "Cross-check stated and revealed identity for major decisions",
      "Update your model when revealed identity diverges from stated",
    ],
    relatedKeys: ["strategy_intelligence", "law_14", "fearless_1"],
    applicabilityPrompt:
      "Is the operator working with stated identity rather than operating identity for a person whose patterns are starting to diverge? If yes, Principle of Role-playing applies.",
  },
  {
    key: "principle_repressed_self",
    book: "HN",
    type: "principle",
    chapter: "Chapter 9 · The Shadow",
    title: "Confront your dark side",
    summary: "Suppressed traits leak out as projection or compulsion.",
    fullText:
      "Traits we suppress become projection onto others or compulsion in ourselves. Integration — recognizing the shadow trait, owning it consciously — defuses the leak.",
    triggers: [
      "operator over-reacting to a trait in someone else",
      "compulsive behavior pattern around a suppressed desire",
      "consistent projection of a single quality onto multiple people",
    ],
    actions: [
      "Identify what you're projecting; own it consciously",
      "Integrate the shadow trait into a chosen expression",
      "Reduce the compulsive leak by giving the trait a chosen outlet",
      "Don't moralize against the trait until you've owned it",
    ],
    relatedKeys: ["fearless_1", "victim_reformed_rake", "law_46"],
    applicabilityPrompt:
      "Is the operator showing strong projection or compulsion around a single quality? If yes, Principle of the Shadow applies.",
  },
  {
    key: "principle_grandiosity_law",
    book: "HN",
    type: "principle",
    chapter: "Chapter 12 · Gender Rigidity",
    title: "Reconnect to the masculine/feminine within you",
    summary: "Rigid gender-coding starves the underdeveloped half.",
    fullText:
      "Over-identification with one gender mode (assertive vs receptive, active vs reflective) leaves the other underdeveloped. Reconnecting to the suppressed mode produces a fuller, more adaptive self.",
    triggers: [
      "operator's behavior locked into rigid gender-coded patterns",
      "stress responses dominated by one mode",
      "underdeveloped opposite-mode capacity",
    ],
    actions: [
      "Practice the suppressed mode in low-stakes contexts",
      "Look for role models who integrate both",
      "Notice where rigidity costs adaptability",
      "Don't perform the integration; live it",
    ],
    relatedKeys: ["law_25", "law_48", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator's behavior locked into rigid gender-coded patterns that limit adaptability? If yes, Principle of Gender Rigidity applies.",
  },
  {
    key: "principle_aimlessness",
    book: "HN",
    type: "principle",
    chapter: "Chapter 13 · Purpose",
    title: "Advance with a sense of purpose",
    summary: "Coherent direction makes daily choices automatic.",
    fullText:
      "Without a coherent direction, daily choices fragment into noise. With one, the question of what to do next becomes mostly automatic — the next move is the move that advances the direction.",
    triggers: [
      "operator drifting across many directions without unifying purpose",
      "weekly priorities feel arbitrary",
      "daily choices not connected to a long-arc goal",
    ],
    actions: [
      "Write a one-paragraph purpose statement for the next 18 months",
      "Test weekly priorities against it",
      "Cut what doesn't advance the direction",
      "Refresh the statement quarterly",
    ],
    relatedKeys: ["law_29", "fearless_10", "mastery_creative"],
    applicabilityPrompt:
      "Is the operator drifting without a coherent purpose statement to filter daily choices? If yes, Principle of Aimlessness applies.",
  },
  {
    key: "principle_group_pull",
    book: "HN",
    type: "principle",
    chapter: "Chapter 14 · Conformity",
    title: "Resist the downward pull of the group",
    summary: "Groups drag toward lowest common denominator unless you push against it.",
    fullText:
      "Groups generate gravitational pull toward the lowest common denominator — risk-averse, conformist, anti-elevation. The price of staying with the group is often invisible erosion of individual capacity.",
    triggers: [
      "operator surrounded by a peer group whose standards are below operator's potential",
      "behavior calibrating downward to fit",
      "ambition softening to match the group",
    ],
    actions: [
      "Find a peer group whose standards exceed yours",
      "Be the elevation force when you're the highest standard in the room",
      "Notice the pull; resist it deliberately",
      "Move when the room's gravity is wrong for you",
    ],
    relatedKeys: ["law_38", "fearless_9", "mentor_peer"],
    applicabilityPrompt:
      "Is the operator's peer group pulling standards downward? If yes, Principle of Conformity applies.",
  },
];
