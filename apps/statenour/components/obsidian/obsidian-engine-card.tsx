"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Copy, FileText, RotateCw, ShieldAlert, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ObsidianEngineStatus } from "@/lib/obsidian/types";

const HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

function ageLabel(value: string | null | undefined): string {
  if (!value) return "never";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const ageMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ObsidianEngineCard() {
  const [status, setStatus] = useState<ObsidianEngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/obsidian/status", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Failed to load Obsidian status");
      }
      const next = payload?.ok === true ? payload.data : payload;
      setStatus(next || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const fetchInterval = setInterval(fetchStatus, 30_000);
    const clockInterval = setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      clearInterval(fetchInterval);
      clearInterval(clockInterval);
    };
  }, []);

  const derived = useMemo(() => {
    if (!status) return null;
    const heartbeatAt = status.daemonHeartbeatAt ? Date.parse(status.daemonHeartbeatAt) : NaN;
    const syncAt = status.lastSuccessfulSyncAt ? Date.parse(status.lastSuccessfulSyncAt) : NaN;
    const daemonOnline = Number.isFinite(heartbeatAt) && clock - heartbeatAt <= HEARTBEAT_STALE_MS;
    const syncFresh = Number.isFinite(syncAt) && clock - syncAt <= SYNC_STALE_MS;

    if (status.runState === "running") {
      return { state: "running" as const, label: "sync running", daemonOnline, syncFresh };
    }
    if (status.health === "error" || status.runState === "failed") {
      return { state: "error" as const, label: "last run failed", daemonOnline, syncFresh };
    }
    if (!status.lastSuccessfulSyncAt) {
      return { state: "degraded" as const, label: "not initialized", daemonOnline, syncFresh };
    }
    if (!syncFresh) {
      return { state: "degraded" as const, label: "sync stale", daemonOnline, syncFresh };
    }
    return { state: "healthy" as const, label: daemonOnline ? "local bridge online" : "last sync healthy", daemonOnline, syncFresh };
  }, [clock, status]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (loading && !status) {
    return (
      <div className="h-48 rounded-2xl border border-glass bg-elevated animate-pulse flex items-center justify-center">
        <span className="text-[11px] font-mono text-fg-secondary uppercase tracking-widest">Loading Obsidian bridge status...</span>
      </div>
    );
  }

  if (!status) {
    return (
      <section className="rounded-2xl border border-rose-500/20 bg-elevated p-5">
        <p className="text-xs font-mono text-rose-400">Obsidian status unavailable{error ? `: ${error}` : "."}</p>
      </section>
    );
  }

  const state = derived?.state ?? "degraded";
  const badgeClass = state === "healthy"
    ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
    : state === "error"
      ? "text-rose-400 border-rose-500/20 bg-rose-500/5"
      : "text-amber-400 border-amber-500/20 bg-amber-500/5";
  const dotClass = state === "healthy" ? "bg-emerald-500" : state === "error" ? "bg-rose-500" : "bg-amber-500";

  return (
    <section className="group relative overflow-hidden rounded-2xl border border-glass bg-elevated p-5 shadow-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-glass pb-4 gap-3">
        <div className="space-y-1">
          <span className="text-[10px] text-fg-secondary font-mono uppercase tracking-wider flex items-center gap-1.5">
            <FileText size={12} className="text-purple-400/70" />
            Obsidian local knowledge bridge
          </span>
          <p className="text-[10px] text-fg-secondary">Local vault ↔ canonical Statenour BrainMemory</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[9px] font-mono uppercase tracking-wider", badgeClass)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", dotClass, state === "running" && "animate-pulse")} />
            {derived?.label ?? "unknown"}
          </span>
          <button onClick={() => { setRefreshing(true); fetchStatus(); }} disabled={refreshing} className="text-fg-secondary hover:text-fg p-1" aria-label="Refresh Obsidian status">
            <RotateCw size={13} className={cn(refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ["Vault notes", status.stats.totalNotes],
          ["Last run synced", status.stats.synced],
          ["Quarantined", status.stats.quarantined],
          ["Failures", status.stats.failures],
        ].map(([label, value]) => (
          <div key={String(label)} className="p-2.5 rounded border border-glass bg-raised">
            <span className="text-[8px] font-mono uppercase tracking-wider text-fg-secondary block mb-1">{label}</span>
            <span className="text-lg font-semibold text-fg font-mono">{value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-mono">
        <div className="rounded border border-glass bg-raised p-2"><span className="text-fg-secondary block">Full sync</span><span className="text-fg">{ageLabel(status.lastSuccessfulSyncAt)}</span></div>
        <div className="rounded border border-glass bg-raised p-2"><span className="text-fg-secondary block">Daemon heartbeat</span><span className="text-fg">{derived?.daemonOnline ? ageLabel(status.daemonHeartbeatAt) : "offline / stale"}</span></div>
        <div className="rounded border border-glass bg-raised p-2"><span className="text-fg-secondary block">Run state</span><span className="text-fg">{status.runState ?? "legacy status"}</span></div>
      </div>

      {(status.issues.length > 0 || status.quarantinedFiles.length > 0 || error) && (
        <div className="space-y-2 border-t border-glass pt-3">
          <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400">Requires attention</span>
          {error && <p className="text-[10px] text-rose-400">Refresh error: {error}</p>}
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {status.issues.map((issue, index) => (
              <div key={`${issue.detected_at}-${index}`} className="p-2 rounded border border-rose-500/10 bg-rose-500/[0.02] text-[11px]">
                <div className="flex items-start gap-1.5"><ShieldAlert size={12} className="text-rose-400 shrink-0 mt-0.5" /><div><p className="font-semibold text-fg">{issue.message}</p>{issue.suggested_fix && <p className="text-[10px] text-amber-400 mt-1">{issue.suggested_fix}</p>}</div></div>
              </div>
            ))}
            {status.quarantinedFiles.map((file, index) => (
              <div key={`${file.relativePath}-${index}`} className="p-2 rounded border border-amber-500/10 bg-amber-500/[0.02] text-[11px]">
                <div className="flex items-start gap-1.5"><Ban size={12} className="text-amber-400 shrink-0 mt-0.5" /><div><p className="font-semibold text-fg">Quarantined: {file.filename}</p><p className="text-[9px] text-fg-secondary">{file.reason}</p></div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-glass pt-3 space-y-2">
        <span className="text-[8px] font-mono uppercase tracking-wider text-fg-secondary">Local controls</span>
        {[
          ["Run full sync", "pnpm obsidian:sync"],
          ["Start watch daemon", "pnpm obsidian:watch"],
        ].map(([label, command]) => (
          <div key={command} className="flex items-center justify-between gap-3 p-1.5 rounded border border-glass bg-raised font-mono text-[10px]">
            <div className="flex items-center gap-1.5 truncate text-fg"><Terminal size={10} className="text-fg-secondary shrink-0" /><span className="text-fg-secondary shrink-0">{label}:</span><span className="truncate">{command}</span></div>
            <button onClick={() => handleCopy(command)} className="shrink-0 p-1 hover:bg-white/10 rounded text-fg-secondary" aria-label={`Copy ${command}`}>
              {copiedText === command ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
