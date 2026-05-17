"use client";

/**
 * /system/ghost-nour — what past-Nour would do (W12.3).
 *
 * Type a situation → Ghost finds the most similar past MasteryDecisions,
 * shows what past-Nour chose, how those choices graded out, and emits a
 * recommendation weighted by historical outcome quality.
 *
 * Also surfaces recent pending decisions (no actualOutcome yet) as one-
 * click "run ghost on this" candidates.
 *
 * Alive:
 *   · confidence indicator (none/low/medium/high) by match count
 *   · choice bars tinted by avgGrade
 *   · typing-form shake on empty submit
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface Match {
  id: number;
  date: string;
  title: string;
  chosen: string | null;
  domain: string | null;
  grade: string | null;
  similarity: number;
  actualOutcome: string | null;
}
interface Choice {
  choice: string;
  count: number;
  avgGrade: number | null;
  reviewedCount: number;
}
interface Prediction {
  situation: string;
  matchCount: number;
  confidence: "none" | "low" | "medium" | "high";
  avgGrade: number | null;
  matches: Match[];
  choices: Choice[];
  ghostRecommendation: Choice | null;
  generatedAt: string;
}

interface Candidate {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  chosen: string | null;
  stakes: string | null;
  createdAt: string;
}

function tintForGrade(n: number | null): string {
  if (n === null) return "text-zinc-500";
  if (n >= 3.5) return "text-emerald-400";
  if (n >= 2.5) return "text-sky-300";
  if (n >= 1.5) return "text-amber-400";
  return "text-rose-400";
}

function confidenceTint(c: Prediction["confidence"]): string {
  if (c === "high") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (c === "medium") return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  if (c === "low") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function GhostNourPage() {
  const [situation, setSituation] = useState("");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [formShake, setFormShake] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await authedFetch("/api/system/ghost-nour?list=recent", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const data = json.data ?? json;
      setCandidates(data.candidates ?? []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  async function runGhost(situationText?: string) {
    const text = (situationText ?? situation).trim();
    if (text.length < 3) {
      setFormShake(true);
      setTimeout(() => setFormShake(false), 500);
      return;
    }
    setLoading(true);
    try {
      const res = await authedFetch("/api/system/ghost-nour", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ situation: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setPrediction(json.data ?? json);
      if (situationText) setSituation(situationText);
    } catch (e) {
      console.error("ghost failed", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="ghost nour"
      description="what past-Nour would do · similarity search over your MasteryDecision history"
      width="xl"
      rhythm="loose"
      actions={
        prediction ? (
          <FreshnessChip
            lastFetchedAt={prediction.generatedAt}
            source="db · MasteryDecision"
          />
        ) : null
      }
    >

      {/* Input form */}
      <Panel
        className={cn(
          "border-violet-500/30 bg-gradient-to-br from-violet-500/[0.04] to-transparent transition-transform",
          formShake && "animate-shake",
        )}
      >
        <h2 className="mb-2 text-sm font-semibold text-violet-200">the situation</h2>
        <p className="mb-3 text-[11px] text-zinc-400">
          describe what you&apos;re deciding. Ghost Nour greps your past decisions for
          matches, shows what you&apos;ve done before, and weighs the choices by how
          they graded out.
        </p>
        <textarea
          ref={textareaRef}
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          placeholder="e.g. 'should I reduce pricing on full brake jobs to compete with the shop down the street?'"
          rows={4}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/60 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              runGhost();
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">⌘↩ to run · matches ranked by keyword overlap</span>
          <button
            onClick={() => runGhost()}
            disabled={loading || situation.trim().length < 3}
            className={cn(
              "rounded-md border px-4 py-2 text-xs font-medium transition",
              loading
                ? "border-violet-500/30 bg-violet-500/10 text-violet-200 animate-pulse"
                : "border-violet-500/50 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 disabled:opacity-40",
            )}
          >
            {loading ? "summoning ghost…" : "🫥 summon past-Nour"}
          </button>
        </div>
      </Panel>

      {/* Prediction */}
      {prediction && (
        <>
          {/* Confidence + headline */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">ghost prediction</h2>
              <span className={cn("rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider", confidenceTint(prediction.confidence))}>
                confidence · {prediction.confidence} · <AnimatedCounter value={prediction.matchCount} /> matches
              </span>
            </div>
            {prediction.ghostRecommendation ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">past-Nour recommends</div>
                <div className="text-lg font-semibold text-zinc-100">
                  {prediction.ghostRecommendation.choice}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
                  <span>
                    picked <AnimatedCounter value={prediction.ghostRecommendation.count} />× in history
                  </span>
                  {prediction.ghostRecommendation.avgGrade !== null && (
                    <span>
                      avg grade <span className={tintForGrade(prediction.ghostRecommendation.avgGrade)}>
                        <AnimatedCounter value={prediction.ghostRecommendation.avgGrade} decimals={2} locale={false} />/4
                      </span> over <AnimatedCounter value={prediction.ghostRecommendation.reviewedCount} /> reviewed
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[10px] italic text-zinc-500">
                  this is what the highest-graded historical pick was — Ghost is not
                  oracular. It reflects patterns; it can&apos;t see novelty.
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                no historical matches strong enough to recommend a choice.
                {prediction.matchCount > 0 && " See matches below — review them and decide fresh."}
              </p>
            )}
          </Panel>

          {/* Choice distribution */}
          {prediction.choices.length > 0 && (
            <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
              <h2 className="mb-3 text-sm font-semibold text-white">what past-Nour chose · distribution</h2>
              <div className="space-y-2">
                {prediction.choices.slice(0, 8).map((c) => {
                  const maxCount = Math.max(...prediction.choices.map((x) => x.count), 1);
                  const barW = Math.max(5, Math.round((c.count / maxCount) * 100));
                  return (
                    <div key={c.choice} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded px-2 py-1.5 transition hover:bg-white/[0.03]">
                      <div>
                        <div className="truncate text-xs text-zinc-200">{c.choice}</div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              c.avgGrade !== null && c.avgGrade >= 3 ? "bg-emerald-500" :
                              c.avgGrade !== null && c.avgGrade >= 2 ? "bg-amber-500" :
                              c.avgGrade !== null ? "bg-rose-500" : "bg-zinc-600"
                            )}
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] tabular-nums text-zinc-500">{c.count}×</span>
                      <span className={cn("font-mono text-xs tabular-nums", tintForGrade(c.avgGrade))}>
                        {c.avgGrade !== null ? `${c.avgGrade.toFixed(2)}/4` : "ungraded"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* Top matches */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <h2 className="mb-3 text-sm font-semibold text-white">top {prediction.matches.length} matches</h2>
            {prediction.matches.length === 0 ? (
              <p className="text-xs text-zinc-500">no past decisions similar enough to surface. this is new territory.</p>
            ) : (
              <div className="space-y-2">
                {prediction.matches.map((m) => (
                  <div key={m.id} className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex-shrink-0 rounded bg-violet-500/15 px-2 py-0.5 text-[9px] tabular-nums text-violet-200">
                          sim {Math.round(m.similarity * 100)}%
                        </span>
                        <span className="truncate text-xs text-zinc-100">{m.title}</span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2 text-[10px]">
                        {m.domain && <span className="text-zinc-500">{m.domain}</span>}
                        {m.grade && (
                          <span className={cn("rounded px-1.5 py-[1px] uppercase", tintForGrade(null))}>
                            <span className={tintForGrade(null)}>{m.grade}</span>
                          </span>
                        )}
                        <span className="text-zinc-500">{m.date}</span>
                      </div>
                    </div>
                    {(m.chosen || m.actualOutcome) && (
                      <div className="mt-2 grid gap-1 text-[10px] text-zinc-500 md:grid-cols-2">
                        <div>chose: <span className="text-zinc-300">{m.chosen ?? "—"}</span></div>
                        {m.actualOutcome && (
                          <div>outcome: <span className="text-zinc-300">{m.actualOutcome.slice(0, 120)}</span></div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {/* Pending decisions — one-click ghost */}
      {candidates.length > 0 && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">run ghost on a pending decision</h2>
            <span className="text-xs text-zinc-500"><AnimatedCounter value={candidates.length} /> unreviewed · click to load</span>
          </div>
          <div className="space-y-1">
            {candidates.slice(0, 10).map((c) => (
              <button
                key={c.id}
                onClick={() => runGhost(`${c.title}${c.stakes ? " · " + c.stakes : ""}${c.chosen ? " · considering: " + c.chosen : ""}`)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2 text-left transition hover:border-violet-500/40 hover:bg-violet-500/[0.04]"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs text-zinc-200">{c.title}</div>
                  {c.stakes && <div className="truncate text-[10px] text-zinc-500">{c.stakes}</div>}
                </div>
                {c.domain && <span className="text-[10px] text-zinc-500">{c.domain}</span>}
                <span className="text-[10px] text-zinc-500">{timeAgo(c.createdAt)}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        source: MasteryDecision (top 500 by recency) · Jaccard keyword similarity · cost: 0¢ per query (no AI call)
      </p>
    </StandardPage>
  );
}
