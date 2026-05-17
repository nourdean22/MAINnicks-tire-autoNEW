"use client";

/**
 * /system/power — master control panel (W11.3).
 *
 * Every knob the operator has in one place. Big buttons, confirm
 * modals on destructive switches, live-sync to underlying services.
 *
 * Sections:
 *  · AI — provider pin · strict mode · daily cost cap · shadow mode
 *  · Crons — pause all / resume all
 *  · Nudges — quiet mode (off / nudges off / all off)
 *  · Danger zone — links to destructive ops (reset brain, emergency stop)
 */

import { useState, useEffect, useCallback } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import type { PowerSettings, ProviderPin, QuietLevel } from "@/lib/services/power-panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { GlassCard } from "@/components/ui/glass-card";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface Feed {
  settings: PowerSettings;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function PowerPanel() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/system/power", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setFeed(json.data ?? json);
    } catch (e) {
      console.error("power panel load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function patch<K extends keyof PowerSettings>(
    key: K,
    value: PowerSettings[K],
    opts?: { confirm?: string; toastMsg?: string },
  ) {
    if (opts?.confirm && !window.confirm(opts.confirm)) return;
    setSaving(String(key));
    try {
      const res = await authedFetch("/api/system/power", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setFeed(json.data ?? json);
      toast.success(opts?.toastMsg ?? `${String(key)} updated`);
    } catch (e) {
      toast.error(`failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(null);
    }
  }

  const s = feed?.settings;

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="power"
      description={
        s
          ? s.updatedBy === "default"
            ? "master control · no custom settings yet"
            : `master control · last change ${timeAgo(s.updatedAt)} by ${s.updatedBy}`
          : "loading…"
      }
      width="lg"
      rhythm="loose"
      actions={
        <FreshnessChip
          lastFetchedAt={s?.updatedAt}
          source="db · power_panel"
          onReload={load}
        />
      }
    >

      {s && (
        <>
          {/* AI SECTION */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">AI · Nick</h2>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">provider + budget + mode</span>
            </div>

            {/* Provider pin */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-200">provider pin</span>
                <span className="text-[10px] text-zinc-500">{s.providerPin === "auto" ? "fallback chain" : `pinned · ${s.providerPin}`}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["auto", "venice", "openai", "anthropic", "gemini"] as ProviderPin[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => patch("providerPin", p)}
                    disabled={saving === "providerPin" || s.providerPin === p}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs transition",
                      s.providerPin === p
                        ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                        : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                      saving === "providerPin" && "opacity-50",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Daily cost cap */}
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-200">daily cost cap</span>
                <span className="text-[10px] text-zinc-500">
                  {s.dailyCostCapCents > 0 ? `enforced · ${dollars(s.dailyCostCapCents)} / day` : "disabled"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[0, 100, 250, 500, 1000, 2500, 10000].map((cents) => (
                  <button
                    key={cents}
                    onClick={() => patch("dailyCostCapCents", cents)}
                    disabled={saving === "dailyCostCapCents" || s.dailyCostCapCents === cents}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs transition tabular-nums",
                      s.dailyCostCapCents === cents
                        ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                        : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                      saving === "dailyCostCapCents" && "opacity-50",
                    )}
                  >
                    {cents === 0 ? "off" : dollars(cents)}
                  </button>
                ))}
              </div>
            </div>

            {/* Strict + shadow */}
            <div className="grid gap-4 sm:grid-cols-2">
              <ToggleRow
                label="strict mode"
                description="refuse expensive calls (> 10¢ est)"
                on={s.strictMode}
                saving={saving === "strictMode"}
                onFlip={(v) => patch("strictMode", v, { toastMsg: v ? "strict mode on · expensive calls refused" : "strict mode off" })}
                tint="amber"
              />
              <ToggleRow
                label="shadow mode"
                description="shadow A/B · v2 prompt"
                on={s.shadowMode}
                saving={saving === "shadowMode"}
                onFlip={(v) => patch("shadowMode", v)}
                tint="violet"
              />
            </div>
          </Panel>

          {/* CRONS SECTION */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">crons</h2>
              <a href="/system/crons" className="text-[10px] uppercase tracking-wider text-sky-400 hover:underline">per-cron → /system/crons</a>
            </div>
            <ToggleRow
              label="pause ALL crons"
              description="kill switch on every scheduled cron at once"
              on={s.pauseAllCrons}
              saving={saving === "pauseAllCrons"}
              onFlip={(v) =>
                patch("pauseAllCrons", v, {
                  confirm: v
                    ? "Pause every scheduled cron? Brain maintenance, ingestion, notifications — all stopped until resumed. OK?"
                    : "Resume all crons?",
                  toastMsg: v ? "all crons paused" : "all crons resumed",
                })
              }
              tint="rose"
            />
          </Panel>

          {/* NUDGES SECTION */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">quiet mode</h2>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">{s.quietMode}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { v: "off",    label: "off",               hint: "all notifications active" },
                { v: "nudges", label: "no nudges",          hint: "block proactive pings only" },
                { v: "all",    label: "silence everything", hint: "only you-initiated responses" },
              ] as { v: QuietLevel; label: string; hint: string }[]).map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => patch("quietMode", opt.v)}
                  disabled={saving === "quietMode" || s.quietMode === opt.v}
                  className={cn(
                    "flex-1 min-w-[140px] rounded-lg border px-3 py-2 text-left transition",
                    s.quietMode === opt.v
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/60",
                    saving === "quietMode" && "opacity-50",
                  )}
                >
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">{opt.hint}</div>
                </button>
              ))}
            </div>
          </Panel>

          {/* STATUS STRIP — live pulse
              v10.0.560 · de-slopped from sm:grid-cols-3 symmetric trio.
              Three equal "title + description" GlassCards side-by-side
              are the archetypal feature-card AI fingerprint. Stacked
              row pattern (icon-style left dot + label + description)
              reads as a real operator action list — matches the
              insight-ribbon / brain-insights-panel pattern. */}
          <Panel className="border-[var(--border-default)] bg-gradient-to-br from-rose-500/[0.02] to-amber-500/[0.02]">
            <h2 className="mb-3 text-sm font-semibold text-rose-300">⚠ danger zone</h2>
            <div className="space-y-1.5">
              <GlassCard as="a" href="/brain" className="group flex items-center gap-3 p-3 transition hover:border-rose-500/40 hover:bg-rose-500/5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-200">Reset brain</div>
                  <div className="text-[10px] text-zinc-500">clear skills · identity · beliefs · contradictions</div>
                </div>
              </GlassCard>
              <GlassCard as="a" href="/system/actions?approval=pending" className="group flex items-center gap-3 p-3 transition hover:border-amber-500/40 hover:bg-amber-500/5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-200">Pending approvals</div>
                  <div className="text-[10px] text-zinc-500">Nick's flagged autonomous actions</div>
                </div>
              </GlassCard>
              <GlassCard as="a" href="/brain?mode=export" className="group flex items-center gap-3 p-3 transition hover:border-sky-500/40 hover:bg-sky-500/5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-200">Export brain</div>
                  <div className="text-[10px] text-zinc-500">full JSON dump · one click</div>
                </div>
              </GlassCard>
            </div>
          </Panel>
        </>
      )}

      {!feed && loading && <p className="text-center text-xs text-zinc-500">loading…</p>}
      <p className="pt-2 text-center text-[10px] text-zinc-600">
        changes persist in BrainMemory(power_panel) · services read on every call
      </p>
    </StandardPage>
  );
}

function ToggleRow({
  label,
  description,
  on,
  saving,
  onFlip,
  tint,
}: {
  label: string;
  description: string;
  on: boolean;
  saving: boolean;
  onFlip: (next: boolean) => void;
  tint: "emerald" | "amber" | "rose" | "violet";
}) {
  const onClasses = {
    emerald: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
    amber:   "bg-amber-500/20   text-amber-200   ring-amber-500/40",
    rose:    "bg-rose-500/20    text-rose-200    ring-rose-500/40",
    violet:  "bg-violet-500/20  text-violet-200  ring-violet-500/40",
  }[tint];
  return (
    <button
      onClick={() => onFlip(!on)}
      disabled={saving}
      className={cn(
        "group flex w-full items-center justify-between rounded-lg border p-3 text-left transition",
        on
          ? `border-transparent ${onClasses} ring-1`
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-800/50",
        saving && "opacity-50",
      )}
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className={cn("mt-0.5 text-[10px]", on ? "opacity-70" : "text-zinc-500")}>{description}</div>
      </div>
      <div
        className={cn(
          "relative h-6 w-11 rounded-full transition",
          on ? "bg-white/20" : "bg-zinc-800",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full transition-all",
            on ? "left-[22px] bg-white" : "left-0.5 bg-zinc-500",
          )}
        />
      </div>
    </button>
  );
}
