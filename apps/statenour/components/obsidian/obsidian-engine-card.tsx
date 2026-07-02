"use client";

import { useEffect, useState } from "react";
import { Terminal, Copy, Check, RotateCw, ShieldAlert, FileText, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface EngineIssue {
  type: "FAIL" | "WARN";
  message: string;
  file?: string;
  detected_at: string;
  suggested_fix?: string;
}

interface QuarantinedFileInfo {
  filename: string;
  relativePath: string;
  reason: string;
  detected_at: string;
  suggested_fix?: string;
}

interface ObsidianEngineStatus {
  health: "healthy" | "degraded" | "error";
  lastRunAt: string | null;
  lastDoctorRunAt: string | null;
  lastIngestRunAt: string | null;
  lastExportRunAt: string | null;
  stats: {
    totalNotes: number;
    processed: number;
    synced: number;
    skipped: number;
    failed: number;
    quarantined: number;
    warnings: number;
    failures: number;
  };
  issues: EngineIssue[];
  quarantinedFiles: QuarantinedFileInfo[];
  config: {
    vaultPath: string;
    icloudShortcutsPath: string | null;
    syncMode: string;
    restUrl: string | null;
  };
}

export function ObsidianEngineCard() {
  const [status, setStatus] = useState<ObsidianEngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/obsidian/status");
      if (!res.ok) throw new Error("Failed to load status");
      const data = await res.json();
      
      // Handle Next.js apiHandler response envelope
      if (data && typeof data === "object" && "ok" in data) {
        if (data.ok) {
          setStatus(data.data || null);
          setError(null);
        } else {
          throw new Error(data.error || "Failed to load status");
        }
      } else {
        setStatus(data);
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStatus();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (loading && !status) {
    return (
      <div className="h-48 rounded-xl border border-white/10 bg-white/[0.02] animate-pulse flex items-center justify-center">
        <span className="text-[11px] font-mono text-white/40 uppercase tracking-widest">Loading Obsidian Engine Status...</span>
      </div>
    );
  }

  const engine = status;
  if (!engine) return null;

  const pulseColors = {
    healthy: "bg-emerald-500 shadow-emerald-500/50",
    degraded: "bg-amber-500 shadow-amber-500/50",
    error: "bg-rose-500 shadow-rose-500/50",
  };

  const statusLabel = {
    healthy: "calm · online",
    degraded: "warnings · check logs",
    error: "alert · engine halted",
  };

  const currentHealth = engine.health || "degraded";
  const pulseColor = pulseColors[currentHealth as keyof typeof pulseColors] || pulseColors.degraded;
  const label = statusLabel[currentHealth as keyof typeof statusLabel] || statusLabel.degraded;

  return (
    <section className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-950 via-zinc-900 to-black border border-white/10 p-5 shadow-2xl transition-all hover:border-purple-500/30 flex flex-col gap-4">
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-500/5 rounded-full blur-[60px] pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 mb-4 gap-3 relative z-10">
        <div className="flex flex-row-reverse sm:flex-row items-center justify-end sm:justify-start gap-2">
          <span className="text-[10px] text-white/45 font-mono uppercase tracking-wider flex items-center gap-1.5">
            <FileText size={12} className="text-purple-400/50" />
            Obsidian Local Engine
          </span>
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider",
            currentHealth === "healthy" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" :
            currentHealth === "degraded" ? "text-amber-400 border-amber-500/20 bg-amber-500/5" :
            "text-rose-400 border-rose-500/20 bg-rose-500/5"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full shadow-sm animate-pulse", pulseColor)} />
            {label}
          </span>
        </div>

        <button 
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-white/40 hover:text-white/80 transition-colors p-1 rounded hover:bg-white/5 disabled:opacity-50"
          aria-label="Refresh Status"
        >
          <RotateCw size={12} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-2.5 rounded border border-white/5 bg-white/[0.01] flex flex-col justify-between">
          <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 block mb-1">Total Notes</span>
          <span className="text-lg font-semibold text-white leading-tight font-mono">{engine.stats?.totalNotes ?? 0}</span>
        </div>
        <div className="p-2.5 rounded border border-white/5 bg-white/[0.01] flex flex-col justify-between">
          <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 block mb-1">Synced</span>
          <span className="text-lg font-semibold text-white leading-tight font-mono">{engine.stats?.synced ?? 0}</span>
        </div>
        <div className="p-2.5 rounded border border-white/5 bg-white/[0.01] flex flex-col justify-between">
          <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 block mb-1">Quarantined</span>
          <span className={cn(
            "text-lg font-semibold leading-tight font-mono",
            (engine.stats?.quarantined ?? 0) > 0 ? "text-amber-400" : "text-white"
          )}>
            {engine.stats?.quarantined ?? 0}
          </span>
        </div>
        <div className="p-2.5 rounded border border-white/5 bg-white/[0.01] flex flex-col justify-between">
          <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 block mb-1">Failures</span>
          <span className={cn(
            "text-lg font-semibold leading-tight font-mono",
            (engine.stats?.failures ?? 0) > 0 ? "text-rose-400" : "text-white"
          )}>
            {engine.stats?.failures ?? 0}
          </span>
        </div>
      </div>

      {/* Active issues or quarantined files list */}
      {(((engine.issues?.length ?? 0) > 0 || (engine.quarantinedFiles?.length ?? 0) > 0)) && (
        <div className="space-y-2 border-t border-white/5 pt-3">
          <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400/80 font-bold block">
            Requires Attention ({(engine.issues?.length ?? 0) + (engine.quarantinedFiles?.length ?? 0)})
          </span>

          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
            {engine.issues?.map((issue, idx) => (
              <div key={`issue-${idx}`} className="p-2 rounded border border-rose-500/10 bg-rose-500/[0.01] space-y-1 text-[11px]">
                <div className="flex items-start gap-1.5">
                  <ShieldAlert size={12} className="text-rose-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white/95 leading-tight">{issue.message}</p>
                    {issue.file && (
                      <p className="text-[9px] font-mono text-white/35 truncate mt-0.5">{issue.file}</p>
                    )}
                    {issue.suggested_fix && (
                      <div className="text-[10px] text-amber-400/90 font-mono mt-1">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-white/40 block">Suggested Fix:</span>
                        {issue.suggested_fix}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {engine.quarantinedFiles?.map((qFile, idx) => (
              <div key={`qfile-${idx}`} className="p-2 rounded border border-amber-500/10 bg-amber-500/[0.01] space-y-1 text-[11px]">
                <div className="flex items-start gap-1.5">
                  <Ban size={12} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white/95 leading-tight">Quarantined: {qFile.filename}</p>
                    <p className="text-[9px] font-mono text-white/35 truncate mt-0.5">{qFile.relativePath}</p>
                    {qFile.suggested_fix && (
                      <div className="text-[10px] text-amber-400/90 font-mono mt-1">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-white/40 block">Suggested Fix:</span>
                        {qFile.suggested_fix}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual Commands */}
      <div className="border-t border-white/5 pt-3 space-y-2">
        <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 block">
          Terminal Control <span className="text-purple-400/50">(Local CLI)</span>
        </span>
        <div className="space-y-1.5">
          {[
            { label: "run full sync", cmd: "pnpm obsidian:sync" },
            { label: "start watcher daemon", cmd: "pnpm obsidian:watch" }
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-1.5 rounded border border-white/5 bg-zinc-950/50 font-mono text-[10px]">
              <div className="flex items-center gap-1.5 truncate text-white/70">
                <Terminal size={10} className="text-white/40 shrink-0" />
                <span className="text-white/40 shrink-0">{item.label}:</span>
                <span className="text-white/90 truncate">{item.cmd}</span>
              </div>
              <button
                onClick={() => handleCopy(item.cmd)}
                className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors text-white/40 hover:text-white/80"
                aria-label="Copy Command"
              >
                {copiedText === item.cmd ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
