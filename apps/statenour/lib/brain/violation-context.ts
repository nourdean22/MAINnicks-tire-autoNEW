/**
 * lib/brain/violation-context.ts · v10.0.414
 *
 * System-prompt helper that surfaces wisdoms the operator has been
 * ACTING AGAINST in the last 7 days. Nick sees the violation list
 * + a directive to mention the relevant ones when the current
 * conversation touches their topic.
 *
 * Why this exists · the v10.0.399 wisdom-violations endpoint and
 * v10.0.407 InsightsPanel surface violations in the dashboard.
 * The operator opens the dashboard maybe once a day. They're in
 * chat constantly · the highest-leverage place for violation
 * surfacing IS the chat reply. Without this layer, Nick had no
 * awareness of which advice the operator was systematically ignoring.
 *
 * Output shape · returns a system-prompt section ready to inject:
 *
 *   ## Active wisdom violations (last 7d)
 *   These are wisdoms the operator has been acting AGAINST. When the
 *   current message touches one of these areas, mention the violation
 *   directly · "you've been ignoring this advice · X% rate over the
 *   last week" · don't preach · just surface the pattern.
 *   - [Greene · Law 28] Conceal your intentions · 80% rate · 12 matches
 *   - [Buffett] Time horizon is the operator's edge · 60% rate · 6 matches
 *
 * Empty string when no violations · clean weeks get no section ·
 * matches the engine pattern from getWisdomContext / etc.
 *
 * v10.0.414 · CACHED for 5 min via the cached() helper · same TTL
 * as the system prompt cache so it can't drift in-flight.
 */

import { computeWisdomViolations } from "@/lib/brain/wisdom-violations";
import { cached } from "@/lib/utils/cache";

const CACHE_KEY = "violation_context_block";
const CACHE_TTL_S = 300; // 5 min · matches system-prompt cache
const TOP_VIOLATIONS = 3;
const MIN_RATE_TO_SURFACE = 0.3;

const ORIGIN_TAG: Record<string, string> = {
  "steve-jobs": "Jobs",
  "satori": "Satori",
  "warren-buffett": "Buffett",
  "bill-gates": "Gates",
  "elon-musk": "Musk",
  "greene-laws": "Greene",
  "distiller": "Distilled",
  "consolidation": "Synthesis",
  "uncategorized": "Wisdom",
};

function inferOriginTag(key: string): string {
  if (key.startsWith("wisdom_jobs_")) return ORIGIN_TAG["steve-jobs"];
  if (key.startsWith("wisdom_satori_")) return ORIGIN_TAG.satori;
  if (key.startsWith("wisdom_buffett_")) return ORIGIN_TAG["warren-buffett"];
  if (key.startsWith("wisdom_gates_")) return ORIGIN_TAG["bill-gates"];
  if (key.startsWith("wisdom_musk_")) return ORIGIN_TAG["elon-musk"];
  if (key.startsWith("wisdom_greene_")) {
    // Try to extract law number for fuller tag · "wisdom_greene_48laws_28" → "Greene · Law 28"
    const m = key.match(/wisdom_greene_(?:48laws_|33strat_|seduction_|mastery_|hn_|50th_)?(\d+)/);
    if (m) return `Greene · Law ${m[1]}`;
    return ORIGIN_TAG["greene-laws"];
  }
  if (key.startsWith("wisdom_distilled_")) return ORIGIN_TAG.distiller;
  if (key.startsWith("wisdom_from_")) return ORIGIN_TAG.consolidation;
  return ORIGIN_TAG.uncategorized;
}

export async function getViolationContext(): Promise<string> {
  return cached(CACHE_KEY, CACHE_TTL_S, async () => {
    try {
      const violations = await computeWisdomViolations({ daysBack: 7, limit: 12 });
      const surfaceable = violations
        .filter((v) => v.violationRate >= MIN_RATE_TO_SURFACE)
        // v10.0.414 · skip auto-promoted nick_advice with junk content ·
        // these are UI snippets / system pulses / image prompts that got
        // category=wisdom but aren't actual wisdom content. The evolution
        // panel handles cleaning these up; surfacing them here would
        // confuse Nick into "preaching" on UI snippets.
        .filter((v) => !v.content.startsWith("[PROMOTED TO WISDOM]"))
        .filter((v) => !v.content.startsWith("[PROVEN PATTERN]"))
        .filter((v) => !v.content.startsWith("**"))
        .filter((v) => !v.content.includes("PULSE]"))
        .filter((v) => !v.content.toLowerCase().includes("image prompt"))
        .filter((v) => !v.content.toLowerCase().includes("task created"))
        // Require minimum content quality · 40 chars + at least one
        // sentence-shaped pattern (verb + object).
        .filter((v) => v.content.length >= 40)
        .slice(0, TOP_VIOLATIONS);
      if (surfaceable.length === 0) return "";

      const lines = surfaceable.map((v) => {
        const tag = inferOriginTag(v.key);
        const pct = Math.round(v.violationRate * 100);
        const matchCount = v.matches.length;
        const principle = v.content.slice(0, 120).replace(/\s+/g, " ").trim();
        return `- [${tag}] ${principle}${v.content.length > 120 ? "…" : ""} · ${pct}% rate · ${matchCount} match${matchCount === 1 ? "" : "es"}`;
      });

      return [
        "## Active wisdom violations (last 7d)",
        "These are wisdoms the operator has been acting AGAINST. When the current message touches one of these areas, mention the violation directly · \"you've been ignoring this advice · X% rate over the last week\" · don't preach · surface the pattern.",
        ...lines,
      ].join("\n");
    } catch {
      return "";
    }
  });
}
