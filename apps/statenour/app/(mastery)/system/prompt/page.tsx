"use client";

/**
 * /system/prompt — unified prompt operator surface.
 *
 * v6 · Operator view for "what is Nick actually seeing right now?"
 * v10.0.307 · /system/prompts (library) and /system/prompt-comparison
 *             (v1↔v2 shadow comparison) absorbed as view-mode tabs ·
 *             one canonical prompt surface, three lenses:
 *
 *   · LIVE     · this page's original diagnostics (tier · size · cache
 *                · sections · head/tail · sample-message preview)
 *   · LIBRARY  · prompt-template inventory (was /system/prompts)
 *   · COMPARE  · v1↔v2 side-by-side parity check (was /prompt-comparison)
 *
 * URL ?view=library or ?view=compare deep-links directly.
 *
 * Hot-flush cache button stays in LIVE view.
 */

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle, RefreshCw, FileText, Cpu, Zap } from "lucide-react";
import { PromptLibraryView } from "@/components/system/prompt-library";
import { PromptComparisonView } from "@/components/system/prompt-comparison-view";

type PromptView = "live" | "library" | "compare";

// Suspense shell (Next 16 useSearchParams requirement).
export default function PromptDiagnosticsPage() {
  return (
    <Suspense fallback={null}>
      <PromptDiagnosticsInner />
    </Suspense>
  );
}

