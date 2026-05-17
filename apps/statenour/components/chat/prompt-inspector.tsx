"use client";

/**
 * PromptInspector — see what Nick is actually being sent.
 *
 * Power + transparency. Opens as a modal from the chat header (or
 * settings page). Shows:
 *   - Current provider + model
 *   - Cache status (HIT / MISS + build time in ms)
 *   - Length, word count, token estimate
 *   - Truncation warning if length > max
 *   - Preview of the first + last ~2000 chars
 *   - "Force fresh" button to invalidate the cache and rebuild
 *   - "Download full" button to get the raw prompt for manual audit
 *
 * This is the thing that stops Nour from guessing whether Nick is
 * seeing the latest data — he can just open the panel and see.
 */

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { X, RefreshCw, Download, AlertTriangle, CheckCircle2 } from "lucide-react";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface PromptStats {
  provider: string;
  modelId: string;
  fromCache: boolean;
  buildMs: number;
  length: number;
  effectiveLength: number;
  wordCount: number;
  tokenEstimate: number;
  maxSystemChars: number;
  truncated: boolean;
  truncatedAt: number | null;
  preview: string;
  tail: string;
}

interface PromptInspectorProps {
  open: boolean;
  onClose: () => void;
}

export function PromptInspector({ open, onClose }: PromptInspectorProps) {
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = fresh ? "/api/ai/inspect-prompt?fresh=1" : "/api/ai/inspect-prompt";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompt");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open && !stats) load();
  }, [open, stats, load]);

  const forceRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const downloadFull = useCallback(async () => {
    try {
      const res = await authedFetch("/api/ai/inspect-prompt?raw=1");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `nick-system-prompt-${new Date().toISOString().slice(0, 19)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9600] flex items-start justify-center pt-[5vh] px-4 bg-[var(--bg-void)]/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-void)] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(253,185,19,0.15)] overflow-hidden flex flex-col animate-fade-in-scale"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              System Prompt · Live
            </span>
            {stats && (
              <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
                {stats.provider.toUpperCase()} · {stats.modelId}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={forceRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 px-2 h-6 rounded-md border border-[var(--border-default)] text-[9px] font-bold text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors disabled:opacity-40"
              title="Invalidate cache and rebuild"
            >
              <RefreshCw size={10} className={cn(refreshing && "animate-spin")} />
              FRESH
            </button>
            <button
              onClick={downloadFull}
              className="flex items-center gap-1 px-2 h-6 rounded-md border border-[var(--border-default)] text-[9px] font-bold text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors"
              title="Download the full prompt as text"
            >
              <Download size={10} />
              FULL
            </button>
            <button
              onClick={onClose}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && !stats && (
            <div className="flex items-center justify-center h-32 text-[11px] text-[var(--text-tertiary)]">
              Loading prompt…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertTriangle size={13} className="text-red-400" />
              <span className="text-[11px] text-red-300">{error}</span>
            </div>
          )}

          {stats && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat
                  label="Cache"
                  value={stats.fromCache ? "HIT" : "MISS"}
                  hint={`build ${stats.buildMs}ms`}
                  good={stats.fromCache}
                />
                <Stat
                  label="Length"
                  value={`${(stats.length / 1000).toFixed(1)}K`}
                  hint={`${stats.wordCount.toLocaleString()} words`}
                />
                <Stat
                  label="Tokens (est)"
                  value={`~${(stats.tokenEstimate / 1000).toFixed(1)}K`}
                  hint={`limit ${(stats.maxSystemChars / 1000).toFixed(0)}K chars`}
                />
                <Stat
                  label="Truncation"
                  value={stats.truncated ? "YES" : "NO"}
                  hint={
                    stats.truncated
                      ? `cut at ${stats.truncatedAt?.toLocaleString()}`
                      : "fits cleanly"
                  }
                  bad={stats.truncated}
                />
              </div>

              {stats.truncated && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-[11px] text-amber-300">
                    <p className="font-bold">System prompt is being truncated.</p>
                    <p className="text-amber-300/70 mt-0.5">
                      {stats.length.toLocaleString()} chars built, but the{" "}
                      {stats.provider} limit is{" "}
                      {stats.maxSystemChars.toLocaleString()}. Nick is only
                      seeing the first {stats.effectiveLength.toLocaleString()}{" "}
                      chars. The older memory sections are being dropped.
                    </p>
                  </div>
                </div>
              )}

              {/* Preview */}
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                  First 2K chars (head)
                </p>
                <pre className="text-[10px] leading-[1.5] font-mono text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {stats.preview}
                </pre>
              </div>

              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                  Last 1K chars (tail)
                </p>
                <pre className="text-[10px] leading-[1.5] font-mono text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {stats.tail}
                </pre>
              </div>

              {stats.fromCache && (
                <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                  <CheckCircle2 size={11} className="text-emerald-400" />
                  Served from local cache — click FRESH to rebuild from source
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  good,
  bad,
}: {
  label: string;
  value: string;
  hint: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        bad
          ? "border-red-500/30 bg-red-500/5"
          : good
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-[var(--border-default)] bg-[var(--bg-elevated)]"
      )}
    >
      <p className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </p>
      <p
        className={cn(
          "text-[13px] font-bold tabular-nums mt-0.5",
          bad
            ? "text-red-400"
            : good
            ? "text-emerald-400"
            : "text-[var(--text-primary)]"
        )}
      >
        {value}
      </p>
      <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5">{hint}</p>
    </div>
  );
}
