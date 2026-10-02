"use client";

/**
 * <LogLedgerModal> · 2026-05-27 · Power Atlas Phase 1
 *
 * Quick deposit/withdraw modal. Operator picks amount + types note +
 * picks source. Calls `trpc.task.logLedger`, which writes through the
 * ledger seam (`lib/services/people/record-interaction.ts`, #2346): the
 * row and both counters in one transaction, lastInteraction forward-only,
 * the note queued for re-embedding (>=20 chars) after the commit.
 *
 * Default source is "manual" · operator can change to any of the seven
 * sources the procedure accepts.
 */

import { useEffect, useRef, useState } from "react";
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

const SOURCES = [
  "manual",
  "gmail",
  "calendar",
  "chat",
  "telegram",
  "auto",
  "greene_play",
] as const;

type Source = (typeof SOURCES)[number];

interface LogLedgerModalProps {
  personId: string;
  personName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDirection?: "deposit" | "withdraw";
  onDone?: () => void;
}

export default function LogLedgerModal({
  personId,
  personName,
  open,
  onOpenChange,
  initialDirection = "deposit",
  onDone,
}: LogLedgerModalProps) {
  const [direction, setDirection] = useState<"deposit" | "withdraw">(
    initialDirection,
  );
  const [magnitude, setMagnitude] = useState<number>(5);
  const [note, setNote] = useState("");
  const [source, setSource] = useState<Source>("manual");

  // Wave AY · 2026-05-28 · operator complaint: "should auto focus to the
  // pop up". Base-UI Dialog defaults focus to the FIRST focusable element
  // (the "+ deposit" button) · that's not what the operator wants — they
  // want to start typing the note immediately. Ref the textarea + focus
  // it on the open→true transition via double-rAF (lets the dialog mount
  // + focus-trap settle first).
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!open) return;
    let r1 = 0;
    let r2 = 0;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        noteRef.current?.focus();
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [open]);

  const utils = trpc.useUtils();
  const logLedger = trpc.task.logLedger.useMutation({
    onSuccess: async () => {
      await utils.task.personProfile.invalidate({ personId });
      // Reset
      setMagnitude(5);
      setNote("");
      setSource("manual");
      onOpenChange(false);
      onDone?.();
    },
  });

  const signed = direction === "deposit" ? magnitude : -magnitude;
  const valid = note.trim().length >= 1 && magnitude > 0 && magnitude <= 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wave BF · 2026-05-29 · the AY→AZ→BB→BD !important band-aid is
        * DELETED. Root cause (globals.css .neural-glass clobbering the
        * Dialog's position/overflow) is now fixed at the primitive:
        * dialog.tsx uses .neural-glass-modal + max-h-[90dvh] +
        * overflow-y-auto by default. This modal only keeps the two
        * things that are genuinely modal-specific: a narrower max-w-md
        * and the iOS safe-area bottom padding so the footer clears the
        * home indicator. Everything else inherits from the primitive. */}
      <DialogContent
        className="max-w-md pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">
            Log ledger · {personName}
          </DialogTitle>
          <DialogDescription>
            One event. Signed amount (sign tells the story). Note is required.
            Notes ≥20 chars get embedded for hybrid search.
          </DialogDescription>
        </DialogHeader>

        {/* Direction toggle */}
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => setDirection("deposit")}
            className={`flex-1 rounded-control border px-3 py-2 text-[13px] font-medium transition-colors ${
              direction === "deposit"
                ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                : "border-edge-default text-fg-secondary hover:border-emerald-500/30"
            }`}
          >
            + deposit
          </button>
          <button
            type="button"
            onClick={() => setDirection("withdraw")}
            className={`flex-1 rounded-control border px-3 py-2 text-[13px] font-medium transition-colors ${
              direction === "withdraw"
                ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200"
                : "border-edge-default text-fg-secondary hover:border-amber-500/30"
            }`}
          >
            − withdraw
          </button>
        </div>

        {/* Magnitude quick picks
            Wave AZ · 2026-05-28 · mobile pass · flex-wrap + min-h-11 on
            each button so the row reflows on <375px phones instead of
            squishing · 44pt tap targets match Apple HIG. The "custom"
            input gets a tiny label above it so the operator doesn't
            mistake it for a 6th preset (the unlabeled 5 in the live
            screenshot triggered the confusion). */}
        <div className="space-y-1">
          <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            Magnitude (1–100)
          </label>
          <div className="flex flex-wrap gap-2 items-end">
            {[1, 3, 5, 10, 25].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMagnitude(n)}
                className={`flex-1 min-w-[44px] min-h-[44px] rounded-control border px-2 py-1.5 font-mono text-xs tabular-nums transition-colors ${
                  magnitude === n
                    ? "border-accent text-fg"
                    : "border-edge-default text-fg-secondary hover:border-edge-strong"
                }`}
              >
                {n}
              </button>
            ))}
            <div className="flex flex-col items-center">
              <label
                htmlFor="ledger-magnitude-custom"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-0.5"
              >
                Custom
              </label>
              <input
                id="ledger-magnitude-custom"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                value={magnitude}
                onChange={(e) =>
                  setMagnitude(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                }
                className="w-16 min-h-[44px] rounded-control border border-edge-default bg-transparent px-2 py-1 text-center font-mono text-xs tabular-nums text-fg focus:border-accent focus:outline-none"
                aria-label="custom magnitude"
              />
            </div>
          </div>
        </div>

        {/* Note */}
        <div className="space-y-1">
          <label
            htmlFor="ledger-note"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary"
          >
            Note (required)
          </label>
          <Textarea
            ref={noteRef}
            id="ledger-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              direction === "deposit"
                ? "great hang at coffee · they remembered the dog's name"
                : "no-showed the call · second time this month"
            }
            className="min-h-[5rem]"
            maxLength={2000}
            disabled={logLedger.isPending}
          />
        </div>

        {/* Source */}
        <div className="space-y-1">
          <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            Source
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`rounded-control border px-2 py-1 text-[13px] font-medium transition-colors ${
                  source === s
                    ? "border-accent text-fg"
                    : "border-edge-default text-fg-tertiary hover:border-edge-strong"
                }`}
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-control border border-edge-subtle bg-canvas/40 px-3 py-2 text-xs"
        >
          <span className="text-fg-tertiary">preview · </span>
          <span
            className={`font-mono tabular-nums ${
              signed > 0
                ? "text-emerald-300"
                : signed < 0
                  ? "text-amber-300"
                  : "text-fg-secondary"
            }`}
          >
            {signed > 0 ? `+${signed}` : signed}
          </span>{" "}
          <span className="text-fg-secondary">
            {note.trim() || "(note)"}
          </span>
        </div>

        {logLedger.error && (
          <div className="text-xs text-rose-300">{logLedger.error.message}</div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={logLedger.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() =>
              logLedger.mutate({
                personId,
                amount: signed,
                note: note.trim(),
                source,
              })
            }
            disabled={!valid || logLedger.isPending}
          >
            {logLedger.isPending ? "Logging…" : "Log entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
