"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Zap, Shield, Bell, Brain, Clock, Wifi, BellRing,
  Activity, AlertTriangle, Bot, TrendingUp, TrendingDown, Cog, Database,
  MonitorSmartphone, FileText, Sparkles, Ghost, Gauge, Eye,
} from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { AiSettingsPanel } from "@/components/settings/ai-settings-panel";
import { CronControlPanel } from "@/components/settings/cron-control-panel";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { IdentityPanel } from "@/components/settings/identity-panel";
import { HQErrorsCard } from "@/components/ultron/hq-errors-card";
import { SystemHealthCard } from "@/components/ultron/system-health-card";
import { CommandSpinePulse } from "@/components/ultron/command-spine-pulse";
import { DeployChip } from "@/components/ultron/deploy-chip";
import { SystemDataCards } from "@/components/settings/system-data-cards";
import { useSystemPulse } from "@/lib/hooks/use-system-pulse";
import { useDismissedTicker } from "@/hooks/use-dismissed-ticker";

import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged } from "@/lib/events/data-change";

export default function SettingsPage() {
  // v11 retirement · habits config + DEFAULT_HABITS seed deleted in
  // v10.0.529.69 audit. Habits live as DAILY Tasks on /tasks. The
  // /api/habits surface still works for backward-compat reads; nothing
  // here ever consumed the seed list (zero importers · grep-verified).
  const pulse = useSystemPulse();

  return (
    <div className="space-y-6">
      {/* v10.0.529.52 · Wave 6 deep · lowercase h1 + simpler subline.
          Settings is the operator's config hub · keep the visual
          contract aligned with /brain · /life · /system roots. */}
      <div>
        <h1 className="text-lg font-[var(--font-display)] font-bold lowercase tracking-wider text-[var(--text-primary)]">
          settings
        </h1>
        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
          system ops · ai · devices · preferences
        </p>
      </div>

      {/* ═══ System Ops hub — live counts linking to every /system/* surface ═══
          v11 restructure · previously these lived in the FloatingHome
          expanded menu as a 4-row SYSTEM OPS list. Now the orb stays a
          5-tab surface and Settings is the real hub · one organized
          page that explains what each surface DOES and routes to it
          with live pulse counts inline. */}
      <SystemOpsHub pulse={pulse} />

      {/* AI Settings — live-mutable config + cold memory + tool blocklist */}
      <AiSettingsPanel />

      {/* Habits · retired v11 — MasteryHabit table was dropped Apr 19;
          habits now live as Task rows with loopKind=DAILY. The config
          surface this replaced was a stale display-filter, not a real
          habit editor. Replaced with a pointer to the live surface. */}
      <GlassCard>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="section-label mb-1">habits</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Habits live as <span className="font-mono text-[var(--gold)]">loopKind=DAILY</span> tasks on the Actions page.
              Add, edit, and check them off there.
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
              Streaks auto-track via <code className="text-[var(--text-secondary)]">streakCount</code>.
              Completion shows up on your daily score + Ultron pulse chips.
            </p>
          </div>
          <Link
            href="/tasks?loop=daily"
            className="shrink-0 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-colors"
          >
            manage habits →
          </Link>
        </div>
      </GlassCard>

      {/* ═══ PUSH NOTIFICATIONS ═══ */}
      <PushNotificationToggle />

      {/* ═══ TICKER DISMISSAL CACHE ═══ */}
      <TickerDismissalReset />

      {/* ═══ AUTO-PILOT CONTROLS ═══ */}
      <AutoPilotControls />

      {/* ═══ CRON CONTROL — kill switches + manual triggers ═══ */}
      <CronControlPanel />

      {/* ═══ RECENT ERRORS — top fingerprints last 24h, deduped ═══
          Moved out of HQ on Apr 24 — this is dev-facing admin signal,
          not a daily personal signal. Silent when the log is clean. */}
      <HQErrorsCard />

      {/* ═══ SYSTEM HEALTH DIGEST — nightly probe summary ═══
          Moved out of HQ on May 1 — same reasoning as HQErrorsCard.
          Silent crons, stale-row warnings, oauth expiry: admin-tier
          signal, not daily-driver. Card self-hides when overall=healthy
          so this surface stays clean unless something needs attention. */}
      <SystemHealthCard />

      {/* ═══ SYSTEM DATA — sparkline + error rate + quotas ═══
          v10.0.94 · UI rendering of /api/system/health-trend +
          /error-rate-by-route + /integration-quotas. Each card
          self-hides when empty so this surface stays clean unless
          there's signal worth showing. */}
      <SystemDataCards />

      {/* ═══ BUILD STATUS — what code is live + Command Spine ═══
          Both moved out of HQ on May 2. DeployChip shows current
          deployed SHA + age (admin signal, was top-right of HQ).
          CommandSpinePulse shows the v9.0 unified state contract
          (active command + proof ratio + risk count, was below HQ
          SinceLastVisit). Together they form the Build Status section
          of Settings — clear "what's running" + "what's queued"
          without the daily-driver clutter. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label">Build status</p>
          <DeployChip />
        </div>
        <CommandSpinePulse />
      </div>

      {/* ═══ SKILL LIBRARY — behavioral pattern curation ═══ */}
      <SkillLibraryPanel />

      {/* ═══ IDENTITY SNAPSHOT — 8-axis self-model ═══ */}
      <IdentityPanel />

      {/* ═══ SYSTEM INFO ═══ */}
      <SystemInfo />
    </div>
  );
}

