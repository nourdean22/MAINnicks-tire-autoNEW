import type { StrategicFramework } from "../types";

/**
 * Team Composition Analysis — hiring + role design + when to fire.
 * Right person · right seat · right time. The wrong hire costs more
 * than no hire.
 */
export const teamComposition: StrategicFramework = {
  id: "team-composition",
  name: "Team Composition Analysis",
  oneLiner: "Right person · right seat · right time. The wrong hire costs more than no hire — for months.",
  triggers: [
    /\b(hire|hiring|hired|fire|firing|fired)\b/i,
    /\b(team\s+(size|structure|composition|build))\b/i,
    /\b(should\s+(i|we)\s+(hire|fire|let\s+\w+\s+go|replace))/i,
    /\b(technician|mechanic|employee|staff|crew|recruit(ment|ing|er)?)\b/i,
    /\b(payroll|headcount)\b/i,
    /\b(role\s+(design|definition)|job\s+(description|posting))\b/i,
    /\b(player[\s-]coach|individual\s+contributor|manager)\b/i,
  ],
  antiTriggers: [
    /\bjob\s+to\s+be\s+done\b/i, // overlap with JTBD framework
    // 'fire' idioms · grill / camp / weapon / alarm · NOT employment
    /\bfire\s+(up|away|alarm|truck|department|station|fighter|extinguisher|drill|hose|pit)\b/i,
    /\b(camp|bon|gun|cross|forest|wild|gas)fire\b/i,
    // 'hire' idioms · ride-share / car-rental · NOT employment
    /\bhire\s+(an?\s+)?(uber|lyft|cab|taxi|car|driver|limo|truck|van|babysitter)\b/i,
  ],
  weight: 1.0,
  lens: `Apply Team Composition Analysis. The decision isn't "do we need a
person" — it's "what's the smallest team that can deliver the
outcome reliably."

  1. WORK PROFILE FIRST · before hiring, write down the actual work.
     What's the day look like? What outcomes is this person
     accountable for? If you can't write it, the role isn't ready
     and the hire will struggle.

  2. RIGHT PERSON, RIGHT SEAT, RIGHT TIME · Jim Collins frame:
       · Right person · they share the values + standards
       · Right seat · the role plays to their strengths
       · Right time · the company is at the stage they thrive in
     Miss any one and the hire underperforms · no amount of
     coaching makes it work.

  3. COST OF A WRONG HIRE · 6-18 months of partial output, plus
     the team morale tax, plus the recovery hire. For most operator
     businesses · 2-3x the salary. Hire slow, fire fast.

  4. WHEN TO FIRE · two signs: (a) effort delta — they're not
     putting in what the role needs; (b) trust delta — you've stopped
     believing what they say. Either one means decide soon · waiting
     compounds the cost.

Recommend the action with the THRESHOLD · "if revenue hits X by Y,
hire" beats "we should probably hire someone soon."`,
};
