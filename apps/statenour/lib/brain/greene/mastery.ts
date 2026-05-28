/**
 * 2026-05-28 · Power Atlas · Mastery · mentorship roles + 3 phases.
 *
 * Robert Greene's framework for the development arc of skill: the
 * apprenticeship phase, the creative-active phase, the mastery phase ·
 * plus the 5 mentorship roles that shape the operator's relational
 * field around skill-building.
 *
 * Source: Robert Greene, "Mastery" (2012).
 */

import type { GreeneEntry } from "./schema";

export const MASTERY_ENTRIES: GreeneEntry[] = [
  // ── Phases ──────────────────────────────────────────────────────
  {
    key: "mastery_apprenticeship",
    book: "Mastery",
    type: "phase",
    number: 1,
    title: "Apprenticeship Phase",
    summary: "Deep submission to the field's existing knowledge.",
    fullText:
      "The apprenticeship phase is about absorbing the existing knowledge of the field — observing, practicing, deferring to those further along. Premature self-expression in this phase produces shallow work. The goal is submission to the discipline until it becomes second nature.",
    triggers: [
      "operator new to a domain or chapter",
      "fundamentals not yet automatic",
      "urge to be original outpacing absorbed depth",
    ],
    actions: [
      "Find a master worth observing and imitate the practice",
      "Defer your own taste until the fundamentals are reflexive",
      "Log 10,000 reps before deciding what's outdated",
      "Resist the urge to teach what you haven't yet mastered",
    ],
    relatedKeys: ["mentor_true", "mentor_apprentice", "fearless_8"],
    applicabilityPrompt:
      "Is the operator early in a domain where submission to the discipline is the first task? If yes, Mastery Phase 1 applies.",
  },
  {
    key: "mastery_creative",
    book: "Mastery",
    type: "phase",
    number: 2,
    title: "Creative-Active Phase",
    summary: "Originality begins after deep absorption.",
    fullText:
      "Once the field's existing knowledge is internalized, the creative-active phase begins: combining, experimenting, breaking patterns the discipline didn't see. This is where original contribution happens — built on the foundation of absorbed mastery, not in place of it.",
    triggers: [
      "operator has reached fluency in a domain",
      "field's patterns now feel reflexive",
      "original questions surfacing that the discipline hasn't answered",
    ],
    actions: [
      "Combine domains in ways the field hasn't tried",
      "Break the rules you mastered, deliberately",
      "Publish your own POV with full commitment",
      "Build the unique work only you could build",
    ],
    relatedKeys: ["law_25", "law_48", "fearless_9"],
    applicabilityPrompt:
      "Has the operator reached fluency where original work is now the right move? If yes, Mastery Phase 2 applies.",
  },
  {
    key: "mastery_invisible",
    book: "Mastery",
    type: "phase",
    number: 3,
    title: "Mastery Phase",
    summary: "Effortless intuition built on decades of depth.",
    fullText:
      "True mastery is intuition built on depth — the apparent effortlessness of choices that flow from absorbed knowledge. The master sees patterns invisible to others; their work has a signature that no shortcut produces. This phase is not a destination but a stance.",
    triggers: [
      "operator has 10+ years of compounded depth in a domain",
      "intuition outpacing conscious reasoning",
      "signature work emerging that others recognize",
    ],
    actions: [
      "Trust the intuition that's been earned",
      "Synthesize across decades rather than chase the next trick",
      "Teach what only depth can teach",
      "Keep refining; mastery is not a static state",
    ],
    relatedKeys: ["mentor_true", "law_30", "mastery_creative"],
    applicabilityPrompt:
      "Has the operator reached depth in a domain where intuition leads conscious reasoning? If yes, Mastery Phase 3 applies.",
  },
  // ── Mentorship roles (already in v1; rewritten with new schema) ──
  {
    key: "mentor_true",
    book: "Mastery",
    type: "mentorship_role",
    title: "True Mentor",
    summary: "Compresses years of expertise into actionable lift.",
    fullText:
      "A true mentor compresses years of expertise into hours of guidance. The student's trajectory observably accelerates. The exchange involves real time, real risk, and real attention; advice is specific to your context, not generic.",
    triggers: [
      "operator's trajectory measurably accelerated by this person",
      "3+ validated leveraged moves attributable to their guidance in 90d",
      "person's expertise is 5-10 years ahead in operator's domain",
    ],
    actions: [
      "Protect the relationship as a top-tier asset",
      "Show up prepared to every session",
      "Reciprocate however asymmetrically appropriate (effort, attention, future help)",
      "Apply their advice; report back on outcomes",
    ],
    relatedKeys: ["mastery_apprenticeship", "law_11", "law_43"],
    applicabilityPrompt:
      "Has time spent with this person produced 3+ validated leveraged moves in the last 90 days? If yes, tag mentor_true.",
  },
  {
    key: "mentor_peer",
    book: "Mastery",
    type: "mentorship_role",
    title: "Peer Mentor",
    summary: "Lateral exchange of expertise + accountability.",
    fullText:
      "Peer mentors are at similar levels but specialize in non-overlapping domains. The exchange is two-way: each side teaches the other something the other can't easily acquire alone. Accountability flows in both directions.",
    triggers: [
      "person at operator's career level",
      "complementary expertise in non-overlapping domains",
      "exchange is observably two-way",
    ],
    actions: [
      "Schedule regular two-way exchanges (monthly or biweekly)",
      "Trade specific skills + frame each session for output",
      "Hold each other accountable to commitments",
      "Don't let it drift into pure socializing",
    ],
    relatedKeys: ["strategy_alliance", "law_13", "law_18"],
    applicabilityPrompt:
      "Is this person at operator's career level with complementary expertise, and is the exchange two-way? If yes, tag mentor_peer.",
  },
  {
    key: "mentor_anti",
    book: "Mastery",
    type: "mentorship_role",
    title: "Anti-mentor",
    summary: "Looks like a mentor but extracts more than gives.",
    fullText:
      "Anti-mentors hold the status of wise advisors but consume time without delivering proportionate value. Their advice tends toward generic, self-serving, or contradictory. The relationship feels mentorship-shaped but the trajectory doesn't move.",
    triggers: [
      "time spent with this person exceeds 5 hours/month",
      "<1 actionable leveraged move attributable to their guidance in 90d",
      "advice tends generic or self-referential",
    ],
    actions: [
      "Cut session frequency in half as a test",
      "Re-evaluate after 60d — if no shift, formalize distance",
      "Don't burn the relationship; just reduce footprint",
      "Replace the slot with a true mentor or peer",
    ],
    relatedKeys: ["law_10", "dark_drainer", "strategy_withdraw"],
    applicabilityPrompt:
      "Has time spent with this person exceeded 5 hours/month with <1 actionable leveraged move? If yes, tag mentor_anti.",
  },
  {
    key: "mentor_apprentice",
    book: "Mastery",
    type: "mentorship_role",
    title: "Apprentice",
    summary: "Operator is the source; investment compounds over years.",
    fullText:
      "Apprentices receive from the operator. Their development is a long-arc investment that pays back through alliance, reputation, and future collaboration. The right apprentice multiplies the operator's reach.",
    triggers: [
      "person reliably implements operator's advice + reports back",
      "their trajectory measurably accelerating from operator's input",
      "long-arc potential evident in their commitment",
    ],
    actions: [
      "Invest deeper in the few apprentices who show up fully",
      "Set clear expectations around feedback + reciprocity",
      "Don't teach in vain to people who don't apply",
      "Treat the apprentice relationship as a long-arc asset",
    ],
    relatedKeys: ["law_7", "law_11", "strategy_alliance"],
    applicabilityPrompt:
      "Does this person reliably implement operator's advice + return with progress? If yes, tag mentor_apprentice.",
  },
  {
    key: "mentor_none",
    book: "Mastery",
    type: "mentorship_role",
    title: "None",
    summary: "No mentorship dynamic; pure peer or non-domain relationship.",
    fullText:
      "Pure peer / non-domain relationship without mentor or apprentice angle. The relationship is valid on its own terms; just not a mastery-building one.",
    triggers: [
      "no clear mentor or apprentice pattern in either direction",
      "relationship sits in social or operational category instead",
      "skill-building isn't the throughline",
    ],
    actions: [
      "Don't force a mentorship frame that isn't there",
      "Evaluate the relationship on its actual basis",
      "Leave skill-building investment to mentor-tagged people",
    ],
    relatedKeys: [],
    applicabilityPrompt: "Default tag when no other mentorship pattern applies.",
  },
];
