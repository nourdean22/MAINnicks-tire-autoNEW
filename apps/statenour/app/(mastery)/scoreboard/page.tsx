import { redirect } from "next/navigation";

/**
 * /scoreboard · 2026-05-30 · CONSOLIDATED into /stats.
 *
 * The scoreboard (character sheet + business KPIs) and /goals merged into
 * a single /stats surface ("who you are → where you're going → what's
 * happening now"). This route redirects so old links, bookmarks, deep
 * links, and the ~20 components that reference /scoreboard keep working.
 */
export default function ScoreboardRedirect() {
  redirect("/stats");
}
