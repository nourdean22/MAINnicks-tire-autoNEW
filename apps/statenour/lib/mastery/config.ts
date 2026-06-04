// Default habits tracked daily
export const HABITS = [
  { key: "workout", label: "Workout", icon: "💪", category: "physical" },
  { key: "journal", label: "Journal / Daily Command", icon: "📝", category: "mental" },
  { key: "estimate_followup", label: "Estimate follow-up", icon: "📞", category: "business" },
  { key: "instagram_post", label: "Instagram post", icon: "📸", category: "marketing" },
  { key: "sleep_before_midnight", label: "Sleep before midnight", icon: "🌙", category: "mental" },
  { key: "morning_routine", label: "Morning routine", icon: "☀️", category: "discipline" },
  { key: "nasal_breathing", label: "Nasal breathing focus", icon: "🫁", category: "physical" },
  { key: "no_impulse_purchase", label: "No impulse purchase", icon: "💰", category: "financial" },
  { key: "prayer", label: "Prayer", icon: "🤲", category: "spiritual" },
  { key: "spanish_practice", label: "Spanish practice", icon: "🇪🇸", category: "skills" },
  { key: "water_intake", label: "Water (8+ glasses)", icon: "💧", category: "physical" },
  { key: "content_creation", label: "Content created", icon: "🎥", category: "marketing" },
] as const;

export type HabitKey = typeof HABITS[number]["key"];

// Mastery domains · the operator's character-sheet stats.
//
// 2026-05-30 · expanded 12 → 23 ("RuneScape tier") in a design session
// with the operator. Organized into 4 BRANCHES (body / mind / empire /
// influence) so the /scoreboard board renders like a skill tree. Maps to
// Nour's stated purpose:
//   · fullest self + greatness  → all of BODY + MIND
//   · helping people            → service · communication · relationships · leadership
//   · beyond my dreams          → the whole EMPIRE branch
//   · live unapologetically     → combat · courage · faith · sales
//
// IMPORTANT · `key` values are STABLE identifiers — MasteryScore.domain
// rows key off them, so a key is NEVER renamed, only its label/icon may
// change. That's why "marketing" now displays as "Communication &
// Storytelling" and "strategy" as "Strategic Vision": the keys stay so no
// lifetime XP is orphaned (no migration needed). baseline = placeholder
// self-rating (0-10) · tune to your honest starting point.
export const BRANCHES = [
  { key: "body", label: "Body", icon: "⚔️", blurb: "the vessel" },
  { key: "mind", label: "Mind", icon: "🧠", blurb: "the inner game" },
  { key: "empire", label: "Craft & Empire", icon: "🏛️", blurb: "the builder" },
  { key: "influence", label: "Influence & People", icon: "🗣️", blurb: "the outer game" },
] as const;

export type BranchKey = typeof BRANCHES[number]["key"];

