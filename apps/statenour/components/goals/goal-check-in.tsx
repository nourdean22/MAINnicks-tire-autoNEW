"use client";

/**
 * The goal card's check-in (job 2026-11-02-nour-os-interconnect W2; research map 4.1, 4.3):
 *  - GoalHealthChip: health from the newest check-in, gray when none in the cadence (Linear L2).
 *  - SinceCheckInView: what happened since the last check-in, from the relatedActivity spine (Tana T1).
 *  - GoalCheckInPanel: "Check in" asks Nick for a draft (Linear L4/L5); Nour edits it in the DOM
 *    (never a native prompt, iOS PWA suppresses those) and saves through the one check-in writer.
 * Views take plain data so every state renders without a network. A failed read says "couldn't read".
 */
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged } from "@/lib/events/data-change";
import { CHECK_IN_HEALTH, type CheckInHealth, type GoalHealth, type GoalHealthState } from "@/lib/brain/goal-pace";

const DAY_MS = 86_400_000;

const HEALTH_VIEW: Record<GoalHealthState, { label: string; tone: string }> = {
  on_track: { label: "on track", tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" },
  at_risk: { label: "at risk", tone: "border-amber-500/30 bg-amber-500/5 text-amber-300" },
  off_track: { label: "off track", tone: "border-rose-500/30 bg-rose-500/5 text-rose-300" },
  no_check_in: { label: "no check-in · check in", tone: "border-edge-subtle text-fg-tertiary" },
  unknown: { label: "health unknown", tone: "border-edge-subtle text-fg-tertiary" },
};

export function healthChipView(state: GoalHealthState) {
  return HEALTH_VIEW[state] ?? HEALTH_VIEW.unknown;
}

const agoLabel = (iso: string, now: number) => {
  const d = Math.floor((now - Date.parse(iso)) / DAY_MS);
  return d <= 0 ? "today" : `${d}d ago`;
};

/** Tapping the chip opens the card, where the check-in lives. */
export function GoalHealthChip({ health, onOpen }: { health: GoalHealth | undefined; onOpen: () => void }) {
  if (!health) return null;
  const v = healthChipView(health.state);
  const title = health.at ? `Last check-in ${health.at.slice(0, 10)}${health.note ? `: ${health.note}` : ""}` : "No check-in yet";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={title}
      className={cn("min-h-11 inline-flex items-center px-2 rounded-control border", v.tone)}
    >
      {v.label}
    </button>
  );
}

export type SinceRead =
  | "loading"
  | "error"
  | "not_found"
  | { since: string | null; total: number; items: Array<{ at: string; kind: string; title: string }>; failed: string[] };

export function SinceCheckInView({ read, now = Date.now() }: { read: SinceRead; now?: number }) {
  if (read === "loading") return <p className="text-[12px] text-fg-tertiary">Reading what happened since the last check-in</p>;
  if (read === "error") return <p className="text-[12px] text-amber-300">Couldn&apos;t read what happened since the last check-in</p>;
  if (read === "not_found") return <p className="text-[12px] text-fg-tertiary">Goal not found: it may have been archived</p>;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-mono text-fg-tertiary">Since last check-in{read.since ? ` (${read.since.slice(0, 10)})` : ""}</p>
      {read.items.length === 0 && read.failed.length === 0 && (
        <p className="text-[12px] text-fg-secondary">Nothing logged since the last check-in</p>
      )}
      {read.items.length > 0 && (
        <ul className="space-y-0.5">
          {read.items.map((i) => (
            <li key={`${i.at}-${i.kind}-${i.title}`} className="text-[12px] text-fg-secondary line-clamp-1">
              {`${i.kind.replace(/_event$/, "")} · ${i.title} · ${agoLabel(i.at, now)}`}
            </li>
          ))}
        </ul>
      )}
      {read.total > read.items.length && <p className="text-[11px] text-fg-tertiary">+{read.total - read.items.length} more</p>}
      {read.failed.map((f) => (
        <p key={f} className="text-[11px] text-amber-300">couldn&apos;t read {f}</p>
      ))}
    </div>
  );
}

export type DraftState = { kind: "drafting" } | { kind: "drafted" } | { kind: "unavailable"; reason: string } | { kind: "manual" };

const HEALTH_LABEL: Record<CheckInHealth, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track" };