// ── Auto-Pilot Mode Controls ──────────────────────────────────────────────
type AutoPilotCategory = "brain" | "sales" | "schedule" | "comms";

interface AutoPilotFlag {
  key: string;
  label: string;
  description: string;
  icon: typeof Zap;
  enabled: boolean;
  /** 2026-05-24 · Wave P · category for visual grouping. */
  category: AutoPilotCategory;
}

// 2026-05-24 · Wave P · category metadata · gold-on-dark editorial
// palette · each tint matches the surface's existing System Ops Hub
// tint vocabulary (brain=amber · sales=emerald · schedule=violet ·
// comms=sky) so the operator's mental color-coding stays consistent
// across pages.
const CATEGORY_META: Record<
  AutoPilotCategory,
  { label: string; tint: string; tintBg: string; description: string }
> = {
  brain: {
    label: "Brain · learning",
    tint: "text-amber-300",
    tintBg: "bg-amber-500/10",
    description: "memory consolidation · identity · skill extraction",
  },
  sales: {
    label: "Sales · revenue",
    tint: "text-emerald-300",
    tintBg: "bg-emerald-500/10",
    description: "lead alerts · quote follow-up · revenue anomaly",
  },
  schedule: {
    label: "Schedule · focus",
    tint: "text-violet-300",
    tintBg: "bg-violet-500/10",
    description: "morning · commitments · weekly targets · ADHD rhythm",
  },
  comms: {
    label: "Comms · marketing",
    tint: "text-sky-300",
    tintBg: "bg-sky-500/10",
    description: "weather-triggered campaigns",
  },
};

