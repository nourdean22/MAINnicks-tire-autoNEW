"use client";

/**
 * components/brain/brain-insights-panel.tsx · v10.0.407
 *
 * 3-up insight panel that surfaces the new brain feedback layers:
 *
 *   · WISDOM VIOLATIONS (v10.0.399 · /api/brain/wisdom/violations) ·
 *     wisdoms the operator has been ACTING AGAINST in the last 7d
 *     · the "advice you keep ignoring is often the advice you most
 *     need surfaced" loop.
 *
 *   · EVOLUTION CANDIDATES (v10.0.406 · /api/brain/wisdom/evolution) ·
 *     stale + redundant + low-trust wisdoms · operator confirms each
 *     deprecate / merge / review move.
 *
 *   · IMPROVEMENT HYPOTHESES (v10.0.405 · /api/brain/improve-agent) ·
 *     LLM-as-judge axis-failure trends across the last 7d of replies
 *     · concrete prompt-policy tweaks the operator can wire.
 *
 * All three load lazily on mount · 5s budget · panel hides itself if
 * no signal in any of the three buckets (clean weeks get no card).
 *
 * Style matches v10.0.218 InsightRibbon · gold-on-dark · operator-grade ·
 * dense info-per-pixel.
 */

import { useEffect, useRef, useState } from "react";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { useOnline } from "@/lib/query-state";

interface ViolationRow {
  id: string;
  key: string;
  content: string;
  origin: string;
  violationRate: number;
  matches: string[];
  confidence: number;
}
interface EvolutionStale { type: "stale"; key: string; content: string; daysSinceLastSeen: number; reason: string }
interface EvolutionRedundant { type: "redundant"; keepKey: string; mergeKey: string; similarity: number; reason: string }
interface EvolutionLowTrust { type: "low_trust"; key: string; content: string; reason: string }
interface ImproveHypothesis { axis: string; failureRate: number; failingCount: number; totalCount: number; proposedRuleChange: string }

interface ViolationsResp { violations?: ViolationRow[]; total?: number }
interface EvolutionResp { stale?: EvolutionStale[]; redundant?: EvolutionRedundant[]; lowTrust?: EvolutionLowTrust[]; totalCandidates?: number }
interface ImproveResp { hypotheses?: ImproveHypothesis[]; judgmentCount?: number }

const FETCH_OPTIONS: RequestInit = { credentials: "same-origin", cache: "no-store" };

export type InsightFeed = "violations" | "evolution" | "improve";

export interface InsightFeeds {
  violations: ViolationsResp | null;
  evolution: EvolutionResp | null;
  improve: ImproveResp | null;
  /** Feeds that answered non-200 or threw. A failed feed is unknown, never an empty one. */
  failed: InsightFeed[];
}

/** Reads the three feeds and records which ones failed (truth sweep 2026-10-23: a bare `.catch(() => null)` hid them). */
export async function loadInsightFeeds(fetchFn: typeof fetch = fetch): Promise<InsightFeeds> {
  const failed: InsightFeed[] = [];
  const read = async <T,>(feed: InsightFeed, url: string): Promise<T | null> => {
    try {
      const r = await fetchFn(url, FETCH_OPTIONS);
      if (r.ok) return (await r.json()) as T;
    } catch {
      // falls through to the failed list below
    }
    failed.push(feed);
    return null;
  };
  const [violations, evolution, improve] = await Promise.all([
    read<ViolationsResp>("violations", "/api/brain/wisdom/violations?days=7&limit=3"),
    read<EvolutionResp>("evolution", "/api/brain/wisdom/evolution"),
    read<ImproveResp>("improve", "/api/brain/improve-agent?days=7"),
  ]);
  return { violations, evolution, improve, failed };
}

