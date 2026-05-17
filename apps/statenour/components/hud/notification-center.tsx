"use client";

/**
 * NOTIFICATION CENTER — intelligent pulse digest, not a raw event stream.
 *
 * Old version (retired Apr 17): dumped every DriftAlert + AuditEvent +
 * arsenal log into a flat list. Felt generic because:
 *   - Same "novelty-seeking" alert fired fresh rows every day → dupe spam
 *   - Brain insights ("attention scattered across 60 loops") were buried
 *     below 4 identical "stale task" alerts
 *   - Nothing celebrated. Warn-heavy tilt made the bell feel nagging.
 *
 * New version: hits /api/ultron/pulse-digest which clusters by ruleId,
 * collapses streaks, separates tiers:
 *   PRIORITY (de-duped criticals + warnings, with streak day count)
 *   EMERGING (sharpest brain insights)
 *   WINS (today's completions, scores ≥ 8, autonomous successes)
 *   MAINTENANCE (collapsed count of old alerts queued for auto-resolve)
 *
 * Bell badge now mirrors the digest count + mood color (alert=red,
 * emerging=blue, steady=gold, quiet=hidden).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { authedFetch } from "@/hooks/use-authed-fetch";
import {
  Bell,
  X,
  CheckCheck,
  Flame,
  Brain,
  Trophy,
  AlertTriangle,
  Sparkles,
  Archive,
} from "lucide-react";
import { DismissButton } from "@/components/ui/dismiss-button";

const DISMISSED_STORAGE_KEY = "nour-dismissed-notifications-v2";
const MAX_DISMISSED = 500;

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(set);
    const trimmed = arr.length > MAX_DISMISSED ? arr.slice(arr.length - MAX_DISMISSED) : arr;
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

interface DigestItem {
  id: string;
  headline: string;
  detail?: string;
  kind: "drift" | "insight" | "win" | "error" | "maintenance";
  severity: "critical" | "warning" | "info" | "win";
  streakDays?: number;
  at: string;
  /** Apr 19 — deep link to the page that resolves this. Clicking the
   *  row navigates there. */
  link?: string;
}

interface PulseDigest {
  priority: DigestItem[];
  emerging: DigestItem[];
  wins: DigestItem[];
  maintenance: { count: number; sample: string | null };
  summary: {
    total: number;
    headline: string | null;
    mood: "alert" | "emerging" | "steady" | "quiet";
  };
  generatedAt: string;
}

const MOOD_COLORS: Record<PulseDigest["summary"]["mood"], string> = {
  alert: "text-red-400",
  emerging: "text-blue-400",
  steady: "text-[var(--gold)]",
  quiet: "text-[var(--text-tertiary)]",
};

const KIND_META: Record<
  DigestItem["kind"],
  { icon: typeof Bell; color: string; bg: string }