export const DOMAINS = [
  // ── BODY · the vessel ─────────────────────────────────────────────
  { key: "physical", label: "Physical Vitality", color: "#F97316", baseline: 4.0, shortLabel: "Vitality", description: "Your baseline energy, health, and how alive your body feels.",icon: "🫀", branch: "body" },
  { key: "combat", label: "Combat", color: "#DC2626", baseline: 5.0, shortLabel: "Combat", description: "The skill and nerve to defend yourself and hold your ground.",icon: "🥊", branch: "body" },
  { key: "conditioning", label: "Strength & Conditioning", color: "#EA580C", baseline: 4.5, shortLabel: "Strength", description: "Raw power and stamina, and the work that builds them.",icon: "🏋️", branch: "body" },
  { key: "mobility", label: "Mobility & Flexibility", color: "#FB923C", baseline: 3.0, shortLabel: "Mobility", description: "Moving freely, full range of motion, without pain.",icon: "🤸", branch: "body" },
  // ── MIND · the inner game ─────────────────────────────────────────
  // 2026-05-30 · Mental Clarity MERGED into Focus (operator: kill the one
  // genuine dup). Key stays `mental` to preserve its lifetime XP history;
  // only the label/icon/color become Focus. The separate `focus` key (added
  // earlier today, ~no history) is removed below. Future "focus" signals
  // attribute here since the AI returns the key for label "Focus".
  { key: "mental", label: "Focus", color: "#38BDF8", baseline: 5.0, shortLabel: "Focus", description: "Holding attention on one thing without drifting or numbing out.",icon: "🎯", branch: "mind" },
  { key: "fortitude", label: "Mental Fortitude", color: "#0EA5E9", baseline: 4.5, shortLabel: "Fortitude", description: "Staying steady and functional under stress and pressure.",icon: "🛡️", branch: "mind" },
  { key: "emotional_intelligence", label: "Emotional Intelligence", color: "#14B8A6", baseline: 4.5, shortLabel: "Emotional IQ", description: "Reading emotions, yours and others', and responding well.",icon: "🫂", branch: "mind" },
  { key: "adaptability", label: "Adaptability", color: "#22D3EE", baseline: 4.5, shortLabel: "Adaptability", description: "Adjusting fast when the plan, conditions, or facts change.",icon: "🌊", branch: "mind" },
  { key: "courage", label: "Courage & Facing Fears", color: "#60A5FA", baseline: 5.0, shortLabel: "Courage", description: "Doing the thing you're afraid of anyway.",icon: "🦁", branch: "mind" },
  { key: "faith", label: "Faith & Purpose", color: "#2DD4BF", baseline: 5.5, shortLabel: "Faith", description: "Trusting something larger and knowing why you're doing this.",icon: "🕌", branch: "mind" },
  // 2026-05-30 · operator-added. These overlap existing Mind stats, so the
  // boundaries below keep the AI attributor from double-counting:
  //   · patience        = tolerance of delay + playing the long game
  //     (Mental Fortitude = pushing through pain / discomfort)
  //   · self_confidence = self-belief / self-worth
  //     (Courage & Facing Fears = acting *despite* fear)
  // baselines here are UNVERIFIED placeholder self-ratings — tune them.
  { key: "self_confidence", label: "Inner Self-Confidence", color: "#818CF8", baseline: 5.0, shortLabel: "Self-Confidence", description: "Quiet certainty in your own worth that doesn't need proving.",icon: "💎", branch: "mind" },
  { key: "patience", label: "Patience", color: "#5EEAD4", baseline: 4.0, shortLabel: "Patience", description: "Letting things take the time they need without forcing them.",icon: "⏳", branch: "mind" },
  // 2026-05-30 · "size of my balls, figuratively" → audacity: boldness of
  // moves / risk-appetite / nerve. Distinct from Courage (overcoming fear
  // of a specific thing) and Inner Self-Confidence (self-worth) — this is
  // how BIG you're willing to swing.
  { key: "audacity", label: "Audacity", color: "#4F46E5", baseline: 6.0, shortLabel: "Audacity", description: "Taking bold action despite fear; how big you're willing to swing.",icon: "🦍", branch: "mind" },
  // 2026-05-30 · phone-notes coverage pass. Boundaries vs neighbors:
  //   · wisdom     = accumulated judgment / life-philosophy / mental models
  //     (Faith = spirituality/meaning · Critical Thinking = live reasoning)
  //   · discipline = daily consistency / self-control / showing up
  //     (Fortitude = enduring pain · Follow-Through = closing old loops)
  { key: "wisdom", label: "Wisdom & Philosophy", color: "#0D9488", baseline: 5.0, shortLabel: "Wisdom", description: "Knowing what actually matters, and acting on it.",icon: "🦉", branch: "mind" },
  { key: "discipline", label: "Discipline", color: "#0891B2", baseline: 5.5, shortLabel: "Discipline", description: "Doing what needs doing regardless of how you feel.",icon: "🧱", branch: "mind" },
  // ── CRAFT & EMPIRE · the builder ──────────────────────────────────
  { key: "business_ops", label: "Business Operations", color: "#FDB913", baseline: 6.5, shortLabel: "Business Ops", description: "Running the day-to-day so the business actually works.",icon: "🏪", branch: "empire" },
  { key: "financial", label: "Financial Mastery", color: "#10B981", baseline: 4.0, shortLabel: "Finance", description: "Earning, keeping, and growing money on purpose.",icon: "📊", branch: "empire" },
  { key: "technical", label: "Technical Craft", color: "#3B82F6", baseline: 7.5, shortLabel: "Technical", description: "Building and fixing the tools and systems you rely on.",icon: "💻", branch: "empire" },
  { key: "strategy", label: "Strategic Vision", color: "#6366F1", baseline: 6.0, shortLabel: "Strategy", description: "Seeing several moves ahead toward a clear goal.",icon: "♟️", branch: "empire" },
  { key: "delegation", label: "Delegation & Leverage", color: "#84CC16", baseline: 6.0, shortLabel: "Delegation", description: "Getting more done through other people and systems.",icon: "🧰", branch: "empire" },
  { key: "follow_through", label: "Follow-Through", color: "#EAB308", baseline: 3.0, shortLabel: "Follow-Through", description: "Finishing what you start, all the way to done.",icon: "🏁", branch: "empire" },
  // 2026-05-30 · phone-notes coverage. Critical Thinking is the STAT you
  // level; the critical-thinking LENSES (five-whys · inversion · second-
  // order) are how Nick reasons it — that's the stat↔lens synergy. Learning
  // = the meta-skill: speed of acquiring new skills (vs Wisdom = applied
  // judgment · Technical Craft = an already-built skill).
  { key: "critical_thinking", label: "Critical Thinking", color: "#4338CA", baseline: 6.0, shortLabel: "Critical Thinking", description: "Cutting through noise to what's actually true.",icon: "🧩", branch: "empire" },
  { key: "learning", label: "Learning", color: "#22C55E", baseline: 6.0, shortLabel: "Learning", description: "Picking up new skills and knowledge fast, and keeping them.",icon: "📚", branch: "empire" },
  // ── INFLUENCE & PEOPLE · the outer game ───────────────────────────
  { key: "sales", label: "Sales", color: "#EF4444", baseline: 3.0, shortLabel: "Sales", description: "Turning conversations into closed deals.",icon: "💼", branch: "influence" },
  { key: "persuasion", label: "Persuasion & Influence", color: "#A855F7", baseline: 3.5, shortLabel: "Persuasion", description: "Moving people to your point of view.",icon: "🗣️", branch: "influence" },
  { key: "marketing", label: "Communication & Storytelling", color: "#8B5CF6", baseline: 4.5, shortLabel: "Communication", description: "Making people feel something and remember it.",icon: "🎤", branch: "influence" },
  { key: "leadership", label: "Leadership & People", color: "#EC4899", baseline: 4.0, shortLabel: "Leadership", description: "Getting people to follow you toward something worth doing.",icon: "👥", branch: "influence" },
  { key: "relationships", label: "Relationships & Family", color: "#F59E0B", baseline: 5.0, shortLabel: "Relationships", description: "Building bonds that actually last.",icon: "❤️", branch: "influence" },
  { key: "service", label: "Service & Impact", color: "#D946EF", baseline: 4.0, shortLabel: "Service", description: "Making a real difference in other people's lives.",icon: "👐", branch: "influence" },
  { key: "languages", label: "Languages", color: "#C026D3", baseline: 2.5, shortLabel: "Languages", description: "Speaking and understanding beyond your native tongue.",icon: "🌎", branch: "influence" },
  // 2026-05-30 · operator-added. Boundaries vs neighbors (no double-count):
  // advertising = PAID promotion / ad creative / reach-buying (Communication
  // & Storytelling stays = organic voice / content) · seduction = charm /
  // allure / magnetism, Greene-style (Persuasion = framing to win a point ·
  // Sales = closing the deal).
  { key: "advertising", label: "Advertising", color: "#F472B6", baseline: 4.0, shortLabel: "Advertising", description: "Getting the right message in front of the right people.",icon: "📣", branch: "influence" },
  { key: "seduction", label: "Seduction", color: "#E11D48", baseline: 4.5, shortLabel: "Seduction", description: "Charm, allure, and presence as a trainable skill.",icon: "🌹", branch: "influence" },
  // 2026-05-30 · "would help greatly" add. Networking & Alliances = building
  // your strategic connections / power network (Greene) — distinct from
  // Relationships & Family (personal) · Leadership (leading) · Seduction (1:1).
  { key: "networking", label: "Networking & Alliances", color: "#9333EA", baseline: 4.5, shortLabel: "Networking", description: "Building a web of relationships that open doors.",icon: "🤝", branch: "influence" },
] as const;