export function BrainInsightsPanel() {
  const [feeds, setFeeds] = useState<InsightFeeds | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const online = useOnline();
  const loadedOnce = useRef(false);

  // Loads on mount (an offline open still has to say offline), again when the connection returns
  // (review F2: it used to load once, so a panel opened offline flipped to a red "could not load"
  // with nothing to retry it), and again on Retry. It does not refetch while offline.
  useEffect(() => {
    if (loadedOnce.current && !online) return;
    let cancelled = false;
    void loadInsightFeeds().then((res) => {
      if (cancelled) return;
      loadedOnce.current = true;
      setFeeds(res);
      setRetrying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [online, attempt]);

  if (!feeds) return null;
  return (
    <BrainInsightsView
      {...feeds}
      offline={!online}
      retrying={retrying}
      onRetry={() => {
        setRetrying(true);
        setAttempt((n) => n + 1);
      }}
    />
  );
}

export function BrainInsightsView({
  violations,
  evolution,
  improve,
  failed,
  offline,
  onRetry,
  retrying = false,
}: InsightFeeds & { offline: boolean; onRetry?: () => void; retrying?: boolean }) {
  // Hide entirely if every bucket is empty AND every feed answered · clean weeks get no card
  const hasSignal =
    (violations?.violations?.length ?? 0) > 0 ||
    (evolution?.totalCandidates ?? 0) > 0 ||
    (improve?.hypotheses?.length ?? 0) > 0;

  if (!hasSignal && failed.length === 0) return null;

  const failedNote =
    failed.length === 0 ? null : offline ? (
      <ReadStateNote state="offline" label="Brain insights" className="mb-3" />
    ) : (
      <ReadStateNote
        state="error"
        label="Brain insights"
        message={`Brain insights: ${failed.length} of 3 feeds could not load. State unknown, not empty.`}
        onRetry={onRetry}
        retrying={retrying}
        className="mb-3"
      />
    );

  return (
    <div className="rounded-surface border border-[var(--border-default)] bg-content p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-mono text-fg-tertiary">
          Brain insights
        </h2>
        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
          last 7d
        </span>
      </div>
      {failedNote}
      {/* v10.0.486 · de-slopped from md:grid-cols-3 symmetric trio
          to a stacked feed. Three info-dense cards side-by-side
          read as "feature grid": the most identifiable AI-design
          fingerprint. Stacked scan-down is the operator-grade
          editorial pattern. */}
      <div className="space-y-3">
        {!failed.includes("violations") && <ViolationsCard rows={violations?.violations ?? []} />}
        {!failed.includes("evolution") && (
          <EvolutionCard
            stale={evolution?.stale ?? []}
            redundant={evolution?.redundant ?? []}
            lowTrust={evolution?.lowTrust ?? []}
          />
        )}
        {!failed.includes("improve") && <ImproveCard hypotheses={improve?.hypotheses ?? []} />}
      </div>
    </div>
  );
}

function CardShell({ title, count, accent, children }: { title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-micro border border-[var(--border-default)] bg-content p-3">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[11px] font-mono ${accent}`}>
          {title}
        </span>
        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
          {count}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ViolationsCard({ rows }: { rows: ViolationRow[] }) {
  if (rows.length === 0) {
    return (
      <CardShell title="violations" count={0} accent="text-[var(--text-tertiary)]">
        <p className="text-[11px] text-[var(--text-tertiary)]">No active violations · acting in alignment</p>
      </CardShell>
    );
  }
  return (
    <CardShell title="violating" count={rows.length} accent="text-[#ff7b7b]">
      {rows.slice(0, 3).map((r) => (
        <div key={r.id} className="text-[11px] leading-tight">
          <div className="text-[var(--text-primary)] line-clamp-2">{r.content}</div>
          <div className="text-[var(--text-tertiary)] mt-0.5 font-mono">
            {Math.round(r.violationRate * 100)}% rate · {r.matches.length} match{r.matches.length === 1 ? "" : "es"}
          </div>
        </div>
      ))}
    </CardShell>
  );
}

function EvolutionCard({ stale, redundant, lowTrust }: { stale: EvolutionStale[]; redundant: EvolutionRedundant[]; lowTrust: EvolutionLowTrust[] }) {
  const total = stale.length + redundant.length + lowTrust.length;
  if (total === 0) {
    return (
      <CardShell title="evolution" count={0} accent="text-[var(--text-tertiary)]">
        <p className="text-[11px] text-[var(--text-tertiary)]">No candidates · corpus is healthy</p>
      </CardShell>
    );
  }
  return (
    <CardShell title="evolution" count={total} accent="text-fg-secondary">
      {stale.slice(0, 1).map((c) => (
        <div key={c.key} className="text-[11px] leading-tight">
          <span className="font-mono text-fg-secondary mr-1">[stale]</span>
          <span className="text-[var(--text-primary)] line-clamp-1">{c.content.slice(0, 80)}</span>
          <div className="text-[var(--text-tertiary)] font-mono">{c.daysSinceLastSeen}d cold</div>
        </div>
      ))}
      {redundant.slice(0, 1).map((c) => (
        <div key={c.keepKey} className="text-[11px] leading-tight">
          <span className="font-mono text-fg-secondary mr-1">[merge]</span>
          <span className="text-[var(--text-primary)]">{c.keepKey} and {c.mergeKey}</span>
          <div className="text-[var(--text-tertiary)] font-mono">cosine {c.similarity}</div>
        </div>
      ))}
      {lowTrust.slice(0, 1).map((c) => (
        <div key={c.key} className="text-[11px] leading-tight">
          <span className="font-mono text-fg-secondary mr-1">[doubt]</span>
          <span className="text-[var(--text-primary)] line-clamp-1">{c.content.slice(0, 80)}</span>
        </div>
      ))}
      <a
        href="/brain?tab=memory&evolution=1"
        className="block text-[11px] font-mono text-fg-secondary hover:underline mt-1 py-2 sm:py-0"
      >
        Review all →
      </a>
    </CardShell>
  );
}

function ImproveCard({ hypotheses }: { hypotheses: ImproveHypothesis[] }) {
  if (hypotheses.length === 0) {
    return (
      <CardShell title="improve" count={0} accent="text-[var(--text-tertiary)]">
        <p className="text-[11px] text-[var(--text-tertiary)]">No axis failing &gt; 15% · replies on track</p>
      </CardShell>
    );
  }
  return (
    <CardShell title="improve" count={hypotheses.length} accent="text-[#7bb3ff]">
      {hypotheses.slice(0, 3).map((h) => (
        <div key={h.axis} className="text-[11px] leading-tight">
          <div className="font-mono text-[#7bb3ff]/90">{h.axis} · {Math.round(h.failureRate * 100)}%</div>
          <div className="text-[var(--text-primary)] line-clamp-2 mt-0.5">{h.proposedRuleChange.slice(0, 110)}</div>
        </div>
      ))}
    </CardShell>
  );
}
