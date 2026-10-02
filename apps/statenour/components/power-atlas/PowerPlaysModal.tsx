"use client";

/**
 * <PowerPlaysModal> · 2026-05-27 · Power Atlas Phase 2
 *
 * Trigger button → modal with 4 power-play kinds:
 *   · arc_plan          → planned conversation (phases)
 *   · message_draft     → ready-to-send message draft
 *   · scarcity_play     → Law 16 scarcity playbook
 *   · reciprocity_assess→ initiator asymmetry recommendation
 *
 * Operator picks a kind + optionally writes a goal, fires the
 * runPowerPlay mutation, and reads the structured output back as
 * readable card sections. The run is persisted to RelationshipPlay
 * for review history.
 *
 * No emojis. Serif heading. Output rendered as code blocks for now
 * (the JSON shapes vary per play kind · richer per-kind renderers
 * land in Phase 3 if needed).
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc/client";

type PlayKind =
  | "arc_plan"
  | "message_draft"
  | "scarcity_play"
  | "reciprocity_assess";

const KIND_LABELS: Record<PlayKind, string> = {
  arc_plan: "plan conversation",
  message_draft: "draft message",
  scarcity_play: "scarcity play",
  reciprocity_assess: "reciprocity check",
};

interface PowerPlaysModalProps {
  personId: string;
  personName: string;
}

interface ArcPlanOutput {
  goal?: string;
  currentState?: string;
  desiredState?: string;
  phases?: Array<{ order?: number; label?: string; prompt?: string }>;
}

interface MessageDraftOutput {
  subject?: string;
  body?: string;
  rationale?: string;
}

interface ScarcityPlayOutput {
  when?: string;
  how?: string;
  why?: string;
  lawApplied?: number;
}

interface ReciprocityOutput {
  operatorInitiatedPct?: number;
  theirInitiatedPct?: number;
  recommendation?: string;
}

function PlayOutput({ kind, output }: { kind: PlayKind; output: unknown }) {
  if (output === null || output === undefined) return null;

  if (kind === "arc_plan") {
    const o = output as ArcPlanOutput;
    return (
      <div className="space-y-2 text-xs text-fg-secondary">
        {o.goal && (
          <p>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
              goal
            </span>
            {o.goal}
          </p>
        )}
        {o.currentState && o.desiredState && (
          <p>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
              from → to
            </span>
            {o.currentState} → {o.desiredState}
          </p>
        )}
        {o.phases && o.phases.length > 0 && (
          <ol className="space-y-2 list-none">
            {o.phases.map((ph, i) => (
              <li
                key={i}
                className="border-l-2 border-edge-strong pl-3"
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300/80">
                  {String(ph.order ?? i + 1).padStart(2, "0")} ·{" "}
                  {ph.label ?? "phase"}
                </div>
                <p className="mt-1">{ph.prompt ?? ""}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (kind === "message_draft") {
    const o = output as MessageDraftOutput;
    return (
      <div className="space-y-3 text-xs text-fg-secondary">
        {o.subject && (
          <p>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
              subject
            </span>
            <span className="font-mono">{o.subject}</span>
          </p>
        )}
        {o.body && (
          <pre className="text-xs whitespace-pre-wrap font-sans bg-canvas border border-edge-subtle rounded-control p-3">
            {o.body}
          </pre>
        )}
        {o.rationale && (
          <p
            className="border-t border-edge-subtle pt-2 italic text-fg"
          >
            &ldquo;{o.rationale}&rdquo;
          </p>
        )}
      </div>
    );
  }

  if (kind === "scarcity_play") {
    const o = output as ScarcityPlayOutput;
    return (
      <div className="space-y-2 text-xs text-fg-secondary">
        {o.when && (
          <p>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
              when
            </span>
            {o.when}
          </p>
        )}
        {o.how && (
          <p>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
              how
            </span>
            {o.how}
          </p>
        )}
        {o.why && (
          <p
            className="border-t border-edge-subtle pt-2 italic text-fg"
          >
            &ldquo;{o.why}&rdquo;
          </p>
        )}
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300/70">
          law applied · {o.lawApplied ?? 16}
        </p>
      </div>
    );
  }

  if (kind === "reciprocity_assess") {
    const o = output as ReciprocityOutput;
    return (
      <div className="space-y-2 text-xs text-fg-secondary">
        {(o.operatorInitiatedPct !== undefined ||
          o.theirInitiatedPct !== undefined) && (
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>operator: {o.operatorInitiatedPct ?? "?"}%</span>
            <span className="text-fg-tertiary">·</span>
            <span>them: {o.theirInitiatedPct ?? "?"}%</span>
          </div>
        )}
        {o.recommendation && (
          <p
            className="border-t border-edge-subtle pt-2 italic text-fg"
          >
            &ldquo;{o.recommendation}&rdquo;
          </p>
        )}
      </div>
    );
  }

  return (
    <pre className="font-mono text-[11px] whitespace-pre-wrap text-fg-tertiary">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

export default function PowerPlaysModal({
  personId,
  personName,
}: PowerPlaysModalProps) {
  const [open, setOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<PlayKind | null>(null);
  const [goal, setGoal] = useState("");
  const [output, setOutput] = useState<unknown>(null);
  const mutation = trpc.task.runPowerPlay.useMutation();

  function reset() {
    setSelectedKind(null);
    setGoal("");
    setOutput(null);
  }

  async function runPlay(kind: PlayKind) {
    setSelectedKind(kind);
    setOutput(null);
    const r = await mutation.mutateAsync({
      personId,
      kind,
      operatorGoal: goal.trim() ? goal.trim() : undefined,
    });
    setOutput(r.output);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        Power plays
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">
            Power plays · {personName}
          </DialogTitle>
          <DialogDescription>
            Pick a play. Optionally state your goal first. Each run
            persists to history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <label
            htmlFor="power-play-goal"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary"
          >
            Your goal (optional)
          </label>
          <Textarea
            id="power-play-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What outcome do you want from this person?"
            className="min-h-[3rem]"
            maxLength={2000}
            disabled={mutation.isPending}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          {(
            [
              "arc_plan",
              "message_draft",
              "scarcity_play",
              "reciprocity_assess",
            ] as PlayKind[]
          ).map((kind) => (
            <Button
              key={kind}
              type="button"
              variant={selectedKind === kind ? "default" : "outline"}
              size="sm"
              onClick={() => runPlay(kind)}
              disabled={mutation.isPending}
            >
              {KIND_LABELS[kind]}
            </Button>
          ))}
        </div>

        {mutation.isPending && (
          <p className="text-xs text-fg-tertiary italic">
            running {selectedKind ? KIND_LABELS[selectedKind] : "play"}…
          </p>
        )}

        {mutation.error && (
          <p className="text-xs text-rose-300">{mutation.error.message}</p>
        )}

        {output !== null &&
          output !== undefined &&
          selectedKind &&
          !mutation.isPending && (
            <div
              className="mt-2 rounded-control border border-edge-subtle bg-canvas p-3"
            >
              <PlayOutput kind={selectedKind} output={output} />
            </div>
          )}

        {output === null && selectedKind && !mutation.isPending && (
          <p className="text-xs text-amber-300">
            Play returned no parseable output · the AI may have failed JSON
            mode. Try again.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  );
}
