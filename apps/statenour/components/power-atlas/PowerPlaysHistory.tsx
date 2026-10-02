"use client";

/**
 * <PowerPlaysHistory> · 2026-05-27 · Power Atlas Phase 3 polish
 *
 * Renders the last 10 RelationshipPlay rows for a person · already
 * returned by `task.personProfile`. Each row shows kind · relative
 * createdAt · current outcome chip. Click expands the row to reveal
 * the JSON output pretty-printed.
 *
 * Each row also exposes an inline outcome dropdown so the operator
 * can after-the-fact mark win / partial / loss / not_executed via
 * `markPlayOutcome`. Optimistic local state · tRPC mutation persists.
 *
 * No emojis. Serif heading. Monospace timestamps + amounts.
 * 1px borders. Mounts in detail-panel left column below
 * TopicGoalOverlapCard.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

type PlayKind =
  | "arc_plan"
  | "message_draft"
  | "scarcity_play"
  | "reciprocity_assess"
  | string;

type PlayOutcome = "win" | "partial" | "loss" | "not_executed" | null;

interface PlayRow {
  id: string;
  createdAt: Date | string;
  kind: PlayKind;
  output: unknown;
  outcome: string | null;
  outcomeNote: string | null;
}

interface PowerPlaysHistoryProps {
  plays: PlayRow[];
  personId: string;
}

function relativeTime(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) {
    const hours = Math.floor(diffMs / 3600000);
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function kindLabel(k: PlayKind): string {
  return k.replace(/_/g, " ");
}

function outcomeTone(o: PlayOutcome): {
  border: string;
  bg: string;
  text: string;
  label: string;
} {
  switch (o) {
    case "win":
      return {
        border: "border-emerald-500/30",
        bg: "bg-emerald-500/[0.08]",
        text: "text-emerald-200",
        label: "win",
      };
    case "partial":
      return {
        border: "border-amber-500/30",
        bg: "bg-amber-500/[0.08]",
        text: "text-amber-200",
        label: "partial",
      };
    case "loss":
      return {
        border: "border-rose-500/30",
        bg: "bg-rose-500/[0.08]",
        text: "text-rose-200",
        label: "loss",
      };
    case "not_executed":
      return {
        border: "border-edge-default",
        bg: "bg-surface-interactive",
        text: "text-fg-secondary",
        label: "not executed",
      };
    default:
      return {
        border: "border-edge-subtle",
        bg: "bg-transparent",
        text: "text-fg-tertiary",
        label: "none",
      };
  }
}

function PlayRowDisplay({
  play,
  personId,
}: {
  play: PlayRow;
  personId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localOutcome, setLocalOutcome] = useState<string | null>(play.outcome);
  const utils = trpc.useUtils();
  const mutation = trpc.task.markPlayOutcome.useMutation({
    onSuccess: () => {
      void utils.task.personProfile.invalidate({ personId });
    },
  });

  const tone = outcomeTone(localOutcome as PlayOutcome);

  return (
    <li
      className="border-b border-edge-subtle last:border-b-0 py-2"
    >
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="flex items-baseline gap-2 text-left flex-1 min-w-0"
          aria-expanded={expanded}
        >
          <span className="text-[13px] font-medium text-fg-secondary">
            {kindLabel(play.kind)}
          </span>
          <span className="font-mono text-[11px] text-fg-tertiary tabular-nums">
            {relativeTime(play.createdAt)}
          </span>
          <span
            className={`font-mono text-[11px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-micro border ${tone.border} ${tone.bg} ${tone.text}`}
          >
            {tone.label}
          </span>
        </button>
        <select
          value={localOutcome ?? ""}
          disabled={mutation.isPending}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setLocalOutcome(v);
            mutation.mutate({
              playId: play.id,
              outcome: v as "win" | "partial" | "loss" | "not_executed",
            });
          }}
          className="text-[13px] font-medium bg-transparent border border-edge-default rounded-control px-1.5 py-0.5 text-fg-tertiary focus:border-accent focus:text-fg-secondary focus:outline-none disabled:opacity-50"
          aria-label="mark outcome"
        >
          <option value="">set outcome</option>
          <option value="win">win</option>
          <option value="partial">partial</option>
          <option value="loss">loss</option>
          <option value="not_executed">not executed</option>
        </select>
      </div>

      {play.outcomeNote && (
        <p className="mt-1 text-[11px] italic text-fg-tertiary">
          note: {play.outcomeNote}
        </p>
      )}

      {expanded && (
        <pre
          className="mt-2 font-mono text-[11px] leading-snug overflow-x-auto rounded-control border border-edge-subtle bg-surface-interactive p-2 text-fg-secondary whitespace-pre-wrap break-words"
        >
          {(() => {
            try {
              return JSON.stringify(play.output, null, 2);
            } catch {
              return "(unable to render output)";
            }
          })()}
        </pre>
      )}
    </li>
  );
}

export default function PowerPlaysHistory({
  plays,
  personId,
}: PowerPlaysHistoryProps) {
  if (plays.length === 0) {
    return (
      <section
        className="rounded-surface border border-edge-subtle bg-content p-4"
      >
        <h3 className="text-[15px] font-semibold text-fg mb-2">
          Plays history
        </h3>
        <p className="text-xs text-fg-tertiary">
          No plays run yet. Use Power plays in the right rail to draft an
          arc / message / scarcity play.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-[15px] font-semibold text-fg">
          Plays history
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          last 10
        </span>
      </div>
      <ol>
        {plays.map((p) => (
          <PlayRowDisplay key={p.id} play={p} personId={personId} />
        ))}
      </ol>
    </section>
  );
}