// 2026-05-24 · Wave P · hoisted to module scope · same data, sorted by
// category to drive the grouped render. Was inlined inside useState
// before · grouping requires the list to be authored category-first.
const DEFAULT_AUTOPILOT_FLAGS: AutoPilotFlag[] = [
  // Brain · learning
  { key: "auto_brain_cycle", label: "Nightly Brain Cycle", description: "Run 9-stage memory consolidation + intelligence engines", icon: Brain, enabled: true, category: "brain" },
  { key: "auto_skill_extraction", label: "Skill Extraction", description: "Weekly Sun 03:00 · cluster DONE tasks into skill candidates · curate in /brain", icon: Brain, enabled: true, category: "brain" },
  { key: "auto_identity_refresh", label: "Identity Snapshot Refresh", description: "Daily 04:30 · roll 8-axis self-model + harvest beliefs + decay stale patterns", icon: Brain, enabled: true, category: "brain" },
  { key: "auto_session_distill", label: "Chat Session Distillation", description: "Every 3h · fold idle chats into durable memory", icon: Brain, enabled: true, category: "brain" },
  // Sales · revenue
  { key: "auto_stale_lead_alert", label: "Stale Lead Alerts", description: "Alert when leads go 24h+ without contact", icon: Bell, enabled: true, category: "sales" },
  { key: "auto_followup_quotes", label: "Quote Follow-ups", description: "Auto-remind on quotes not followed up in 48h", icon: Bell, enabled: true, category: "sales" },
  { key: "auto_revenue_alerts", label: "Revenue Anomaly Alerts", description: "Alert when daily revenue deviates significantly", icon: TrendingUp, enabled: true, category: "sales" },
  { key: "auto_estimate_followup", label: "Estimate Auto-Follow-Up", description: "Auto-send SMS follow-ups on aging estimates (24h, 48h, 7d, 30d)", icon: Clock, enabled: false, category: "sales" },
  // Schedule · focus
  { key: "auto_morning_autopilot", label: "Morning Auto-Pilot", description: "ONE Telegram message with schedule + leads + weather + approve button", icon: Zap, enabled: true, category: "schedule" },
  { key: "auto_commitment_check", label: "Commitment Check", description: "Auto-check overdue commitments and create tasks", icon: Shield, enabled: true, category: "schedule" },
  { key: "auto_weekly_targets", label: "Weekly Target Auto-Set", description: "Auto-set targets by Tuesday if not manually set", icon: Clock, enabled: false, category: "schedule" },
  { key: "adhd_operating_rhythm", label: "ADHD Operating Rhythm", description: "Telegram checkpoints at 8am, 11am, 2pm, 5pm, 9pm — guards focus, enforces shutdown", icon: Activity, enabled: true, category: "schedule" },
  // Comms · marketing
  { key: "auto_weather_campaigns", label: "Weather Campaigns", description: "Auto-trigger marketing when weather events match (freeze, rain, heat, snow)", icon: Bell, enabled: true, category: "comms" },
];

// 2026-05-24 · Wave P · resolve initial state from localStorage SYNC
// before the first render so the operator doesn't see the "everything
// ON" flash on every page load (Nielsen #1 fix · visibility of system
// status). The tRPC query still resolves and merges in · localStorage
// just eliminates the cold-start lie. Falls back to DEFAULT_* if no
// cache or parse fails (e.g. SSR pass).
function resolveInitialFlags(): AutoPilotFlag[] {
  if (typeof window === "undefined") return DEFAULT_AUTOPILOT_FLAGS;
  try {
    const stored = window.localStorage.getItem("nour-autopilot-flags");
    if (!stored) return DEFAULT_AUTOPILOT_FLAGS;
    const parsed = JSON.parse(stored) as Record<string, boolean>;
    return DEFAULT_AUTOPILOT_FLAGS.map((f) => ({
      ...f,
      enabled: parsed[f.key] !== undefined ? parsed[f.key] : f.enabled,
    }));
  } catch {
    return DEFAULT_AUTOPILOT_FLAGS;
  }
}

