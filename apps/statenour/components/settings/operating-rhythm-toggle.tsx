"use client";

/**
 * components/settings/operating-rhythm-toggle.tsx · 2026-06-02
 *
 * The ONLY autopilot flag a worker actually reads:
 * `adhd_operating_rhythm` (lib/brain/operating-rhythm.ts:131 — the
 * 5x-daily Telegram checkpoint cron disables itself when this flag is
 * explicitly false). The prior 13-toggle AutoPilotControls grid carried
 * 12 other flags + shadow-mode + mood-dimming + proof-of-life badges
 * that NO worker consumed (grep-verified) — pure dead UI. This replaces
 * that ~610-line section with the single real control.
 *
 * Read/write via the SAME tRPC procedures the old grid used:
 *   · system.autopilotFlags    (read the persisted flag map)
 *   · system.setAutopilotFlags (persist; the service merges over the
 *     server defaults so sending just this one key preserves the rest)
 *
 * The flag defaults to ON when absent — operating-rhythm.ts only honors
 * an explicit `=== false`. So the toggle reads ON until the server map
 * says otherwise, and disabling requires a press-and-hold confirm (this
 * cron guards the operator's focus structure — a stray mobile tap
 * shouldn't kill it). Re-enabling is a single tap.
 */

import { useState } from "react";
import { Activity } from "lucide-react";
import { ConfirmHold } from "@/components/ui/confirm-hold";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged } from "@/lib/events/data-change";

const FLAG_KEY = "adhd_operating_rhythm";

export function OperatingRhythmToggle() {
  const utils = trpc.useUtils();
  const query = trpc.system.autopilotFlags.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const setFlags = trpc.system.setAutopilotFlags.useMutation();
  const [mutationError, setMutationError] = useState<string | null>(null);
  // Press-and-hold gate · only set when the operator taps the toggle
  // while it is ENABLED. Disabling this cron is the destructive path.
  const [pendingDisable, setPendingDisable] = useState(false);

  // Absent flag → ON (worker honors only an explicit false). While the
  // query is loading, default to ON so the live region doesn't flicker.
  const enabled = query.data?.flags?.[FLAG_KEY] !== false;

  function commit(next: boolean) {
    setMutationError(null);
    // Merge over the CURRENT persisted map, not just this key. The
    // service merges what it receives over AUTOPILOT_DEFAULTS (not over
    // the stored row), so a single-key payload would reset every other
    // stored flag back to its default. Spreading the live map first keeps
    // every other stored value untouched and flips only this flag. (None
    // of the other keys drive a worker today — this is belt-and-braces so
    // the write can never have a surprise side effect.)
    const map = { ...(query.data?.flags ?? {}), [FLAG_KEY]: next };
    setFlags.mutate(
      { flags: map },
      {
        onSuccess: () => {
          void utils.system.autopilotFlags.invalidate();
        },
        onError: (err) => {
          setMutationError(
            err.message || "Server rejected the change — try again.",
          );
        },
      },
    );
    notifyDataChanged("settings", {
      source: "settings-page",
      detail: "operating-rhythm-toggle",
      id: FLAG_KEY,
    });
  }

  function handleTap() {
    if (enabled) {
      // Destructive: expand into the hold-to-confirm row.
      setPendingDisable(true);
      return;
    }
    commit(true);
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-[var(--gold)]" />
          <span className="text-sm font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            operating rhythm
          </span>
        </div>
        <button
          type="button"
          onClick={handleTap}
          disabled={setFlags.isPending}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "disable operating rhythm" : "enable operating rhythm"}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors",
            enabled ? "bg-[var(--gold)]" : "bg-zinc-700",
            pendingDisable && "bg-rose-500/40",
            setFlags.isPending && "opacity-50",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
              enabled ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)]">
        {enabled
          ? "On — Telegram checkpoints at 8am, 11am, 2pm, 5pm, 9pm guard focus and enforce shutdown."
          : "Off — no daily focus checkpoints. Tap to re-enable."}
      </p>
      {pendingDisable && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-2">
          <span className="flex-1 text-[10px] text-rose-300">
            Disable the focus checkpoints? This stops the cron from firing.
          </span>
          <ConfirmHold
            label="hold to disable"
            variant="danger"
            holdMs={800}
            onConfirm={() => {
              setPendingDisable(false);
              commit(false);
            }}
          />
          <button
            type="button"
            onClick={() => setPendingDisable(false)}
            className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800"
          >
            cancel
          </button>
        </div>
      )}
      {mutationError && (
        <p className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
          ⚠ {mutationError}
        </p>
      )}
    </div>
  );
}
