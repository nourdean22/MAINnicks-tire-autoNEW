"use client";

import { useState, useMemo, useId, useCallback } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { ConfirmHold } from "@/components/ui/confirm-hold";
import { Brain, Sliders, Shield, AlertTriangle, Search, Info } from "lucide-react";
import { haptic } from "@/lib/ui/haptic";
import { trpc } from "@/lib/trpc/client";

interface ResolvedFlag {
  key: string;
  description: string;
  status: "experimental" | "canary" | "stable" | "deprecated";
  onValue: string;
  defaultBehavior: string;
  ownerDoc?: string;
  rawValue: string;
  isOn: boolean;
  overrideValue?: string | null;
}

const HIGH_RISK_FLAGS = new Set(["NICK_AUTONOMY", "NICK_CONFIDENCE_TIER"]);

export function IntelligenceFlagsPanel() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  // Use tRPC to query the current flags state
  const { data, isLoading, refetch } = trpc.operator.featureFlags.useQuery(undefined, {
    refetchInterval: 10_000, // auto-refresh every 10s
  });

  const setOverrideMutation = trpc.operator.setFeatureFlagOverride.useMutation();

  const flags = useMemo(() => {
    return (data?.flags as ResolvedFlag[]) ?? [];
  }, [data]);

  // Filter flags based on search and status
  const filteredFlags = useMemo(() => {
    return flags.filter((f) => {
      const matchesSearch = 
        f.key.toLowerCase().includes(search.toLowerCase()) ||
        f.description.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || f.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [flags, search, statusFilter]);

  const handleOverride = useCallback(
    async (key: string, value: "true" | "false" | null) => {
      haptic.select();
      try {
        await setOverrideMutation.mutateAsync({ key, value });
        haptic.success();
        refetch();
      } catch (err) {
        haptic.error();
        console.error("Failed to update feature flag override:", err);
      }
    },
    [setOverrideMutation, refetch]
  );

  if (isLoading) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)] animate-pulse">Loading intelligence flags...</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="space-y-4">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-default)]/40 pb-3">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-[var(--gold)]" />
          <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
            Cognitive & Autonomy Substrates
          </span>
        </div>
        <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-wider font-mono">
          {flags.filter(f => f.isOn).length} Active / {flags.length} Total
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
        Live-control Nick's experimental reasoning engines, recall multipliers, and background autonomy levels. 
        Overrides bypass current Railway environment configurations instantly.
      </p>

      {/* Filters & Search Row */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flags (e.g. autonomy, recall)..."
            className="w-full h-8 pl-8 pr-3 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--gold)]/40 outline-none"
          />
        </div>
        {/* Status Filter */}
        <div className="flex items-center gap-0.5 rounded-md border border-[var(--border-default)] p-0.5 bg-[var(--bg-elevated)] self-start sm:self-auto">
          {["all", "stable", "canary", "experimental"].map((s) => (
            <button
              key={s}
              onClick={() => {
                haptic.select();
                setStatusFilter(s);
              }}
              className={cn(
                "px-2 h-6 text-[9px] font-bold uppercase tracking-wider rounded transition-colors",
                statusFilter === s
                  ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Flag List */}
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
        {filteredFlags.length > 0 ? (
          filteredFlags.map((flag) => {
            const isHighRisk = HIGH_RISK_FLAGS.has(flag.key);
            const overrideState = flag.overrideValue === "true" ? "ON" : flag.overrideValue === "false" ? "OFF" : "ENV";
            
            return (
              <div 
                key={flag.key}
                className="flex flex-col md:flex-row md:items-center justify-between p-3 rounded-lg border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/20 gap-3 hover:bg-[var(--bg-elevated)]/40 transition-colors"
              >
                {/* Left Side: Meta & Info */}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Indicator */}
                    <span 
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        flag.isOn ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)] animate-pulse" : "bg-zinc-600"
                      )}
                    />
                    {/* Name */}
                    <span className="font-mono text-[11px] font-bold text-[var(--text-primary)]">
                      {flag.key}
                    </span>
                    {/* Lifecycle Badge */}
                    <span 
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider",
                        flag.status === "stable" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" :
                        flag.status === "canary" ? "bg-blue-500/10 border border-blue-500/20 text-blue-400" :
                        flag.status === "experimental" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" :
                        "bg-red-500/10 border border-red-500/20 text-red-400"
                      )}
                    >
                      {flag.status}
                    </span>
                    {/* High Risk warning badge */}
                    {isHighRisk && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-500/15 border border-red-500/25 text-red-400 uppercase tracking-wider">
                        <AlertTriangle size={8} /> High Risk
                      </span>
                    )}
                  </div>
                  {/* Description */}
                  <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                    {flag.description}
                  </p>
                  {/* Default env behavior info */}
                  <div className="flex items-start gap-1 text-[9px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)]/30 p-1.5 rounded border border-[var(--border-default)]/20">
                    <Info size={9} className="mt-0.5 shrink-0" />
                    <span><strong>Default behaviour:</strong> {flag.defaultBehavior}</span>
                  </div>
                </div>

                {/* Right Side: Override Controls */}
                <div className="shrink-0 flex items-center gap-2 self-end md:self-center">
                  {/* If override is ENV, value is null. If ON, value is true. If OFF, value is false */}
                  <div className="flex items-center gap-0.5 rounded-md border border-[var(--border-default)] p-0.5 bg-[var(--bg-elevated)]">
                    {/* DEFAULT button */}
                    <button
                      onClick={() => handleOverride(flag.key, null)}
                      className={cn(
                        "px-2 h-6 text-[8px] font-bold uppercase tracking-wider rounded transition-colors",
                        overrideState === "ENV"
                          ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                      )}
                    >
                      Default
                    </button>

                    {/* FORCE OFF button */}
                    <button
                      onClick={() => handleOverride(flag.key, "false")}
                      className={cn(
                        "px-2 h-6 text-[8px] font-bold uppercase tracking-wider rounded transition-colors",
                        overrideState === "OFF"
                          ? "bg-red-500/20 text-red-400"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                      )}
                    >
                      Force OFF
                    </button>

                    {/* FORCE ON button (non-high risk only) */}
                    {!isHighRisk && (
                      <button
                        onClick={() => handleOverride(flag.key, "true")}
                        className={cn(
                          "px-2 h-6 text-[8px] font-bold uppercase tracking-wider rounded transition-colors",
                          overrideState === "ON"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        )}
                      >
                        Force ON
                      </button>
                    )}
                  </div>

                  {/* For High-Risk flags forced ON, render ConfirmHold */}
                  {isHighRisk && (
                    <div className="flex items-center">
                      {overrideState === "ON" ? (
                        <span className="text-[9px] font-bold uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-md">
                          FORCED ON
                        </span>
                      ) : (
                        <ConfirmHold
                          label="Force ON"
                          onConfirm={() => handleOverride(flag.key, "true")}
                          variant="danger"
                          icon={<Shield size={10} />}
                          className="h-7 px-2.5"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-6 text-[11px] text-[var(--text-tertiary)]">
            No feature flags found matching "{search}"
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border-default)]/40 last:border-b-0">
      <label id={labelId} className="text-[11px] text-[var(--text-secondary)]">{label}</label>
      <div role="group" aria-labelledby={labelId} className="flex items-center gap-2">{children}</div>
    </div>
  );
}
