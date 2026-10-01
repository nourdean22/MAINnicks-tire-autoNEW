import { redirect } from "next/navigation";

/**
 * /goals · 2026-05-30 · CONSOLIDATED into /stats.
 *
 * The goals surface (LifeGoal ladder + missions + the interactive
 * GoalBoard) merged into /stats, directly under the character sheet —
 * "where you're climbing toward." This route redirects so old links,
 * bookmarks, and the components that reference /goals keep working.
 *
 * Note: the GoalBoard (the interactive goal surface) is folded into
 * /stats; the goals Hero / stats-band / 3D polyhedron deep-dive are a
 * fast-follow enrichment on /stats (tracked).
 */
export default function GoalsRedirect() {
  // Land on the Goals section of /stats (id="goals") rather than the top
  // of the character sheet, so a "Goals" mental model arrives at goals.
  redirect("/stats?tab=goals");
}