function AutoPilotControls() {
  const [flags, setFlags] = useState<AutoPilotFlag[]>(resolveInitialFlags);
  // 2026-05-24 · Wave P · surface mutation failures inline · mirror
  // PushNotificationToggle's pattern · was completely silent before
  // (Nielsen #9 fix · help users recognize errors).
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Phase UU.2 (2026-05-22) · REST→tRPC · the flag map is a typed query
  // (system.autopilotFlags). It merges into the local `flags` state
  // (which carries the rich label/icon/description metadata the server
  // doesn't store). On query error the localStorage fallback still
  // applies — the same resilience the prior authedFetch path had.
  const autopilotQuery = trpc.system.autopilotFlags.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const setAutopilotMutation = trpc.system.setAutopilotFlags.useMutation();

  useEffect(() => {
    // v10.0.117 audit fix · alive flag prevents setFlags from firing
    // on a dead instance if user navigates away mid-load.
    let alive = true;
    if (autopilotQuery.data?.flags) {
      const serverFlags = autopilotQuery.data.flags;
      setFlags((prev) =>
        prev.map((f) => ({
          ...f,
          enabled:
            serverFlags[f.key] !== undefined ? serverFlags[f.key] : f.enabled,
        })),
      );
    } else if (autopilotQuery.error) {
      // Server load failed — fall back to localStorage so a toggle
      // made offline isn't lost on the next visit.
      try {
        const stored = localStorage.getItem("nour-autopilot-flags");
        if (stored && alive) {
          const parsed = JSON.parse(stored) as Record<string, boolean>;
          setFlags((prev) =>
            prev.map((f) => ({
              ...f,
              enabled:
                parsed[f.key] !== undefined ? parsed[f.key] : f.enabled,
            })),
          );
        }
      } catch {}
    }
    return () => {
      alive = false;
    };
  }, [autopilotQuery.data, autopilotQuery.error]);

  function toggleFlag(key: string) {
    setFlags(prev => {
      const updated = prev.map(f => f.key === key ? { ...f, enabled: !f.enabled } : f);
      // Save to both server and localStorage
      const map: Record<string, boolean> = {};
      updated.forEach(f => { map[f.key] = f.enabled; });
      localStorage.setItem("nour-autopilot-flags", JSON.stringify(map));
      // 2026-05-24 · Wave P · surface mutation errors inline · the
      // localStorage write above means the toggle is "stored" even on
      // mutation failure · clearing the banner on retry success.
      setMutationError(null);
      setAutopilotMutation.mutate(
        { flags: map },
        {
          onError: (err) => {
            setMutationError(err.message || "Server rejected the flag update · localStorage still holds your change.");
          },
        },
      );
      // v10.0.529.90 · Wave 34 · fire bus · AiSettingsPanel (Wave 31)
      // + any future autopilot consumers refresh instantly.
      notifyDataChanged("settings", { source: "settings-page", detail: "autopilot-toggle", id: key });
      return updated;
    });
  }

  const enabledCount = flags.filter(f => f.enabled).length;
  // 2026-05-24 · Wave P · group flags by category for the rendered
  // grid · iterate the meta map order (brain → sales → schedule →
  // comms) so the visual sequence is stable regardless of array order.
  const categoryOrder: AutoPilotCategory[] = ["brain", "sales", "schedule", "comms"];
  const grouped = categoryOrder.map((cat) => ({
    category: cat,
    meta: CATEGORY_META[cat],
    flags: flags.filter((f) => f.category === cat),
  }));

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[var(--gold)]" />
          <span className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            auto-pilot mode
          </span>
        </div>
        <Badge className={cn("text-[10px]",
          enabledCount === flags.length ? "bg-green-500/10 text-green-400" :
          enabledCount > 0 ? "bg-amber-500/10 text-amber-400" :
          "bg-red-500/10 text-red-400"
        )}>
          {enabledCount}/{flags.length} active
        </Badge>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mb-4">
        Nick runs these automatically via cron. Toggle to enable/disable autonomous operations.
      </p>
      {/* 2026-05-24 · Wave P · grouped grid · 4 categories instead of
          a flat 13-row scroll. Per-category count badge gives at-a-glance
          state. md:grid-cols-2 on desktop · single-column on mobile
          (iPhone width is the design floor). */}
      <div className="grid gap-3 md:grid-cols-2">
        {grouped.map((group) => {
          if (group.flags.length === 0) return null;
          const groupEnabled = group.flags.filter((f) => f.enabled).length;
          return (
            <div
              key={group.category}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h3 className={cn("text-[10px] font-semibold uppercase tracking-wider", group.meta.tint)}>
                    {group.meta.label}
                  </h3>
                  <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
                    {group.meta.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-mono tabular-nums",
                    groupEnabled === group.flags.length
                      ? cn(group.meta.tintBg, group.meta.tint)
                      : "bg-zinc-800 text-zinc-500",
                  )}
                >
                  {groupEnabled}/{group.flags.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {group.flags.map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => toggleFlag(f.key)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md border px-2 py-2 text-left transition-colors",
                        // 2026-05-24 · Wave P · 44pt vertical tap target ·
                        // py-2 + content height = ~44px. Was a GlassCard
                        // before with cursor-pointer · this is the proper
                        // semantic (button) + matches Apple HIG.
                        f.enabled
                          ? "border-[var(--gold)]/20 bg-[var(--gold)]/[0.03]"
                          : "border-[var(--border-default)] bg-transparent hover:bg-[var(--bg-raised)]",
                      )}
                    >
                      <Icon
                        size={13}
                        className={cn(
                          "shrink-0",
                          f.enabled ? "text-[var(--gold)]" : "text-[var(--text-tertiary)]",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-[11px] font-medium",
                            f.enabled ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",
                          )}
                        >
                          {f.label}
                        </p>
                        <p className="truncate text-[9px] text-[var(--text-tertiary)]">
                          {f.description}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                          f.enabled ? "bg-[var(--gold)]" : "bg-zinc-700",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                            f.enabled ? "left-[18px]" : "left-0.5",
                          )}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {/* 2026-05-24 · Wave P · inline mutation error · mirrors the
          PushNotificationToggle error pattern · rose-300 badge ·
          transient (cleared on next toggle). Pre-fix the mutation
          could fail silently · operator wouldn't know the server
          rejected their change. */}
      {mutationError && (
        <p className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
          ⚠ {mutationError}
        </p>
      )}
    </div>
  );
}

