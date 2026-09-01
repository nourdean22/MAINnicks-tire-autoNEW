"use client";

// FRESHNESS_EXEMPT — config form (mutates settings, doesn't display
// time-sensitive read data; live values reload immediately on change).

/**
 * AiSettingsPanel — the AI power + cold memory surface on /settings.
 *
 * Packages items #11 (global live settings), #13 (tool opt-in/out),
 * and #16 (cold memory card) into one cohesive section on the
 * Settings page. Each card writes to its own endpoint:
 *
 *   /api/settings/ai-config    — AI config GET/PATCH/DELETE
 *   trpc.operator.syncDrive            — POST manual sync / GET stats
 *
 * Live mutation pattern: every slider / toggle fires PATCH with the
 * single field, the server merges + writes to brain_memory row, the
 * cache invalidates, the next chat request picks up the new value.
 */

import { useState, useEffect, useCallback, useId } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { ConfirmHold } from "@/components/ui/confirm-hold";
import {
  Cpu,
  RefreshCw,
  Database,
  Sliders,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { haptic } from "@/lib/ui/haptic";
import { SegmentedSelect, Toggle } from "./settings-controls";

import { trpc } from "@/lib/trpc/client";
import { onDataChanged } from "@/lib/events/data-change";
// Phase UU.2 · the provider / mode / reasoning / web-search fields are
// narrowed to the same unions the operator.updateAiConfig input enforces
// (was `string`). The panel always passes correctly-narrowed values
// already — tightening the interface lets `Partial<AiConfig>` flow into
// the typed mutation with no cast, and is the typed-payload-mismatch
// guard at the call-site type level.
interface AiConfig {
  defaultProvider?: "gemini" | "ollama" | "openai" | "anthropic" | "openrouter" | "emergency";
  defaultMode?: "standard" | "deep";
  defaultTaskType?:
    | "fast"
    | "reason"
    | "deep"
    | "vision"
    | "embed"
    | "code"
    | "sql"
    | "math"
    | "creative"
    | "summary"
    | "classify"
    | "extract";
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "max";
  webSearch?: "auto" | "on" | "off";
  webScraping?: boolean;
  disabledTools?: string[];
  alwaysOnTools?: string[];
  showSpeedRibbon?: boolean;
  hapticFeedback?: boolean;
  promptCacheTtlMs?: number;
  toolEmbeddingsEnabled?: boolean;
  maxSystemChars?: number;
}

interface ColdMemoryStats {
  totalBrainMemories: number;
  driveIngested: number;
  embeddingCoverage: number;
  lastDriveSync: string | null;
  categories: Record<string, number>;
}

export function AiSettingsPanel() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [stats, setStats] = useState<ColdMemoryStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [disabledTool, setDisabledTool] = useState("");
  // A failed config load used to leave the panel on "loading…" forever —
  // silent failure is indistinguishable from slow. Named error instead.
  const [configError, setConfigError] = useState(false);
  // Per-device toggles read their real store (localStorage) — the DB copy
  // had no reader and lied on any second device. Lazy init is guarded for
  // the server render, where window is absent.
  const [hapticOn, setHapticOn] = useState(() => {
    try {
      if (typeof window === "undefined") return true;
      return localStorage.getItem("nour:haptic-enabled") !== "0";
    } catch {
      return true;
    }
  });
  const [speedRibbonOn, setSpeedRibbonOn] = useState(() => {
    try {
      if (typeof window === "undefined") return false;
      return localStorage.getItem("nour:chat:speed-ribbon") === "1";
    } catch {
      return false;
    }
  });

  // Phase UU.2 (2026-05-22) · REST→tRPC · config + cold-memory stats
  // stay in local state (the panel mutates `config` optimistically on
  // every slider/toggle, so it can't be a raw query result). The
  // initial load + the data-change-bus refresh are imperative reads
  // via utils.*.fetch(); writes are typed mutations.
  const utils = trpc.useUtils();

  const loadConfig = useCallback(async () => {
    try {
      setConfig((await utils.operator.aiConfig.fetch()) as AiConfig);
      setConfigError(false);
    } catch {
      setConfigError(true);
    }
  }, [utils]);

  const loadStats = useCallback(async () => {
    try {
      setStats((await utils.operator.coldMemoryStats.fetch()) as ColdMemoryStats);
    } catch {}
  }, [utils]);

  useEffect(() => {
    loadConfig();
    loadStats();
  }, [loadConfig, loadStats]);

  const updateConfigMutation = trpc.operator.updateAiConfig.useMutation();
  const resetConfigMutation = trpc.operator.resetAiConfig.useMutation();
  const syncDriveMutation = trpc.operator.syncDrive.useMutation();

  // v10.0.529.87 · Wave 31 · subscribe to "settings" domain so a
  // chat-triggered syncDriveMemory refreshes the Cold Memory card
  // without the operator having to reload /settings. Pre-Wave-31
  // Nick could sync Drive via chat and this panel showed stale
  // totalBrainMemories / driveIngested / lastDriveSync until manual
  // refresh.
  useEffect(() => {
    return onDataChanged(["settings"], () => {
      loadStats();
    });
  }, [loadStats]);

  // Partial update helper — debounced feel by setting local state
  // optimistically then firing the typed mutation in the background.
  // updateAiConfig validates the patch against the SHARED
  // aiConfigPatchSchema (every field strictly typed) — the
  // typed-payload-mismatch guard — and returns the merged config.
  const patch = useCallback(
    async (p: Partial<AiConfig>) => {
      setConfig((c) => ({ ...c, ...p }));
      haptic.tap();
      try {
        const updated = await updateConfigMutation.mutateAsync(p);
        setConfig(updated as AiConfig);
        haptic.success();
      } catch {
        haptic.error();
      }
    },
    [updateConfigMutation],
  );

  const reset = useCallback(async () => {
    haptic.warn();
    try {
      const reseted = await resetConfigMutation.mutateAsync();
      setConfig(reseted as AiConfig);
      haptic.success();
    } catch {
      haptic.error();
    }
  }, [resetConfigMutation]);

  const syncDrive = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    haptic.start();
    try {
      const data = await syncDriveMutation.mutateAsync({ actor: "user_sync" });
      if (data.ok || data.stored != null) {
        haptic.success();
        setSyncResult(
          data.hint ||
            `Synced: ${data.stored ?? 0} new, ${data.skippedCount ?? 0} skipped, ${((data.durationMs ?? 0) / 1000).toFixed(1)}s`,
        );
      } else {
        haptic.error();
        // DriveIngestResult carries the failure message in `reason`;
        // a thrown error lands in the catch below (not here).
        setSyncResult(data.reason || "sync failed");
      }
      await loadStats();
    } catch (err) {
      haptic.error();
      setSyncResult(err instanceof Error ? err.message : "sync failed");
    }
    setSyncing(false);
    setTimeout(() => setSyncResult(null), 6000);
  }, [loadStats, syncDriveMutation]);

  const addDisabledTool = useCallback(() => {
    const t = disabledTool.trim();
    if (!t) return;
    const list = config?.disabledTools || [];
    if (list.includes(t)) return;
    patch({ disabledTools: [...list, t] });
    setDisabledTool("");
  }, [disabledTool, config, patch]);

  const removeDisabledTool = useCallback(
    (t: string) => {
      const list = config?.disabledTools || [];
      patch({ disabledTools: list.filter((x) => x !== t) });
    },
    [config, patch]
  );

  if (!config) {
    return (
      <GlassCard>
        {configError ? (
          <div className="flex items-center gap-3">
            <p role="alert" className="text-[11px] text-rose-300/90">
              AI config unreadable — the read failed. State unknown, not defaults.
            </p>
            <button
              type="button"
              onClick={() => void loadConfig()}
              className="rounded border border-[var(--border-default)] px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] hover:text-[var(--text-primary)] min-h-[44px]"
            >
              retry
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-[var(--text-tertiary)]">loading…</p>
        )}
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Cold Memory Card (#16) ── */}
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Database size={13} className="text-[var(--gold)]" />
            <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              Cold Memory
            </span>
          </div>
          <button
            onClick={syncDrive}
            disabled={syncing}
            className="flex items-center gap-1 px-2.5 h-7 rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/40 text-[10px] font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={cn(syncing && "animate-spin")} />
            {syncing ? "SYNCING…" : "SYNC NOW"}
          </button>
        </div>

        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Total memories" value={stats.totalBrainMemories.toLocaleString()} />
            <Stat label="Drive ingested" value={stats.driveIngested.toLocaleString()} />
            <Stat
              label="Embed coverage"
              value={`${(stats.embeddingCoverage * 100).toFixed(0)}%`}
            />
            <Stat
              label="Last sync"
              value={stats.lastDriveSync ? formatAgo(stats.lastDriveSync) : "never"}
            />
          </div>
        ) : (
          <p className="text-[11px] text-[var(--text-tertiary)]">loading…</p>
        )}

        {syncResult && (
          <div className="mt-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-default)]">
            <p className="text-[10px] text-[var(--text-secondary)]">{syncResult}</p>
          </div>
        )}

        <p className="text-[9px] text-[var(--text-tertiary)] mt-2">
          Nick reaches into this via the <code>searchColdMemory</code> tool. Sync
          pulls the 25 most recently-modified Drive docs and embeds them for
          semantic search.
        </p>
      </GlassCard>

      {/* ── AI Config — live-mutable chat controls (#11) ── */}
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sliders size={13} className="text-[var(--gold)]" />
            <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              AI Config — Live
            </span>
          </div>
          <ConfirmHold
            label="Reset"
            variant="danger"
            icon={<RotateCcw size={10} />}
            onConfirm={reset}
          />
        </div>

        {/* 2026-09-01 settings audit: Default Provider, Temperature,
            Reasoning Effort, AI Web Search and Semantic Tool Pruning were
            REMOVED — each wrote a config field with ZERO runtime readers
            (provider/temperature/effort/search are decided per turn by
            classifyTurn + the provider chain; pruneTools never consulted
            toolEmbeddingsEnabled). A control that writes to nothing is a
            lie with a nice label. Wire a reader before resurfacing any of
            them. Survivors below are the fields the runtime actually reads:
            defaultMode (derive-turn-signals) + disabledTools (prepare-tools). */}

        {/* Default mode */}
        <Row label="Default Mode">
          <SegmentedSelect
            value={config.defaultMode || "auto"}
            options={["auto", "standard", "deep"]}
            onChange={(v) =>
              patch({
                defaultMode:
                  v === "auto" ? undefined : (v as "standard" | "deep"),
              })
            }
          />
        </Row>

        {/* Device toggles — localStorage is the ONLY store (the old dual
            DB write had no reader and made a second device's switch lie). */}
        <Row label="Haptic Feedback">
          <Toggle
            value={hapticOn}
            onChange={(v) => {
              haptic.setEnabled(v);
              setHapticOn(v);
            }}
          />
        </Row>
        <Row label="Speed Ribbon (per-message timing)">
          <Toggle
            value={speedRibbonOn}
            onChange={(v) => {
              try {
                localStorage.setItem("nour:chat:speed-ribbon", v ? "1" : "0");
              } catch {}
              setSpeedRibbonOn(v);
            }}
          />
        </Row>
        <p className="mt-1 text-[9px] text-[var(--text-tertiary)]">
          These two are per-device (stored in this browser).
        </p>
      </GlassCard>

      {/* ── Tool Opt-in / Opt-out (#13) ── */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={13} className="text-[var(--gold)]" />
          <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
            Tool Blocklist
          </span>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
          Tools listed here are NEVER loaded regardless of mode. Use for tools
          you never use or that are actively broken. Enter the exact tool name.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            value={disabledTool}
            onChange={(e) => setDisabledTool(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDisabledTool()}
            aria-label="Tool name to add to blocklist"
            placeholder="e.g. generateImage"
            className="flex-1 h-8 px-2 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--gold)]/40 outline-none font-mono"
          />
          <button
            onClick={addDisabledTool}
            className="px-3 h-8 rounded bg-[var(--gold)]/10 border border-[var(--gold)]/40 text-[10px] font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-colors"
          >
            DISABLE
          </button>
        </div>
        {(config.disabledTools?.length || 0) > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {config.disabledTools!.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-[10px] font-mono text-red-300"
              >
                {t}
                <button
                  onClick={() => removeDisabledTool(t)}
                  className="text-red-300/60 hover:text-red-300"
                  aria-label={`Remove ${t}`}
                >
                  <Trash2 size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-[var(--text-tertiary)]">No tools disabled.</p>
        )}
      </GlassCard>
    </div>
  );
}

// ── Helper components ──

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  // a11y (WCAG 1.3.1/4.1.2): controls here are heterogeneous (button groups,
  // role=switch toggles, native range/select). A single htmlFor can't name a
  // button group, so we give the label an id and expose the control container
  // as a named group via aria-labelledby — every control inherits the name.
  const labelId = useId();
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border-default)]/40 last:border-b-0">
      <label id={labelId} className="text-[11px] text-[var(--text-secondary)]">{label}</label>
      <div role="group" aria-labelledby={labelId} className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1.5">
      <p className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="text-[13px] font-bold tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
