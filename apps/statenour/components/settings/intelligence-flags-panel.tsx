"use client";

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { ConfirmHold } from "@/components/ui/confirm-hold";
import { Brain, Shield, AlertTriangle, Search, Info } from "lucide-react";
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
  readOnly?: boolean;
}

const HIGH_RISK_FLAGS = new Set(["NICK_AUTONOMY", "NICK_CONFIDENCE_TIER"]);

export function IntelligenceFlagsPanel() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Persist-vs-apply honesty: the mutation reports whether the runtime
  // actually reloaded the override cache. Saved-but-not-applied must never
  // read as success (2026-09-01 audit — the panel used to discard it).
  const [applyNotice, setApplyNotice] = useState<string | null>(null);

  // Flags change on operator action, not by themselves — 10s polling was
  // the whole registry's payload every tick for nothing. 60s + focus refetch.
  const { data, isLoading, refetch } = trpc.operator.featureFlags.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
        const res = await setOverrideMutation.mutateAsync({ key, value });
        // "Persistence and activation are DIFFERENT facts" — the router
        // says so and returns both. Honor the distinction.
        if (res?.runtimeApplied === false) {
          haptic.warn();
          setApplyNotice(
            `${key}: saved, but NOT yet live — ${res.runtimeReason ?? "runtime cache did not reload"}. Other instances converge within ~30s.`,
          );
        } else {
          haptic.success();
          setApplyNotice(null);
        }
        refetch();
      } catch (err) {
        haptic.error();
        setApplyNotice(`${key}: save failed — nothing changed.`);
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
      <div className="flex items-center justify-between border-b border-edge-subtle pb-3">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-fg-tertiary" />
          <span className="text-[15px] font-semibold text-fg">
            Cognitive & autonomy substrates
          </span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          {flags.filter(f => f.isOn).length} Active / {flags.length} Total
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
        Live-control Nick&apos;s reasoning engines, recall multipliers, and background autonomy levels.
        Overrides apply within ~30s. Flags marked ENV ONLY are read straight from the environment
        at boot — change those in Railway, not here.
      </p>

      {applyNotice && (
        <p role="alert" className="rounded-control border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-200/90">
          {applyNotice}
        </p>
      )}

      {/* Filters & Search Row */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="text"
            aria-label="Search feature flags"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flags (e.g. autonomy, recall)..."
            className="w-full h-8 pl-8 pr-3 rounded-control border border-edge-default bg-content text-[13px] text-fg placeholder:text-fg-tertiary focus:border-accent outline-none"
          />
        </div>
        {/* Status Filter */}
        <div className="flex items-center gap-0.5 rounded-control border border-edge-default p-0.5 bg-surface-raised self-start sm:self-auto">
          {["all", "stable", "canary", "experimental"].map((s) => (
            <button
              key={s}
              aria-pressed={statusFilter === s}
              onClick={() => {
                haptic.select();
                setStatusFilter(s);
              }}
              className={cn(
                "px-2 h-6 text-[11px] font-medium rounded-micro transition-colors duration-[var(--motion-state)]",
                statusFilter === s
                  ? "bg-accent-soft text-fg"
                  : "text-fg-tertiary hover:text-fg-secondary"
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
            const isReadOnly = flag.readOnly === true;
            const overrideState = flag.overrideValue === "true" ? "ON" : flag.overrideValue === "false" ? "OFF" : "ENV";
            
            return (
              <div 
                key={flag.key}
                className="flex flex-col md:flex-row md:items-center justify-between p-3 rounded-control border border-edge-subtle bg-surface-interactive gap-3 hover:bg-surface-hover transition-colors duration-[var(--motion-state)]"
              >
                {/* Left Side: Meta & Info */}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Indicator */}
                    <span 
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        flag.isOn ? "bg-emerald-400" : "bg-edge-strong"
                      )}
                    />
                    {/* Name */}
                    <span className="font-mono text-[11px] font-bold text-[var(--text-primary)]">
                      {flag.key}
                    </span>
                    {/* Lifecycle Badge */}
                    <span 
                      className={cn(
                        "px-1.5 py-0.5 rounded-micro font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
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
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-micro font-mono text-[11px] font-medium bg-red-500/15 border border-red-500/25 text-red-400 uppercase tracking-[0.12em]">
                        <AlertTriangle size={8} /> High Risk
                      </span>
                    )}
                  </div>
                  {/* Description */}
                  <p className="text-[12px] text-fg-secondary leading-relaxed">
                    {flag.description}
                  </p>
                  {/* Default env behavior info */}
                  <div className="flex items-start gap-1 text-[11px] text-fg-tertiary bg-surface-raised p-1.5 rounded-control border border-edge-subtle">
                    <Info size={9} className="mt-0.5 shrink-0" />
                    <span><strong>Default behaviour:</strong> {flag.defaultBehavior}</span>
                  </div>
                  {isReadOnly && (
                    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300/80">
                      Environment-controlled · read-only here
                    </p>
                  )}
                </div>

                {/* Right Side: Override Controls */}
                <div className="shrink-0 flex items-center gap-2 self-end md:self-center">
                  {isReadOnly ? (
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                      ENV ONLY
                    </span>
                  ) : (
                  <>
                  {/* If override is ENV, value is null. If ON, value is true. If OFF, value is false */}
                  <div className="flex items-center gap-0.5 rounded-control border border-edge-default p-0.5 bg-surface-raised">
                    {/* DEFAULT button */}
                    <button
                      onClick={() => handleOverride(flag.key, null)}
                      aria-pressed={overrideState === "ENV"}
                      className={cn(
                        "px-2 h-6 text-[11px] font-medium rounded-micro transition-colors duration-[var(--motion-state)]",
                        overrideState === "ENV"
                          ? "bg-accent-soft text-fg"
                          : "text-fg-tertiary hover:text-fg-secondary"
                      )}
                    >
                      Default
                    </button>

                    {/* FORCE OFF button */}
                    <button
                      onClick={() => handleOverride(flag.key, "false")}
                      aria-pressed={overrideState === "OFF"}
                      className={cn(
                        "px-2 h-6 text-[11px] font-medium rounded-micro transition-colors duration-[var(--motion-state)]",
                        overrideState === "OFF"
                          ? "bg-red-500/20 text-red-400"
                          : "text-fg-tertiary hover:text-fg-secondary"
                      )}
                    >
                      Force OFF
                    </button>

                    {/* FORCE ON button (non-high risk only) */}
                    {!isHighRisk && (
                      <button
                        onClick={() => handleOverride(flag.key, "true")}
                        aria-pressed={overrideState === "ON"}
                        className={cn(
                          "px-2 h-6 text-[11px] font-medium rounded-micro transition-colors duration-[var(--motion-state)]",
                          overrideState === "ON"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "text-fg-tertiary hover:text-fg-secondary"
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
                        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-control">
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
                  </>
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