// ── System Info Panel ──────────────────────────────────────────────────────

// v10 B.1 FIND-06 · typed in place of useState<any>. Field shape
// can't drift silently anymore — TypeScript catches changes.
interface ToolsHealth {
  summary?: {
    totalTools?: number;
    overallStatus?: "operational" | "degraded" | "down" | string;
  };
  database?: { connected?: boolean };
  ai?: { available?: boolean; provider?: string; activeModel?: string };
  appVersion?: string;
}

// v10.0.282 · hoisted out of SystemInfo to silence
// react-hooks/static-components (14 warnings · "Cannot create components
// during render"). Stateless and props-only, so safe at module scope.
function SystemInfoRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span>{label}</span>
      <span className={color || ""}>{value}</span>
    </div>
  );
}

function SystemInfo() {
  // Phase UU.2 (2026-05-22) · REST→tRPC · the version/tools card pulls
  // two typed queries: system.toolsHealth (the ToolsHealth shape) and
  // brain.status. The legacy code read the memory count off the
  // top-level `d.total` of /api/brain/status — but that route nests
  // the count under `memories`, so `d.total` was always undefined and
  // this line never populated. The typed shape forces the correct
  // read (`memories.total`); the endpoint payload is unchanged.
  const toolsQuery = trpc.system.toolsHealth.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const brainQuery = trpc.brain.status.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const info: ToolsHealth | null = (toolsQuery.data ?? null) as ToolsHealth | null;
  const memoryCount: number | null =
    typeof brainQuery.data?.memories?.total === "number"
      ? brainQuery.data.memories.total
      : null;
  // v10 B.1 FIND-06 · explicit error indicator. Was silent on dual
  // fetch failure — hardcoded fallbacks rendered as live facts. Show
  // "—" + a small warning when BOTH queries fail so the operator sees
  // STALE not LIE.
  const healthError = toolsQuery.isError && brainQuery.isError;

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-[var(--text-tertiary)]" />
          <span className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            system
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 pulse-live" />
          <span className="text-[10px] text-green-400 font-mono">LIVE</span>
        </div>
      </div>
      <div className="space-y-1 text-[11px] font-mono text-[var(--text-tertiary)]">
        {/* v10.0.33 — was hardcoded "v8.1". The /api/tools/health
            response carries appVersion; surface it instead so the
            displayed version actually matches the running build. */}
        <SystemInfoRow label="version" value={info?.appVersion ?? "v10"} color="text-[var(--gold)]" />
        <SystemInfoRow label="AI provider" value="Venice GLM-4.7 (unrestricted)" color="text-blue-400" />
        <SystemInfoRow label="Venice features" value="web search, scraping, E2E, cache" color="text-violet-400" />
        <SystemInfoRow label="AI fallback" value="Venice → Venice → OpenAI → Anthropic" />
        {/* v10.0.117 audit fix · was rendering hardcoded "149+" while
            info was null (fetch in flight or failed), masquerading
            stale-via-default as live. Now defers to "..." like the
            Memories row above. */}
        <SystemInfoRow label="tools" value={info != null ? `${info.summary?.totalTools ?? "?"}+` : "..."} />
        <SystemInfoRow label="brain engines" value="60+ files" />
        <SystemInfoRow label="memories" value={memoryCount ?? "..."} color={memoryCount ? "text-violet-400" : ""} />
        <SystemInfoRow label="task intelligence" value="12 profiles (adaptive)" color="text-amber-400" />
        <SystemInfoRow label="cron jobs" value="41" />
        {info?.summary?.overallStatus && (
          <SystemInfoRow
            label="arsenal"
            value={info.summary.overallStatus.toUpperCase()}
            color={
              info.summary.overallStatus === "operational" ? "text-green-400" :
              info.summary.overallStatus === "degraded" ? "text-amber-400" : "text-red-400"
            }
          />
        )}
        {/* v10 B.1 FIND-06 · explicit error indicator when both fetches failed */}
        {healthError && (
          <SystemInfoRow label="health" value="endpoints unreachable — values stale" color="text-amber-400" />
        )}
        <SystemInfoRow label="platform" value="Next.js + Vercel + Neon" />
        <SystemInfoRow label="repos" value="2 (statenour + nickstire)" />
        <SystemInfoRow label="admin" value="nickstire.org/admin" />
      </div>
    </div>
  );
}