export type DomainKey = typeof DOMAINS[number]["key"];
export type Domain = typeof DOMAINS[number];

// Drift detection rule definitions
export interface DriftRule {
  id: string;
  name: string;
  severity: "warning" | "alert" | "critical";
  message: string;
  check: (ctx: DriftContext) => boolean;
}

export interface DriftContext {
  recentScores: Array<{ date: string; workout_done: number; journal_done: number; focus_quality: number; sleep_time: string; adderall_taken: number; overall_score: number }>;
  recentHabits: Array<{ date: string; habit_key: string; completed: number }>;
  lastScore: { date: string } | null;
  openLoopsCreatedLast7d: number;
  weightLast30d: Array<{ date: string; weight: number }>;
}

// Apr 18 sweep — 5 drift rules that depended on DailyScore retired
// alongside the score logging UI (/m, /api/daily-score, /api/quick-score,
// /score telegram command). Each was checking `ctx.recentScores` for
// data that isn't being logged anymore, so they either fired zero times
// (score data empty) or nagged about a concept Nour has moved past:
//   - no_workout_5d          (workout_done)
//   - no_journal_3d          (journal_done)
//   - sleep_after_midnight_3d (sleep_time)
//   - score_declining_5d     (overall_score)
//   - adderall_no_focus_3d   (adderall_taken + focus_quality)
// Habit-based rules (habit_below_60_3d, no_followup_2d, no_instagram_7d,
// impulse_purchase_3d) still work via MasteryHabit — they don't need
// DailyScore. They stay.