interface PromptDiag {
  ok: boolean;
  tier: { requested: string; detected: string; slot: string };
  size: {
    chars: number;
    words: number;
    tokensEst: number;
    veniceLimit: number;
    utilization: number;
    truncating: boolean;
    overBy: number;
  };
  knowledge: {
    moduleChars: number;
    contentEngineLoaded: boolean;
    deepEngineLoaded: boolean;
  };
  intent?: {
    isContent: boolean;
    confidence: number;
    rawScore: number;
    reasons: string[];
    embedSimilarity?: number;
    usedEmbedding: boolean;
  };
  sections: Array<{ title: string; chars: number; lines: number }>;
  sectionCount: number;
  buildMs: number;
  cache: {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  providers: Array<{ name: string; available: boolean; modelId: string }>;
  headPreview: string;
  tailPreview: string;
}

const SAMPLE_MESSAGES = [
  { label: "Casual: 'hey'", value: "hey" },
  { label: "Business: revenue check", value: "what's today's revenue" },
  { label: "Content: instagram post", value: "generate today's instagram post for nicks tire" },
  { label: "Deep: content plan", value: "give me a content plan for this month" },
  { label: "Strategy: planning", value: "should i hire another tech this quarter — long-term plan" },
  { label: "Builder: code", value: "find the brand-context module and add a new pillar" },
];

function PromptDiagnosticsInner() {
  const params = useSearchParams();
  const initialView: PromptView = (() => {
    const v = params?.get("view");
    if (v === "library") return "library";
    if (v === "compare") return "compare";
    return "live";
  })();
  const [view, setView] = useState<PromptView>(initialView);
  const [tier, setTier] = useState<"core" | "business" | "personal" | "strategy" | "full">("full");
  const [msg, setMsg] = useState("generate today's instagram post for nicks tire");

  // Phase B.7b · React Query drives the prompt-diagnostics rebuild
  // (was a manual authedFetch). The input object is the query key, so
  // changing the tier or sample message refetches without a manual
  // fetchDiag(). The PromptDiag shape flows from the procedure.
  const diagQuery = trpc.system.promptDiagnostics.useQuery(
    { tier, msg },
    { staleTime: 0 },
  );
  const data = diagQuery.data ?? null;
  const loading = diagQuery.isFetching;
  const fetchDiag = () => void diagQuery.refetch();

  // Phase B.7b · hot-flush is a tRPC mutation now. On success it
  // refetches the diagnostics so the cache stats reflect the flush.
  const flushMutation = trpc.system.flushPromptCache.useMutation();
  const flushing = flushMutation.isPending;
  const flush = async () => {
    try {
      await flushMutation.mutateAsync({
        reason: "manual flush from /system/prompt",
      });
      await diagQuery.refetch();
    } catch {
      // best-effort · the cache flush is non-critical
    }
  };

  const sizeColor = useMemo(() => {
    if (!data) return "text-[var(--text-tertiary)]";
    if (data.size.truncating) return "text-red-400";
    if (data.size.utilization > 85) return "text-amber-400";
    return "text-green-400";
  }, [data]);

  return (
    <div className="page-enter">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="DIAGNOSTICS"
        title="system prompt"
        description={
          view === "library"
            ? "Reusable prompt templates · system prompts, role primers, suggesters, verifiers."
            : view === "compare"
              ? "v1 vs v2 parity check · flip NICK_PRIME_PROMPT=1 once v2 covers what v1 carries."
              : "Live view of what Nick sees. Tier × slot × sections × cache × providers."
        }
        actions={
          <div className="hidden sm:flex items-center gap-0 rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
            {(["live", "library", "compare"] as PromptView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-2.5 py-1.5 text-xs font-medium transition border-l border-white/10 first:border-l-0",
                  view === v
                    ? v === "live"
                      ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                      : v === "library"
                        ? "bg-violet-500/15 text-violet-200"
                        : "bg-cyan-500/15 text-cyan-200"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      {/* v10.0.307 · LIBRARY view (absorbed from /system/prompts) */}
      {view === "library" && <PromptLibraryView />}
      {/* v10.0.307 · COMPARE view (absorbed from /system/prompt-comparison) */}
      {view === "compare" && <PromptComparisonView />}
      {/* LIVE view (this page's original diagnostics body) below */}
      {view === "live" && (
        <>

      {/* Tier + sample input */}
      <Panel className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-[var(--text-tertiary)] block mb-1">Tier</label>
            <div className="flex gap-1 flex-wrap">
              {(["core", "business", "personal", "strategy", "full"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] uppercase tracking-wider border transition-colors",
                    tier === t
                      ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text-tertiary)] block mb-1">Sample message</label>
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="generate today's instagram post"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap mb-2">
          {SAMPLE_MESSAGES.map((s) => (
            <button
              key={s.value}
              onClick={() => setMsg(s.value)}
              className="px-2 py-0.5 text-[10px] rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <Button onClick={() => void fetchDiag()} disabled={loading} size="sm">
            <RefreshCw className={cn("w-3 h-3 mr-1.5", loading && "animate-spin")} />
            Rebuild
          </Button>
          <Button
            onClick={() => void flush()}
            disabled={flushing}
            size="sm"
            variant="outline"
            className="text-amber-400 border-amber-400/40 hover:bg-amber-400/10"
          >
            <Zap className={cn("w-3 h-3 mr-1.5", flushing && "animate-pulse")} />
            Hot-flush cache
          </Button>
          {data && (
            <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
              built in {data.buildMs}ms
            </span>
          )}
        </div>
      </Panel>

      {data && (
        <>
          {/* Size + tier overview */}
          <Panel className="mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">tier · slot</div>
                <div className="text-sm font-mono">
                  {data.tier.detected}{" "}
                  <span className="text-[var(--gold)]">·</span>{" "}
                  {data.tier.slot}
                </div>
                {data.tier.requested !== data.tier.detected && (
                  <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5">
                    requested: {data.tier.requested}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">size</div>
                <div className={cn("text-sm font-mono", sizeColor)}>
                  {(data.size.chars / 1000).toFixed(1)}kc
                </div>
                <div className="text-[9px] text-[var(--text-tertiary)]">
                  {data.size.utilization}% of 65k · ~{data.size.tokensEst.toLocaleString()} tokens
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">knowledge module</div>
                <div className="text-sm font-mono">{(data.knowledge.moduleChars / 1000).toFixed(1)}kc</div>
                <div className="text-[9px] text-[var(--text-tertiary)]">
                  {data.knowledge.contentEngineLoaded ? "✓ content engine" : "default"}
                  {data.knowledge.deepEngineLoaded && " · deep"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">cache</div>
                <div className="text-sm font-mono">{data.cache.size} entries</div>
                <div className="text-[9px] text-[var(--text-tertiary)]">
                  {(data.cache.hitRate * 100).toFixed(0)}% hit rate · {data.cache.hits}h / {data.cache.misses}m
                </div>
              </div>
            </div>

            {data.size.truncating && (
              <div className="mt-3 flex gap-2 items-start p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="text-red-400 font-bold">TRUNCATING</span> —{" "}
                  prompt is {(data.size.overBy / 1000).toFixed(1)}kc over Venice's 65k limit.
                  Older sections being dropped. Reduce content engine load or route through
                  Ollama Cloud (1M ctx) for this query.
                </div>
              </div>
            )}

            {/* Content-intent diagnostic — only renders when sample message provided */}
            {data.intent && (
              <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    content-intent classifier
                  </span>
                  <span className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded",
                    data.intent.isContent
                      ? "bg-violet-500/15 text-violet-300 border border-violet-500/40"
                      : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30",
                  )}>
                    {data.intent.isContent ? "CONTENT" : "NOT-CONTENT"} · {(data.intent.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">
                  raw score: <span className="font-mono">{data.intent.rawScore}</span>
                  {data.intent.usedEmbedding && (
                    <> · embed-sim: <span className="font-mono">{data.intent.embedSimilarity?.toFixed(3)}</span></>
                  )}
                </div>
                {data.intent.reasons.length > 0 && (
                  <div className="text-[9px] text-[var(--text-tertiary)] font-mono leading-relaxed">
                    {data.intent.reasons.slice(0, 8).map((r, i) => (
                      <span key={i} className="inline-block mr-2 mb-0.5">{r}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* Provider availability */}
          <Panel className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">providers</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {data.providers.map((p) => (
                <div
                  key={p.name + p.modelId}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg border text-xs",
                    p.available
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-[var(--border-default)] opacity-50",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full", p.available ? "bg-green-400" : "bg-[var(--text-tertiary)]")}/>
                    <span className="font-medium uppercase text-[10px] tracking-wider">{p.name}</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-tertiary)] font-mono mt-0.5 truncate" title={p.modelId}>
                    {p.modelId}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Section breakdown — top 25 by chars */}
          <Panel className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
                top 25 sections (of {data.sectionCount}) — by char count
              </h3>
            </div>
            <div className="space-y-1">
              {data.sections.map((s, i) => {
                const pct = Math.round((s.chars / data.size.chars) * 100);
                return (
                  <div key={i} className="flex gap-2 items-center text-xs">
                    <span className="text-[var(--text-tertiary)] w-6 text-right tabular-nums">{i + 1}.</span>
                    <span className="flex-1 truncate text-[var(--text-secondary)]" title={s.title}>{s.title}</span>
                    <span className="text-[var(--text-tertiary)] tabular-nums w-14 text-right">
                      {(s.chars / 1000).toFixed(1)}kc
                    </span>
                    <div className="w-20 h-1 bg-[var(--bg-elevated)] rounded overflow-hidden">
                      <div
                        className="h-full bg-[var(--gold)]/60"
                        style={{ width: `${Math.min(100, pct * 5)}%` }}
                      />
                    </div>
                    <span className="text-[var(--text-tertiary)] tabular-nums w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Head + tail preview */}
          <Panel className="mb-4">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">first 1.5kc (head)</h3>
            <pre className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-void)] p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap">
              {data.headPreview}
            </pre>
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2 mt-4">last 800c (tail)</h3>
            <pre className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-void)] p-3 rounded-lg overflow-auto max-h-32 whitespace-pre-wrap">
              {data.tailPreview}
            </pre>
          </Panel>
        </>
      )}
        </>
      )}
    </div>
  );
}