// ── Ticker Dismissal Reset ─────────────────────────────────────────────
// May 02 · Both tickers (top + bottom) let Nour X-out individual items
// (acknowledge + hide). This panel surfaces the count of dismissed
// IDs from localStorage and exposes a one-tap reset for when a stale
// dismissal is masking a now-relevant signal.
function TickerDismissalReset() {
  const { dismissed, clearAll } = useDismissedTicker();
  const count = dismissed.size;

  if (count === 0) {
    return (
      <GlassCard>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="section-label mb-1">ticker dismissals</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              No items dismissed yet. Hover any cell on the top or bottom ticker → tap × to acknowledge it (hides it across reloads).
            </p>
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="section-label mb-1">Ticker dismissals</p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            <span className="text-[var(--gold)] font-mono">{count}</span> ticker item{count === 1 ? "" : "s"} acknowledged + hidden across reloads.
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
            Resetting brings them back so the marquee surfaces them again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearAll();
          }}
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-zinc-800/80 hover:text-[var(--text-primary)] transition-colors"
        >
          reset
        </button>
      </div>
    </GlassCard>
  );
}

// ── Push Notification Toggle ──────────────────────────────────────────
function PushNotificationToggle() {
  const { isSupported, isSubscribed, permission, lastError, subscribe, unsubscribe } = usePushNotifications();
  const [loading, setLoading] = useState(false);

  if (!isSupported) return null;

  const handleToggle = async () => {
    setLoading(true);
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
    setLoading(false);
  };

  // v11 · translate the hook's lastError into a human-readable message
  const errorMessage: string | null = (() => {
    if (!lastError) return null;
    if (lastError === "vapid_public_key_missing")
      return "Server isn't configured for push — VAPID_PUBLIC_KEY env var missing. Set it in Vercel env.";
    if (lastError === "permission_denied")
      return "Browser blocked notifications. Enable in browser settings → Site permissions → Notifications.";
    if (lastError === "permission_default")
      return "Permission not granted. Click the toggle again and allow notifications when prompted.";
    if (lastError === "not_supported")
      return "This browser doesn't support push notifications.";
    if (lastError === "server_rejected")
      return "Server rejected the subscription. Check /api/notifications/subscribe logs.";
    if (lastError.startsWith("subscribe_exception:"))
      return `Browser error: ${lastError.slice("subscribe_exception:".length).trim()}`;
    return lastError;
  })();

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BellRing size={14} className="text-[var(--gold)]" />
          <span className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            push notifications
          </span>
        </div>
        <button
          onClick={handleToggle}
          disabled={loading}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            isSubscribed ? "bg-[var(--gold)]" : "bg-zinc-700",
            loading && "opacity-50"
          )}
        >
          <span className={cn(
            "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
            isSubscribed ? "left-[22px]" : "left-0.5"
          )} />
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)]">
        {isSubscribed
          ? "Enabled — you'll get alerts for leads, revenue milestones, drift detection, and score reminders."
          : permission === "denied"
            ? "Blocked by browser. Enable in browser settings → Site permissions → Notifications."
            : "Enable to receive alerts even when the browser is closed."}
      </p>
      {errorMessage && (
        <p className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
          ⚠ {errorMessage}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SystemOpsHub · organized grid of every /system/* surface
// ═══════════════════════════════════════════════════════════════════════
//
// v11 restructure · Nour called out that the FloatingHome expanded menu
// was getting crowded with System Ops chips (crons/errors/ai-cost/
// actions) and didn't explain what each surface DOES. Solution: move
// the full catalog here, organized into six categories with live pulse
// counts on each row. The orb menu now just has one SETTINGS link.

type SystemPulseShape = ReturnType<typeof useSystemPulse>;

function SystemOpsHub({ pulse }: { pulse: SystemPulseShape }) {
  const groups: Array<{
    heading: string;
    tint: string;
    items: Array<{
      href: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
      label: string;
      subtitle: string;
      count?: number;
      countTint?: string;
      soon?: boolean;
    }>;
  }> = [
    {
      heading: "Health",
      tint: "text-emerald-300",
      items: [
        { href: "/system", icon: Activity, label: "Overview", subtitle: "diagnostics · DB · integrations · models" },
        { href: "/system/health", icon: Gauge, label: "Health probe", subtitle: "DB latency · device count · uptime" },
        { href: "/system/logs", icon: FileText, label: "Live logs", subtitle: "unified tail · errors + crons + metrics + actions + requests" },
        {
          // v10.0.306 · /system/errors absorbed into /system/logs
          // grouped view-mode tab
          href: "/system/logs?view=errors",
          icon: AlertTriangle,
          label: "Errors",
          subtitle: "fingerprints grouped · stack traces · → task",
          count: pulse?.errors24h ?? 0,
          countTint: (pulse?.errors24h ?? 0) > 0 ? "text-rose-300 bg-rose-500/15" : "text-zinc-500 bg-zinc-800",
        },
        {
          href: "/system/features",
          icon: Activity,
          label: "Feature status",
          subtitle: "honest registry · live · partial · dormant + activation triggers",
        },
      ],
    },
    {
      heading: "Crons + automation",
      tint: "text-violet-300",
      items: [
        {
          href: "/system/crons",
          icon: Clock,
          label: "Crons",
          subtitle: "kill · run-now · sparklines · drift detector",
          count: (pulse?.cronsDrifted ?? 0) + (pulse?.cronFails24h ?? 0),
          countTint: ((pulse?.cronsDrifted ?? 0) + (pulse?.cronFails24h ?? 0)) > 0 ? "text-rose-300 bg-rose-500/15 animate-pulse" : "text-zinc-500 bg-zinc-800",
        },
        {
          href: "/system/actions",
          icon: Bot,
          label: "Nick actions",
          subtitle: "autonomous action audit · rule leaderboard · rollback",
          count: pulse?.actionsPending ?? 0,
          countTint: (pulse?.actionsPending ?? 0) > 0 ? "text-amber-300 bg-amber-500/15" : "text-zinc-500 bg-zinc-800",
        },
      ],
    },
    {
      heading: "Nick · AI",
      tint: "text-sky-300",
      items: [
        {
          href: "/system/ai-cost",
          icon: Zap,
          label: "AI cost",
          subtitle: "today/7d/30d · by feature × model · burn rate",
          count: pulse?.aiCalls24h ?? 0,
          countTint: "text-sky-300 bg-sky-500/10",
        },
        {
          href: "/system/quality",
          icon: Sparkles,
          label: "Nick quality",
          subtitle: "critic 4-axis score · 14-day trend · regen rate",
          count: pulse?.nickQualityAvg7d ?? undefined,
          countTint:
            pulse?.nickQualityAvg7d != null && pulse.nickQualityAvg7d >= 80 ? "text-emerald-300 bg-emerald-500/10" :
            pulse?.nickQualityAvg7d != null && pulse.nickQualityAvg7d >= 65 ? "text-amber-300 bg-amber-500/10" :
            pulse?.nickQualityAvg7d != null ? "text-rose-300 bg-rose-500/10" : "text-zinc-500 bg-zinc-800",
        },
        { href: "/chat", icon: Brain, label: "Nick chat", subtitle: "talk to Nick · tool calls · citations" },
      ],
    },
    {
      heading: "Decisions + learning",
      tint: "text-fuchsia-300",
      items: [
        {
          // v10.0.529.103 · Wave 47 · /system/decision-drift route was
          // merged into /system/quality (decisions tab) but this nav
          // link was never updated · pointed at 404. Fixed.
          href: "/system/quality?view=decisions",
          icon: TrendingDown,
          label: "Decision drift",
          subtitle: "grade trend · review rate · overdue queue · misses",
        },
        {
          href: "/system/ghost-nour",
          icon: Ghost,
          label: "Ghost Nour",
          subtitle: "what past-Nour would choose · similarity search",
        },
        {
          // v10.0.529.103 · Wave 47 · /system/anti-patterns was merged
          // into /system/quality (lessons tab) · nav was 404. Fixed.
          href: "/system/quality?view=lessons",
          icon: TrendingUp,
          label: "Anti-patterns",
          subtitle: "tried X, failed reason Y · Nick consults pre-action",
        },
      ],
    },
    {
      heading: "Devices + integrations",
      tint: "text-cyan-300",
      items: [
        {
          href: "/system/devices",
          icon: MonitorSmartphone,
          label: "Devices",
          subtitle: "fleet · agent liveness · command queue",
          count: pulse?.devicesOffline ?? 0,
          countTint: (pulse?.devicesOffline ?? 0) > 0 ? "text-amber-300 bg-amber-500/15" : "text-zinc-500 bg-zinc-800",
        },
        // v10.0.529.49 · /integrations route deleted (orphan · zero
        // inbound links · functionality lives on /system page already).
        // Row removed from settings hub. Integration status visible
        // via the /system page tiles + the agent-traces drill-down.
        // v10.0.529.103 · Wave 47 · /system/gaps was merged into /system/
        // coverage (gaps tab) · nav was 404. Fixed.
        { href: "/system/coverage?view=gaps", icon: Eye, label: "Gaps scan", subtitle: "coded-but-not-surfaced · unscheduled crons · missing env" },
      ],
    },
    {
      heading: "Brain + memory",
      tint: "text-amber-300",
      items: [
        {
          href: "/brain",
          icon: Brain,
          label: "Brain",
          subtitle: "memories · patterns · automation rules · graph explorer",
        },
        {
          href: "/knowledge",
          icon: Database,
          label: "Knowledge base",
          subtitle: "Drive ingest · laws · notes · research pins",
        },
        {
          href: "/journal",
          icon: FileText,
          label: "Journal",
          subtitle: "raw thoughts · brain dumps · reflections · daily logs",
        },
      ],
    },
    {
      heading: "Power + control",
      tint: "text-rose-300",
      items: [
        {
          href: "/system/power",
          icon: Shield,
          label: "Power panel",
          subtitle: "provider pin · cost cap · strict mode · pause ALL crons · quiet mode",
        },
      ],
    },
  ];

  return (
    <GlassCard>
      <div className="mb-3 flex items-center justify-between">
        <p className="section-label">System ops</p>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          {pulse?.generatedAt ? `live · last refresh ${new Date(pulse.generatedAt).toLocaleTimeString()}` : "loading pulse…"}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.heading} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-3">
            <h3 className={cn("mb-2 text-[10px] font-semibold uppercase tracking-wider", g.tint)}>
              {g.heading}
            </h3>
            <div className="space-y-1">
              {g.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded px-2 py-2 transition",
                      "hover:bg-[var(--bg-raised)]"
                    )}
                  >
                    <Icon size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-[var(--text-primary)] group-hover:text-[var(--gold)]">
                        {item.label}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
                        {item.subtitle}
                      </div>
                    </div>
                    {item.count !== undefined && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-[1px] text-[9px] font-mono tabular-nums",
                          item.countTint ?? "text-zinc-500 bg-zinc-800",
                        )}
                      >
                        <AnimatedCounter value={item.count} duration={600} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
