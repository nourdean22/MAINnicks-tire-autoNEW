// ─── FEATURE FLAGS PANEL · wave-181.x Phase 3 ─────────────
// Upgraded with search · filter chips · verification gate on
// customer-contacting flag flips · iOS-PWA-safe confirmDialog.
// 2026-10-26 · pause switches (inverted flags: TRUE = paused) are their own first group, read as
// Running / Paused with who flipped them, and never counted as features on or off.

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  isCustomerFacingFlag,
  isInvertedFlag,
  requiresConfirmation,
  confirmationCopy,
} from "@shared/flagPolicy";
import { pauseSwitchLabel, shopDay } from "./pauseSwitches";

// ─── FEATURE FLAG CATEGORIES ──────────────────────────
type FlagCategory = {
  label: string;
  keys: string[];
  matchFn: (key: string) => boolean;
};

const FLAG_CATEGORIES: FlagCategory[] = [
  {
    label: "SMS / Outreach",
    keys: ["sms_appointment_reminders", "sms_review_requests", "sms_retention_sequences", "sms_blast_enabled", "smart_sms_auto_reply", "sms_cross_sell_outreach", "sms_auto_quote"],
    matchFn: (k) => k.startsWith("sms_") || k === "smart_sms_auto_reply",
  },
  {
    label: "Experience",
    keys: ["fomo_ticker_enabled", "dynamic_social_proof", "smart_exit_intent", "financing_pre_approval", "drop_off_sms_flow", "uber_integration_cta"],
    matchFn: (k) => ["fomo_ticker_enabled", "dynamic_social_proof", "smart_exit_intent", "financing_pre_approval", "drop_off_sms_flow", "uber_integration_cta"].includes(k),
  },
  {
    label: "Admin / CEO",
    keys: ["live_telegram_feed", "daily_wins_digest", "master_intelligence_report", "safety_monitor_telegram"],
    matchFn: (k) => ["live_telegram_feed", "daily_wins_digest", "master_intelligence_report", "safety_monitor_telegram"].includes(k),
  },
];

function categorizeFlags<T extends { key: string }>(flags: T[]) {
  const categorized: Array<{ label: string; flags: T[] }> = [];
  const claimed = new Set<string>();

  for (const cat of FLAG_CATEGORIES) {
    const matching = flags.filter(f => cat.matchFn(f.key));
    if (matching.length > 0) {
      categorized.push({ label: cat.label, flags: matching });
      matching.forEach(f => claimed.add(f.key));
    }
  }

  // Remaining flags go to "Other"
  const remaining = flags.filter(f => !claimed.has(f.key));
  if (remaining.length > 0) {
    categorized.push({ label: "Other", flags: remaining });
  }

  return categorized;
}

/**
 * Flag safety classification now lives in `@shared/flagPolicy` — see that file
 * for why a key-shape regex was the wrong mechanism (it inverted the copy on the
 * shop-wide SMS kill switch and missed eight flags that contact customers).
 *
 * `confirmDialog({ ... })` remains the delivery mechanism: window.confirm is
 * silently suppressed in the iOS PWA, per the nickstire-ios-pwa skill.
 */

type Filter = "all" | "on" | "off" | "risky" | "switches";

