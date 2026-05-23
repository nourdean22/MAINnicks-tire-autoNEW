"use client";

/**
 * /brain/reflections · task #13 (2026-05-23) · CoALA reflection viewer.
 *
 * The reflection loop landed at `16676209` (writes `category=reflection`
 * BrainMemory rows with `metadata.derivedFrom` traceability) — but
 * nothing surfaces those synthesized insights to the operator yet. This
 * page IS the interface: browse recent synthesized patterns, see source
 * category, confidence, time window, and (collapsibly) the source memory
 * ids each one derives from.
 *
 * The reflection loop is the substance · this is the surface. Read-only.
 *
 * The five source categories the weekly cron iterates (per
 * /api/cron/reflect-categories.REFLECT_CATEGORIES) are surfaced as the
 * filter dropdown options · plus "all" to reset.
 *
 * Editorial-minimalist per docs/aesthetic-principles.md · gold-on-dark
 * surface · glass cards · ui-monospace tabular numbers on chips · no
 * purple · no Inter.
 */

import { useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { trpc } from "@/lib/trpc/client";

// ── Filter options ─────────────────────────────────────────────────
//
// Mirror /api/cron/reflect-categories.REFLECT_CATEGORIES — the five
// source categories the weekly cron actually writes reflections for.
// "all" resets the filter (passed as undefined to the procedure).
const FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "all" },
  { value: "decision_log", label: "decision log" },
  { value: "pattern", label: "pattern" },
  { value: "belief", label: "belief" },
  { value: "lesson", label: "lesson" },
  { value: "learning_journal", label: "learning journal" },
];

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function formatSourceCategory(slug: string): string {
  return slug.replace(/_/g, " ");
}

export default function BrainReflectionsPage() {
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Pass sourceCategory only when a real category is selected · the
  // service treats undefined and "all" the same, but the typed schema
  // here matches the procedure's optional shape.
  const reflectionsQuery = trpc.brain.recentReflections.useQuery({
    sourceCategory: filter === "all" ? undefined : filter,
    limit: 50,
  });

  const reflections = reflectionsQuery.data?.reflections ?? null;

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <StandardPage
      eyebrow="brain"
      title="reflections"
      description="higher-level patterns the brain synthesized from raw memory · the weekly cron writes these when ≥5 source memories exist."
      width="md"
      rhythm="comfortable"
    >
      {/* Filter dropdown · plain select to match the editorial-minimalist
          stance · no decorative chrome. The cron-iterated categories are
          the only meaningful filter targets · the dropdown is also the
          self-documenting list of WHAT gets reflected on. */}
      <div className="flex items-center gap-2 flex-wrap">
        <label
          htmlFor="reflections-filter"
          className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]"
        >
          source category
        </label>
        <select
          id="reflections-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-[var(--bg-raised)]/[0.03] border border-[var(--border-default)] rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/40 hover:border-[var(--gold)]/30 transition-colors"
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {reflections && (
          <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            {reflections.length} reflection{reflections.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Loading shell */}
      {reflectionsQuery.isLoading && (
        <div className="text-[11px] text-[var(--text-tertiary)] py-8 text-center">
          loading reflections…
        </div>
      )}

      {/* Error shell */}
      {reflectionsQuery.isError && (
        <div className="rounded border border-red-500/30 bg-red-500/[0.04] px-3 py-3 text-[11px] text-red-300">
          failed to load reflections ·{" "}
          {reflectionsQuery.error?.message ?? "unknown error"}
        </div>
      )}

      {/* Empty state */}
      {reflections && reflections.length === 0 && (
        <div className="rounded border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] px-4 py-6 text-[11px] text-[var(--text-tertiary)] text-center">
          no reflections yet · the weekly cron writes them when ≥5 source
          memories exist for a category.
        </div>
      )}

      {/* Card list */}
      {reflections && reflections.length > 0 && (
        <ul className="space-y-3">
          {reflections.map((r) => {
            const isExpanded = expanded.has(r.id);
            return (
              <li
                key={r.id}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-4 space-y-3"
              >
                {/* Insight body · large readable text · multi-line ok. */}
                <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                  {r.content}
                </p>

                {/* Chip row · source category badge + confidence + window. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-[var(--gold)]/10 text-[var(--gold)] border border-[var(--gold)]/20">
                    {formatSourceCategory(r.sourceCategory)}
                  </span>
                  {r.confidence !== null && (
                    <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                      {Math.round(r.confidence * 100)}% confidence
                    </span>
                  )}
                  {r.reflectionWindow && (
                    <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                      {r.reflectionWindow.days}d window · {r.derivedFrom.length}{" "}
                      source{r.derivedFrom.length === 1 ? "" : "s"}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                    {formatRelative(r.createdAt)}
                  </span>
                </div>

                {/* Collapsible derived-from list. Plain text source ids ·
                    no link-out this slice (per brief · that's a follow-up).
                    Hidden entirely when empty (a malformed metadata row
                    coerces to []). */}
                {r.derivedFrom.length > 0 && (
                  <div className="pt-1 border-t border-[var(--border-default)]/40">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(r.id)}
                      className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "−" : "+"} derived from{" "}
                      {r.derivedFrom.length} source{" "}
                      {r.derivedFrom.length === 1 ? "memory" : "memories"}
                    </button>
                    {isExpanded && (
                      <ul className="mt-2 pl-2 border-l border-[var(--border-default)] space-y-0.5">
                        {r.derivedFrom.map((id) => (
                          <li
                            key={id}
                            className="text-[10px] font-mono tabular-nums text-[var(--text-secondary)]"
                          >
                            {id}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </StandardPage>
  );
}
