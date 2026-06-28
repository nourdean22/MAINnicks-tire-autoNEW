"use client";

// FRESHNESS_EXEMPT — config form (mutates settings, doesn't display
// time-sensitive read data; live values reload immediately on change).

/**
 * JournalBrainPanel — the Journal Brain tuning surface on /settings.
 *
 * Live-mutable knobs for the journal scoring/behavior engine, read from
 * `journal.getSettings` and written field-by-field via
 * `journal.updateSettings` (a PARTIAL of the same shape). Mirrors the
 * AiSettingsPanel live-mutation pattern exactly: every control fires the
 * single changed field, the server upserts the singleton row + returns the
 * merged config, local state snaps to it, and the getSettings cache is
 * invalidated so any other reader refetches.
 *
 * The seven knobs (defaults in parens):
 *   · baselineEnabled (true)        — score every qualifying capture
 *   · baselineXp (0.8)              — baseline mastery XP per entry
 *   · qualityFloorChars (40)        — anti-gaming min chars for baseline XP
 *   · groundedXpMultiplier (1.5)    — bonus when an entry links to a goal
 *   · autoConfirmThreshold (0.8)    — auto-confirm a goal link at/above this
 *   · challengeCadence ("daily")    — every | daily | off
 *   · creativeIntensity ("bold")    — bold | balanced | off
 */

import { useState, useEffect, useCallback, useId } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { BookOpen } from "lucide-react";
import { haptic } from "@/lib/ui/haptic";
import { SegmentedSelect, Toggle } from "./settings-controls";

import { trpc } from "@/lib/trpc/client";

// Mirrors JournalSettingsValues in lib/journal/settings.ts (the getSettings
// return + the updateSettings input keys). Kept local so the panel owns the
// optimistic copy without importing server-only modules.
interface JournalSettings {
  baselineXp: number;
  baselineEnabled: boolean;
  qualityFloorChars: number;
  groundedXpMultiplier: number;
  autoConfirmThreshold: number;
  challengeCadence: "every" | "daily" | "off";
  creativeIntensity: "bold" | "balanced" | "off";
}