export default function FeatureFlagsPanel() {
  const utils = trpc.useUtils();
  const { data: flags, isLoading } = trpc.featureFlags.list.useQuery();
  const toggleMut = trpc.featureFlags.toggle.useMutation({
    onSuccess: (result) => {
      toast.success(isInvertedFlag(result.key) ? `${pauseSwitchLabel(result.key)} ${result.value ? "paused" : "running"}` : `${result.key} ${result.value ? "ENABLED" : "DISABLED"}`);
      utils.featureFlags.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // wave-181.x Phase 3 · search + filter state
  const [searchQ, setSearchQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Verification gate · confirms the direction that can REACH CUSTOMERS, which
  // for an off-switch like sms_global_pause is OFF, not ON.
  const handleFlagToggle = async (key: string, currentValue: boolean) => {
    const newValue = !currentValue;
    if (requiresConfirmation(key, newValue)) {
      const ok = await confirmDialog({ ...confirmationCopy(key, newValue), tone: "danger" });
      if (!ok) return;
    }
    toggleMut.mutate({ key, value: newValue });
  };

  // Pausing stops a lane, so it is one tap. Resuming restarts a lane that may send, so it always asks first.
  const handleResume = async (key: string) => {
    const copy = isCustomerFacingFlag(key)
      ? confirmationCopy(key, false)
      : { message: "This lane starts again on its next run.", confirmLabel: "Resume", cancelLabel: "Stay paused" };
    const ok = await confirmDialog({ ...copy, title: `Resume ${pauseSwitchLabel(key)}?`, tone: "danger" });
    if (ok) toggleMut.mutate({ key, value: false });
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border/30 p-4">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const allFlags = flags ?? [];
  // The 19 engine_* flags were DECORATIVE — nothing ever called isEnabled()
  // for them; the intelligence engines run unconditionally, so the toggles
  // implied control that didn't exist. They've been removed from
  // FLAG_DEFINITIONS (no longer seeded) and a migration drops the existing
  // DB rows (drizzle/0066_drop_engine_flags.sql). This prefix guard stays so
  // any not-yet-migrated environment still hides the orphaned rows.
  const features = allFlags.filter((f) => !f.inverted && !f.key.startsWith("engine_"));
  const switches = allFlags.filter((f) => f.inverted);
  const enabledCount = features.filter((f) => f.value).length;
  const pausedCount = switches.filter((f) => f.value).length;

  // Apply search + filter
  const q = searchQ.trim().toLowerCase();
  const matchesSearch = (f: { key: string; description: string | null }) =>
    !q || f.key.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q) || pauseSwitchLabel(f.key).toLowerCase().includes(q);
  const filtered = features.filter((f) => {
    if (!matchesSearch(f)) return false;
    if (filter === "switches") return false;
    if (filter === "on" && !f.value) return false;
    if (filter === "off" && f.value) return false;
    if (filter === "risky" && !isCustomerFacingFlag(f.key)) return false;
    return true;
  });
  const shownSwitches = filter === "all" || filter === "switches" ? switches.filter(matchesSearch) : [];
  const grouped = categorizeFlags(filtered);

  return (
    <div className="bg-card border border-border/30 p-4">
      <div className="mb-4">
        <h3 className="font-bold text-sm text-foreground tracking-wide">FEATURE FLAGS</h3>
        <p className="text-foreground/60 text-[12px] mt-0.5">
          {enabledCount} feature{enabledCount === 1 ? "" : "s"} on · {features.length - enabledCount} off · {pausedCount} of {switches.length} pause switches paused
        </p>
      </div>

      {/* wave-181.x Phase 3 · search + filter row */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-foreground/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search flags by key or description…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="w-full bg-foreground/5 border border-border/30 rounded pl-8 pr-3 py-1.5 text-[16px] min-h-[44px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "on", "off", "risky", "switches"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`min-h-[44px] text-[12px] font-bold px-3 rounded border transition-colors ${
                filter === f
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/30 text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {f}
              {f === "risky" && (
                <AlertTriangle className="inline ml-1 w-3 h-3 opacity-70" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && shownSwitches.length === 0 && (
        <p className="text-foreground/40 text-[12px] text-center py-6">
          No flags match · adjust search or filter
        </p>
      )}

      <div className="space-y-4">
        {shownSwitches.length > 0 && (
          <div id="pause-switches">
            <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-border/10">
              <span className="font-bold text-[12px] text-foreground/60 tracking-wider">PAUSE SWITCHES</span>
              <span className="text-[12px] text-foreground/40">{pausedCount} of {switches.length} paused</span>
            </div>
            <div className="space-y-1">
              {shownSwitches.map((s) => {
                const pending = toggleMut.isPending && toggleMut.variables?.key === s.key;
                return (
                  <div
                    key={s.key}
                    data-switch={s.key}
                    className={`flex items-center gap-3 p-2.5 border ${s.value ? "border-amber-500/30 bg-amber-500/5" : "border-border/10"}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-foreground text-[13px] font-medium">{pauseSwitchLabel(s.key)}</span>
                        <span className={`text-[12px] font-semibold ${s.value ? "text-amber-400" : "text-emerald-400"}`}>
                          {s.value ? "Paused" : "Running"}
                        </span>
                      </div>
                      <p className="text-foreground/45 text-[12px] break-words">
                        {s.lastChange
                          ? `changed ${shopDay(s.lastChange.at)} by ${s.lastChange.by}`
                          : s.lastChangeKnown
                            ? "never flipped since install, per the admin audit log"
                            : "change history unavailable"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={toggleMut.isPending}
                      onClick={() => (s.value ? void handleResume(s.key) : toggleMut.mutate({ key: s.key, value: true }))}
                      className={`shrink-0 min-h-[44px] min-w-[88px] px-3 text-[13px] font-semibold border transition-colors disabled:opacity-50 ${
                        s.value
                          ? "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          : "text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                      }`}
                    >
                      {pending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" aria-label="Saving" /> : s.value ? "Resume" : "Pause"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {grouped.map((group) => {
          const groupEnabled = group.flags.filter(f => f.value).length;
          return (
            <div key={group.label}>
              {/* Category Header */}
              <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-border/10">
                <span className="font-bold text-[11px] text-foreground/60 tracking-wider">
                  {group.label.toUpperCase()}
                </span>
                <span className="font-mono text-[10px] text-foreground/30">
                  {groupEnabled}/{group.flags.length}
                </span>
              </div>

              {/* Flag Rows · 2026-05-23 · whole row is the toggle target.
                  Previously only the 24px Toggle icon was clickable — way
                  under iOS 44pt minimum and the operator naturally tapped
                  the row text expecting it to flip. */}
              <div className="space-y-1">
                {group.flags.map((flag) => (
                  <button
                    type="button"
                    key={flag.key}
                    onClick={() => handleFlagToggle(flag.key, flag.value)}
                    disabled={toggleMut.isPending}
                    className={`w-full text-left flex items-center gap-3 p-2.5 border transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                      flag.value ? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10" : "border-border/10 hover:bg-foreground/[0.02]"
                    }`}
                    aria-label={`Toggle ${flag.key}${isCustomerFacingFlag(flag.key) ? " (customer-facing · confirm required)" : ""}`}
                    aria-pressed={flag.value}
                    title={isCustomerFacingFlag(flag.key) ? "Customer-facing flag · flipping ON asks for confirmation" : undefined}
                  >
                    <span className="shrink-0">
                      {toggleMut.isPending && toggleMut.variables?.key === flag.key ? (
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      ) : flag.value ? (
                        <ToggleRight className="w-6 h-6 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-foreground/30" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground text-[12px] font-medium font-mono">{flag.key}</span>
                        {isCustomerFacingFlag(flag.key) && (
                          <span
                            className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20"
                            title="Customer-facing · confirmation required to flip ON"
                          >
                            Risky
                          </span>
                        )}
                      </div>
                      {flag.description && (
                        <p className="text-foreground/40 text-[10px] truncate">{flag.description}</p>
                      )}
                    </div>
                    <span className={`text-[10px] font-medium tracking-[0.12em] ${
                      flag.value ? "text-emerald-400" : "text-foreground/20"
                    }`}>
                      {flag.value ? "ON" : "OFF"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