> = {
  drift: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
  insight: { icon: Brain, color: "text-blue-400", bg: "bg-blue-500/10" },
  win: { icon: Trophy, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  error: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/15" },
  maintenance: { icon: Archive, color: "text-[var(--text-tertiary)]", bg: "bg-[var(--bg-raised)]" },
};

const SEVERITY_BORDER: Record<DigestItem["severity"], string> = {
  critical: "border-red-500/40",
  warning: "border-amber-500/30",
  info: "border-blue-500/25",
  win: "border-emerald-500/30",
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState<PulseDigest | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/ultron/pulse-digest");
      if (!res.ok) return;
      const raw = (await res.json()) as { data?: PulseDigest };
      if (raw?.data) setDigest(raw.data);
    } catch {}
  }, []);

  useEffect(() => {
    dismissedRef.current = loadDismissed();
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const dismiss = useCallback(
    async (item: DigestItem) => {
      dismissedRef.current.add(item.id);
      persistDismissed(dismissedRef.current);
      setTick((t) => t + 1);
      if (item.kind === "drift" && item.id.startsWith("drift-")) {
        const alertId = item.id.replace("drift-", "");
        await authedFetch("/api/drift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve", id: alertId }),
        }).catch(() => {});
      }
    },
    []
  );

  const clearAll = useCallback(async () => {
    if (!digest) return;
    const snapshot = [...digest.priority, ...digest.emerging, ...digest.wins];
    for (const n of snapshot) dismissedRef.current.add(n.id);
    persistDismissed(dismissedRef.current);
    setTick((t) => t + 1);
    const alertIds = snapshot
      .filter((n) => n.id.startsWith("drift-"))
      .map((n) => n.id.replace("drift-", ""));
    // v10.0.48 — parallelized via Promise.all. Pre-fix this issued
    // sequential awaited fetches inside a for-loop; with 5+ priority
    // alerts the modal stayed open for several seconds while the
    // user waited. Per-call `.catch(() => {})` already handled
    // individual failures so parallelization is safe.
    await Promise.all(
      alertIds.map((id) =>
        authedFetch("/api/drift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve", id }),
        }).catch(() => {}),
      ),
    );
  }, [digest]);

  useEffect(() => {
    function onToggle() {
      setOpen((v) => !v);
    }
    window.addEventListener("nour-notifications", onToggle);
    return () => window.removeEventListener("nour-notifications", onToggle);
  }, []);

  if (!digest) return null;

  // Filter locally-dismissed items
  const visiblePriority = digest.priority.filter(
    (n) => !dismissedRef.current.has(n.id)
  );
  // v7.3 · Apr 29 · `EMERGING` tier hidden from the bell. Those signals
  // (commitment scatter, late-night patterns, brain insights) now flow
  // through the global BottomPulseTicker — ambient, persistent across
  // pages, doesn't demand attention. Bell is reserved for PRIORITY
  // (true alerts requiring action) + WINS (celebratory).
  const visibleEmerging: typeof digest.emerging = [];
  const visibleWins = digest.wins.filter(
    (n) => !dismissedRef.current.has(n.id)
  );

  const unread = visiblePriority.length;
  const totalVisible = unread + visibleWins.length;

  // Quiet mode — bell hidden entirely when nothing worth surfacing
  if (totalVisible === 0 && digest.maintenance.count === 0) {
    return null;
  }

  const mood = digest.summary.mood;
  const moodColor = MOOD_COLORS[mood];
  const bellColor = unread > 0 ? moodColor : "text-[var(--text-secondary)]";
  const bellBgBorder =
    mood === "alert"
      ? "border-red-500/40"
      : mood === "emerging"
        ? "border-blue-500/30"
        : "border-[var(--border-default)]";

  return (
    <>
      {/* Bell trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed top-3 right-4 md:right-[216px] z-[80]",
          "w-9 h-9 rounded-full flex items-center justify-center",
          "bg-[var(--bg-void)]/90 backdrop-blur-xl",
          "shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:border-[var(--gold)]/40",
          "border transition-all duration-200 animate-fadeSlideUp",
          bellBgBorder
        )}
        aria-label={`${unread > 0 ? unread + " active signals" : "Pulse digest"}`}
      >
        <Bell size={15} className={bellColor} />
        {unread > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full",
              "text-white text-[9px] font-bold flex items-center justify-center",
              mood === "alert"
                ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                : mood === "emerging"
                  ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                  : "bg-[var(--gold)] text-black shadow-[0_0_8px_rgba(253,185,19,0.4)]"
            )}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <>
          <div className="fixed inset-0 z-[89] bg-black/40" onClick={() => setOpen(false)} />
          <div className="fixed top-0 right-0 bottom-0 z-[90] w-80 md:w-96 bg-[var(--bg-void)] border-l border-[var(--border-default)] shadow-2xl flex flex-col animate-fadeSlideUp">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className={moodColor} />
                <div>
                  <div className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    Pulse
                  </div>
                  <div className={cn("text-[9px] font-mono uppercase tracking-[0.2em]", moodColor)}>
                    {mood} · {digest.summary.total} signal{digest.summary.total === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {totalVisible > 0 && (
                  <button
                    onClick={clearAll}
                    title="Clear all"
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold-ghost)] transition-colors"
                  >
                    <CheckCheck size={12} />
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Summary line — one-liner headline */}
            {digest.summary.headline && (
              <div className="px-4 py-2 border-b border-[var(--border-default)] bg-[var(--bg-raised)]/40">
                <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider font-mono mb-0.5">
                  top of mind
                </p>
                <p className="text-[12px] text-[var(--text-primary)] leading-snug">
                  {digest.summary.headline}
                </p>
              </div>
            )}

            {/* Tiered sections */}
            <div className="flex-1 overflow-y-auto">
              {visiblePriority.length === 0 && visibleEmerging.length === 0 && visibleWins.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--text-tertiary)]">
                  <Flame size={20} className="text-emerald-400/60" />
                  <span className="text-xs">All clear · operational is the standard</span>
                </div>
              ) : (
                <>
                  {visiblePriority.length > 0 && (
                    <DigestSection
                      label="priority"
                      icon={AlertTriangle}
                      tintClass="text-red-400"
                      items={visiblePriority}
                      onDismiss={dismiss}
                    />
                  )}
                  {visibleEmerging.length > 0 && (
                    <DigestSection
                      label="emerging"
                      icon={Brain}
                      tintClass="text-blue-400"
                      items={visibleEmerging}
                      onDismiss={dismiss}
                    />
                  )}
                  {visibleWins.length > 0 && (
                    <DigestSection
                      label="wins"
                      icon={Trophy}
                      tintClass="text-emerald-400"
                      items={visibleWins}
                      onDismiss={dismiss}
                    />
                  )}
                </>
              )}

              {/* Maintenance footer — always collapsed */}
              {digest.maintenance.count > 0 && (
                <div className="px-4 py-2.5 border-t border-[var(--border-default)] bg-[var(--bg-raised)]/40">
                  <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                    <Archive size={10} />
                    <span className="uppercase tracking-wider font-mono">maintenance</span>
                    <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {digest.maintenance.count}
                    </span>
                    {digest.maintenance.sample && (
                      <span className="italic truncate min-w-0">
                        · {digest.maintenance.sample}
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-[var(--text-tertiary)]/80 mt-0.5">
                    Old drift alerts queued for auto-resolve by backlog-triage (21d+ ack&apos;d quietly)
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DigestSection({
  label,
  icon: Icon,
  tintClass,
  items,
  onDismiss,
}: {
  label: string;
  icon: typeof Bell;
  tintClass: string;
  items: DigestItem[];
  onDismiss: (item: DigestItem) => void;
}) {
  return (
    <section className="border-b border-[var(--border-default)]">
      <div className="px-4 py-1.5 flex items-center gap-1.5 bg-[var(--bg-raised)]/30">
        <Icon size={10} className={tintClass} />
        <span
          className={cn(
            "text-[8px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em]",
            tintClass
          )}
        >
          {label}
        </span>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums">
          {items.length}
        </span>
      </div>
      <ul className="divide-y divide-[var(--border-default)]">
        {items.map((item) => (
          <DigestRow key={item.id} item={item} onDismiss={() => onDismiss(item)} />
        ))}
      </ul>
    </section>
  );
}

function DigestRow({
  item,
  onDismiss,
}: {
  item: DigestItem;
  onDismiss: () => void;
}) {
  const meta = KIND_META[item.kind];
  const KindIcon = meta.icon;
  const border = SEVERITY_BORDER[item.severity];

  // Apr 19 · Every row is a click surface. Body wraps in an <a> when
  // item.link is set. Dismiss button stops propagation so it doesn't
  // accidentally navigate.
  const body = (
    <div className="flex items-start gap-2.5">
      <div
        className={cn(
          "shrink-0 mt-0.5 w-6 h-6 rounded-md flex items-center justify-center border",
          meta.bg,
          border,
        )}
      >
        <KindIcon size={11} className={meta.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-[12px] font-medium text-[var(--text-primary)] leading-snug">
            {item.headline}
          </p>
          {item.streakDays && item.streakDays > 1 && (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 text-[8px] font-mono font-bold uppercase tracking-[0.18em] text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded px-1 py-0"
              title={`Fired ${item.streakDays} days in a row — backlog-triage will auto-resolve at 21d`}
            >
              ×{item.streakDays}d
            </span>
          )}
        </div>
        {item.detail && (
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 leading-snug line-clamp-2">
            {item.detail}
          </p>
        )}
        <p className="text-[9px] text-[var(--text-tertiary)]/70 mt-1 font-mono">
          {new Date(item.at).toLocaleString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
      <DismissButton
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }}
        label="Dismiss notification"
        hoverGate="row"
        size="sm"
        className="hover:text-red-400 relative z-10"
      />
    </div>
  );

  return (
    <li className="group/row px-4 py-2.5 hover:bg-[var(--bg-raised)]/50 transition-colors relative cursor-pointer">
      {item.link ? (
        <a href={item.link} className="block" aria-label={item.headline}>
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
