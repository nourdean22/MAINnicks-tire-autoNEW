"use client";

/**
 * PeopleScoringPanel · 2026-06-01 · statenour/people-overhaul
 *
 * Operator control for the people-credit XP weights — how much mastery
 * XP relationship work earns. Scoped ONLY to the people-credit numbers
 * (deposits, neglect-repair, power-plays); it does NOT touch the
 * task-side scoring config. Reads/writes via trpc.task.get/setPeopleXpConfig
 * (UserPreference key `people_credit.weights`). Blank/invalid values fall
 * back to the engine defaults, so this can never zero out scoring by typo.
 */
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type Weights = {
  depositBase: number;
  depositPerAmount: number;
  depositMax: number;
  reconnectBonus: number;
  play: number;
};

const FIELDS: {
  key: keyof Weights;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
}[] = [
  { key: "depositBase", label: "deposit · base", hint: "floor XP for any positive ledger deposit", step: 0.1, min: 0, max: 5 },
  { key: "depositPerAmount", label: "deposit · per +1", hint: "extra XP per point of deposit amount", step: 0.01, min: 0, max: 1 },
  { key: "depositMax", label: "deposit · cap", hint: "ceiling for one deposit", step: 0.1, min: 0, max: 10 },
  { key: "reconnectBonus", label: "neglect-repair bonus", hint: "extra Relationships XP when a deposit revives a 14d-cold bond", step: 0.1, min: 0, max: 5 },
  { key: "play", label: "power-play", hint: "XP for one executed power-play", step: 0.1, min: 0, max: 10 },
];

export function PeopleScoringPanel() {
  const query = trpc.task.getPeopleXpConfig.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const utils = trpc.useUtils();
  const save = trpc.task.setPeopleXpConfig.useMutation({
    onSuccess: () => {
      setSavedAt(Date.now());
      void utils.task.getPeopleXpConfig.invalidate();
    },
  });

  const [draft, setDraft] = useState<Weights | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seed the draft once the server config lands.
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data as Weights);
  }, [query.data, draft]);

  const dirty =
    !!draft &&
    !!query.data &&
    FIELDS.some((f) => draft[f.key] !== (query.data as Weights)[f.key]);

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-fg">
            People scoring
          </span>
        </div>
        {/* Always in the DOM so the live region announces the transition to
            "saved" (a conditionally-mounted region never fires for AT). */}
        <span
          role="status"
          aria-live="polite"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-300"
        >
          {savedAt && !dirty ? "saved" : ""}
        </span>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mb-4">
        How much mastery XP relationship work earns. Deposits credit{" "}
        <span className="text-fg">Networking</span> /{" "}
        <span className="text-fg">Relationships</span>; power-plays
        credit <span className="text-fg">Persuasion</span> /{" "}
        <span className="text-fg">Seduction</span> /{" "}
        <span className="text-fg">Strategy</span>.
      </p>

      <GlassCard>
        {!draft ? (
          <p className="text-[11px] text-[var(--text-tertiary)]">loading weights…</p>
        ) : (
          <div className="space-y-3">
            {FIELDS.map((f) => (
              <label
                key={f.key}
                className="flex items-center justify-between gap-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                    {f.label}
                  </span>
                  <span className="block text-[11px] text-fg-tertiary">
                    {f.hint}
                  </span>
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={Number.isFinite(draft[f.key]) ? draft[f.key] : ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setDraft((d) =>
                      d ? { ...d, [f.key]: Number.isFinite(v) ? v : 0 } : d,
                    );
                  }}
                  className="w-20 shrink-0 rounded-control border border-edge-default bg-content px-2 py-1.5 text-right text-[13px] font-mono tabular-nums text-fg focus:border-accent focus:outline-none"
                />
              </label>
            ))}

            <div className="flex items-center justify-between pt-1">
              {save.error ? (
                <span role="alert" className="text-[12px] text-rose-300">
                  {save.error.message}
                </span>
              ) : (
                <span className="text-[11px] text-fg-tertiary">
                  blank/invalid values fall back to engine defaults
                </span>
              )}
              <button
                type="button"
                aria-label="save people scoring weights"
                disabled={!dirty || save.isPending}
                onClick={() => draft && save.mutate(draft)}
                className={cn(
                  "rounded-control border px-3 py-1.5 text-[13px] font-medium transition-colors duration-[var(--motion-state)]",
                  dirty && !save.isPending
                    ? "border-edge-default bg-content text-fg-secondary hover:border-edge-strong hover:text-fg"
                    : "border-edge-default text-fg-tertiary cursor-not-allowed",
                )}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