export function CheckInFormView(p: {
  metric: boolean;
  unit: string;
  health: CheckInHealth | null;
  note: string;
  value: string;
  draftState: DraftState;
  saving: boolean;
  error: string | null;
  onHealth: (h: CheckInHealth) => void;
  onNote: (s: string) => void;
  onValue: (s: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const canSave = !!p.health && p.note.trim().length > 0 && !p.saving && p.draftState.kind !== "drafting";
  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {p.draftState.kind === "drafting" && <p className="text-[11px] text-fg-tertiary">Nick is drafting from what happened</p>}
      {p.draftState.kind === "drafted" && <p className="text-[11px] text-fg-tertiary">Drafted by Nick, edit before saving</p>}
      {p.draftState.kind === "unavailable" && <p className="text-[11px] text-amber-300">No draft: {p.draftState.reason}</p>}
      <div className="flex gap-1.5" role="group" aria-label="Goal health">
        {CHECK_IN_HEALTH.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={p.health === h}
            onClick={() => p.onHealth(h)}
            className={cn(
              "min-h-11 flex-1 rounded-control border px-2 text-[12px]",
              p.health === h ? healthChipView(h).tone : "border-edge-default bg-surface-interactive text-fg-secondary",
            )}
          >
            {HEALTH_LABEL[h]}
          </button>
        ))}
      </div>
      <textarea
        value={p.note}
        onChange={(e) => p.onNote(e.target.value)}
        maxLength={500}
        rows={2}
        aria-label="Check-in note"
        placeholder="One line on why"
        className="min-h-11 w-full bg-content border border-edge-default rounded-control px-2 py-1 text-[16px] text-fg placeholder:text-fg-tertiary focus:outline-none focus:border-accent"
      />
      {p.metric && (
        <input
          type="number"
          inputMode="decimal"
          value={p.value}
          onChange={(e) => p.onValue(e.target.value)}
          aria-label="Value now"
          placeholder={`Value now${p.unit ? ` (${p.unit})` : ""}, leave empty if unchanged`}
          className="min-h-11 w-full bg-content border border-edge-default rounded-control px-2 py-1 text-[16px] text-fg placeholder:text-fg-tertiary focus:outline-none focus:border-accent"
        />
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!canSave}
          onClick={p.onSave}
          className="min-h-11 flex-1 rounded-control border border-edge-default bg-surface-interactive px-2 text-[12px] font-medium text-fg disabled:opacity-50"
        >
          Save check-in
        </button>
        <button
          type="button"
          onClick={p.onCancel}
          className="min-h-11 min-w-11 rounded-control px-2 text-[12px] text-fg-tertiary hover:text-fg-secondary"
        >
          Cancel
        </button>
      </div>
      {p.error && <p className="text-[11px] text-rose-300">{p.error}</p>}
    </div>
  );
}

/** The expanded card's check-in block: the since-list, then "Check in" with Nick's draft. */
export function GoalCheckInPanel({
  goal,
  onSaved,
}: {
  goal: { id: string; kind?: string; unit: string };
  onSaved: () => void;
}) {
  const sinceQ = trpc.task.goalSinceCheckIn.useQuery({ goalId: goal.id }, { staleTime: 60_000 });
  const draftMut = trpc.task.draftGoalCheckIn.useMutation();
  const saveMut = trpc.task.goalCheckIn.useMutation();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<CheckInHealth | null>(null);
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [draftState, setDraftState] = useState<DraftState>({ kind: "manual" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // A ref, not isPending: two taps in one render both read the same stale isPending.
  const inFlight = useRef(false);
  const metric = (goal.kind ?? "metric") === "metric";

  const read: SinceRead = sinceQ.isError
    ? "error"
    : sinceQ.data
      ? sinceQ.data.found
        ? sinceQ.data
        : "not_found"
      : "loading";

  const start = async () => {
    setOpen(true);
    setSaved(null);
    setError(null);
    // A fresh check-in never carries the last one's words (second reader P2-1).
    setHealth(null);
    setNote("");
    setValue("");
    setDraftState({ kind: "drafting" });
    try {
      const d = await draftMut.mutateAsync({ goalId: goal.id });
      if (d.unavailable) {
        setDraftState({ kind: "unavailable", reason: d.reason });
        return;
      }
      setHealth(d.health);
      setNote(d.note);
      setValue(d.valueSuggestion !== undefined ? String(d.valueSuggestion) : "");
      setDraftState({ kind: "drafted" });
    } catch (err) {
      setDraftState({ kind: "unavailable", reason: err instanceof Error && err.message ? err.message.slice(0, 120) : "no reason returned" });
    }
  };

  const save = async () => {
    if (!health || !note.trim() || inFlight.current) return;
    const v = value.trim() === "" ? undefined : Number(value);
    if (v !== undefined && !Number.isFinite(v)) {
      setError("The value is not a number");
      return;
    }
    inFlight.current = true;
    setError(null);
    try {
      const r = await saveMut.mutateAsync({ goalId: goal.id, health, note: note.trim(), ...(metric && v !== undefined ? { value: v } : {}) });
      if (!r.logged) {
        setError(`Not saved: ${r.reason}`);
        return;
      }
      setOpen(false);
      setSaved(`Checked in: ${healthChipView(health).label}`);
      notifyDataChanged("goals", { source: "goal-board", detail: "check-in", id: goal.id });
      void sinceQ.refetch();
      onSaved();
    } catch (err) {
      setError(`Couldn't save the check-in: ${err instanceof Error && err.message ? err.message.slice(0, 120) : "no reason returned"}`);
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-control border border-edge-subtle px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
      <SinceCheckInView read={read} />
      {open ? (
        <CheckInFormView
          metric={metric}
          unit={goal.unit}
          health={health}
          note={note}
          value={value}
          draftState={draftState}
          saving={saveMut.isPending}
          error={error}
          onHealth={setHealth}
          onNote={setNote}
          onValue={setValue}
          onSave={() => void save()}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void start()}
            className="min-h-11 rounded-control border border-edge-default bg-surface-interactive px-3 text-[12px] font-medium text-fg"
          >
            Check in
          </button>
          {saved && <span className="text-[11px] text-fg-tertiary">{saved}</span>}
        </div>
      )}
    </div>
  );
}