export const DRIFT_RULES: DriftRule[] = [
  {
    id: "habit_below_60_3d",
    name: "Habits below 60%",
    severity: "alert",
    message: "Habit completion below 60% for 3 consecutive days. Reduce to 5 core habits only.",
    check: (ctx) => {
      const dates = [...new Set(ctx.recentHabits.map((h) => h.date))].sort().reverse().slice(0, 3);
      if (dates.length < 3) return false;
      return dates.every((date) => {
        const dayHabits = ctx.recentHabits.filter((h) => h.date === date);
        if (dayHabits.length === 0) return true;
        const rate = dayHabits.filter((h) => h.completed).length / dayHabits.length;
        return rate < 0.6;
      });
    },
  },
  {
    id: "no_followup_2d",
    name: "No follow-ups 2 days",
    severity: "warning",
    message: "No estimate follow-ups for 2 days. Call the 3 oldest estimates NOW. Money on the table.",
    check: (ctx) => {
      const last2 = ctx.recentHabits.filter((h) => h.habit_key === "estimate_followup").slice(0, 2);
      return last2.length >= 2 && last2.every((h) => !h.completed);
    },
  },
  {
    id: "no_instagram_7d",
    name: "No Instagram 7 days",
    severity: "warning",
    message: "No Instagram post for 7+ days. Marketing is dark. Post ONE car photo TODAY.",
    check: (ctx) => {
      const last7 = ctx.recentHabits.filter((h) => h.habit_key === "instagram_post").slice(0, 7);
      return last7.length >= 7 && last7.every((h) => !h.completed);
    },
  },
  // score_declining_5d · no_score_2d retired Apr 18 (see header note)
  {
    id: "weight_plateau_30d",
    name: "Weight plateau 30 days",
    severity: "warning",
    message: "Weight unchanged for 30+ days. Audit food intake, training intensity, and sleep quality.",
    check: (ctx) => {
      if (ctx.weightLast30d.length < 2) return false;
      const first = ctx.weightLast30d[ctx.weightLast30d.length - 1].weight;
      const last = ctx.weightLast30d[0].weight;
      return Math.abs(first - last) < 1;
    },
  },
  {
    id: "new_projects_3_in_7d",
    name: "Novelty-seeking detected",
    severity: "alert",
    message: "3+ new open loops in 7 days. NOVELTY-SEEKING pattern detected. Finish something FIRST.",
    check: (ctx) => ctx.openLoopsCreatedLast7d >= 3,
  },
  {
    id: "impulse_purchase_3d",
    name: "Impulse buying 3 days",
    severity: "alert",
    message: "Impulse purchases 3 days in a row. Enforce 48-hour rule on anything over $50.",
    check: (ctx) => {
      const last3 = ctx.recentHabits.filter((h) => h.habit_key === "no_impulse_purchase").slice(0, 3);
      return last3.length >= 3 && last3.every((h) => !h.completed);
    },
  },
  // adderall_no_focus_3d retired Apr 18 (see header note)
];