export function JournalBrainPanel() {
  const [settings, setSettings] = useState<JournalSettings | null>(null);
  const utils = trpc.useUtils();

  // Initial load via the typed query result. We then hold a local optimistic
  // copy (the panel mutates fields on every slider/toggle, so it can't render
  // straight off the query cache).
  const settingsQuery = trpc.journal.getSettings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (settingsQuery.data) setSettings(settingsQuery.data as JournalSettings);
  }, [settingsQuery.data]);

  const updateMutation = trpc.journal.updateSettings.useMutation();

  // Partial update helper — optimistic local set + typed mutation. On success
  // the server returns the merged singleton row; we snap to it and invalidate
  // getSettings so any other reader refetches the new values.
  const patch = useCallback(
    async (p: Partial<JournalSettings>) => {
      setSettings((s) => (s ? { ...s, ...p } : s));
      haptic.tap();
      try {
        const updated = await updateMutation.mutateAsync(p);
        setSettings(updated as JournalSettings);
        await utils.journal.getSettings.invalidate();
        haptic.success();
      } catch {
        // Roll back the optimistic field to the last server-confirmed value.
        if (settingsQuery.data) setSettings(settingsQuery.data as JournalSettings);
        haptic.error();
      }
    },
    [updateMutation, utils, settingsQuery.data],
  );

  // Loading guard — same skeleton convention as AiSettingsPanel.
  if (!settings) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={13} className="text-[var(--gold)]" />
          <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
            Journal Brain
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">loading…</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={13} className="text-[var(--gold)]" />
        <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
          Journal Brain
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mb-3">
        Tune how the journal scores captures, grounds them to goals, and
        challenges you. Changes save the moment you make them.
      </p>

      {/* Score every capture (master switch) */}
      <Row label="Score every capture" hint="Award baseline XP on every qualifying entry">
        <Toggle
          value={settings.baselineEnabled}
          onChange={(v) => patch({ baselineEnabled: v })}
        />
      </Row>

      {/* Baseline XP per qualifying entry */}
      <Row
        label={`Baseline XP · ${settings.baselineXp.toFixed(1)}`}
        hint="Baseline XP per qualifying entry"
      >
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={settings.baselineXp}
          disabled={!settings.baselineEnabled}
          onChange={(e) => patch({ baselineXp: parseFloat(e.target.value) })}
          aria-label="Baseline XP per qualifying entry"
          className="w-32 accent-[var(--gold)] disabled:opacity-40"
        />
      </Row>

      {/* Anti-gaming character floor */}
      <Row
        label="Quality floor"
        hint="Min characters to earn baseline XP (anti-gaming)"
      >
        <NumberInput
          value={settings.qualityFloorChars}
          min={0}
          max={2000}
          step={10}
          suffix="chars"
          onCommit={(n) => patch({ qualityFloorChars: n })}
          ariaLabel="Min characters to earn baseline XP"
        />
      </Row>

      {/* Grounded bonus multiplier */}
      <Row
        label={`Grounded bonus · ${settings.groundedXpMultiplier.toFixed(1)}×`}
        hint="Bonus multiplier when an entry is linked to a goal"
      >
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={settings.groundedXpMultiplier}
          onChange={(e) =>
            patch({ groundedXpMultiplier: parseFloat(e.target.value) })
          }
          aria-label="Bonus multiplier when an entry is linked to a goal"
          className="w-32 accent-[var(--gold)]"
        />
      </Row>

      {/* Auto-confirm threshold */}
      <Row
        label={`Auto-confirm link · ${settings.autoConfirmThreshold.toFixed(2)}`}
        hint="Auto-confirm a goal link at/above this confidence"
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.autoConfirmThreshold}
          onChange={(e) =>
            patch({ autoConfirmThreshold: parseFloat(e.target.value) })
          }
          aria-label="Auto-confirm a goal link at or above this confidence"
          className="w-32 accent-[var(--gold)]"
        />
      </Row>

      {/* Challenge cadence */}
      <Row label="Challenge cadence" hint="How often the journal challenges you">
        <SegmentedSelect
          value={settings.challengeCadence}
          options={["every", "daily", "off"]}
          onChange={(v) =>
            patch({ challengeCadence: v as JournalSettings["challengeCadence"] })
          }
        />
      </Row>

      {/* Creative intensity */}
      <Row
        label="Creative intensity"
        hint="How bold the journal's idea generation is"
      >
        <SegmentedSelect
          value={settings.creativeIntensity}
          options={["bold", "balanced", "off"]}
          onChange={(v) =>
            patch({ creativeIntensity: v as JournalSettings["creativeIntensity"] })
          }
        />
      </Row>

      {updateMutation.isError && (
        <p role="alert" className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">
          ⚠ Server rejected the change — reverted to the last saved value.
        </p>
      )}
    </GlassCard>
  );
}

// ── Helper components (mirror AiSettingsPanel's Row / SegmentedSelect /
//    Toggle so the Journal Brain card is visually identical to AI Config) ──

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  // a11y (WCAG 1.3.1/4.1.2): controls are heterogeneous (button groups,
  // role=switch toggle, native range/number). A single htmlFor can't name a
  // button group, so the label gets an id and the control container is the
  // named group via aria-labelledby.
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-default)]/40 last:border-b-0">
      <div className="min-w-0">
        <label id={labelId} className="text-[11px] text-[var(--text-secondary)]">
          {label}
        </label>
        {hint && (
          <p className="text-[9px] text-[var(--text-tertiary)] mt-0.5">{hint}</p>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex shrink-0 items-center gap-2"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Small numeric field that commits on blur / Enter (not every keystroke) so a
 * partial typed value never fires a mutation. Clamps to [min, max].
 */
function NumberInput({
  value,
  min,
  max,
  step,
  suffix,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (n: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(String(value));
  // Keep the draft in sync when the server-confirmed value changes elsewhere.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-16 h-7 px-2 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] focus:border-[var(--gold)]/40 outline-none font-mono tabular-nums text-right"
      />
      {suffix && (
        <span className="text-[9px] text-[var(--text-tertiary)]">{suffix}</span>
      )}
    </div>
  );
}
