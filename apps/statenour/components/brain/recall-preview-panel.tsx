"use client";

import { FormEvent, useState } from "react";
import { Brain, Loader2, Search, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/utils/api-fetch";
// Read-only recall (preview=1): what "without sending a chat message" promises.
import { recallPreviewUrl } from "@/lib/brain/recall-preview-url";

type RecallHit = {
  memoryId: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  factAgeDays: number;
  knnDistance: number;
  finalScore: number;
  trustTier: string;
};

type RecallReport = {
  query: string;
  durationMs: number;
  scanned: number;
  hits: RecallHit[];
  provenance?: "OK" | "ZERO" | "ERROR" | "UNMEASURED";
  provenanceReason?: string;
  promptBlock?: string;
};
export function RecallPreviewPanel() {
  const [query, setQuery] = useState("");
  const [includePrompt, setIncludePrompt] = useState(false);
  const [report, setReport] = useState<RecallReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<RecallReport>(recallPreviewUrl(q, includePrompt));
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recall failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <section id="recall-preview" className="scroll-mt-24 rounded-lg border border-edge bg-surface/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Brain size={14} className="text-gold" />
            <h3 className="text-sm font-semibold text-fg">Recall preview</h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-fg-tertiary">
            Inspect the memories Nick would consider for a prompt without sending a chat message.
          </p>
        </div>
        {report?.provenance ? (
          <span className="rounded border border-edge px-2 py-1 font-mono text-[10px] text-fg-secondary">
            {report.provenance}
          </span>
        ) : null}
      </div>

      <form onSubmit={run} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="recall-preview-query">Recall query</label>
        <input
          id="recall-preview-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What would Nick remember about…"
          className="min-h-11 flex-1 rounded-md border border-edge bg-void px-3 text-sm text-fg outline-none focus:border-gold/50"
        />
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gold/30 bg-gold/10 px-4 text-xs font-semibold text-gold disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Preview
        </button>
      </form>

      <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs text-fg-tertiary">
        <input
          type="checkbox"
          checked={includePrompt}
          onChange={(event) => setIncludePrompt(event.target.checked)}
        />
        Show the exact fenced prompt block
      </label>

      {error ? (
        <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error} — state unknown, not empty.
        </p>
      ) : null}

      {report ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-fg-tertiary">
            <span>{report.hits.length} hits</span>
            <span>{report.scanned} scanned</span>
            <span>{report.durationMs} ms</span>
          </div>

          {report.hits.length === 0 ? (
            <p className="rounded-md border border-edge px-3 py-3 text-xs text-fg-tertiary">
              {report.provenanceReason ?? "Recall completed and found no eligible match."}
            </p>
          ) : (
            <div className="space-y-2">
              {report.hits.map((hit) => (
                <article key={hit.memoryId} className="rounded-md border border-edge bg-void/50 p-3">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-fg-tertiary">
                    <span>{hit.category}</span>
                    <span>score {hit.finalScore.toFixed(3)}</span>
                    <span>fact age {hit.factAgeDays}d</span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck size={10} /> {hit.trustTier}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-fg-secondary">{hit.content}</p>
                </article>
              ))}
            </div>
          )}

          {includePrompt && report.promptBlock ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-void p-3 text-[10px] leading-4 text-fg-secondary">
              {report.promptBlock}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
