"use client";

/**
 * <LogLedgerModal> · 2026-05-27 · Power Atlas Phase 1
 *
 * Quick deposit/withdraw modal. Operator picks amount + types note +
 * picks source. Calls `trpc.task.logLedger` which inserts the row,
 * increments `interactionCount`, updates `lastInteraction`, and queues
 * the note for re-embedding (>=20 chars).
 *
 * Default source is "manual" · operator can change to any of the seven
 * sources the procedure accepts.
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg">
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
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              direction === "deposit"
                ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                : "border-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] hover:border-emerald-500/30"
            }`}
          >
            + deposit
          </button>
          <button
            type="button"
            onClick={() => setDirection("withdraw")}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              direction === "withdraw"
                ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200"
                : "border-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] hover:border-amber-500/30"
            }`}
          >
            − withdraw
          </button>
        </div>

        {/* Magnitude quick picks */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Magnitude (1–100)
          </label>
          <div className="flex gap-2">
            {[1, 3, 5, 10, 25].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMagnitude(n)}
                className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-xs tabular-nums transition-colors ${
                  magnitude === n
                    ? "border-[var(--gold)] text-[var(--gold)]"
                    : "border-[rgba(255,255,255,0.06)] text-[var(--text-secondary)] hover:border-[var(--gold)]/50"
                }`}
              >
                {n}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={100}
              value={magnitude}
              onChange={(e) =>
                setMagnitude(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
              }
              className="w-16 rounded-md border bg-transparent px-2 py-1 text-center font-mono text-xs tabular-nums text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
              aria-label="custom magnitude"
            />
          </div>
        </div>

        {/* Note */}
        <div className="space-y-1">
          <label
            htmlFor="ledger-note"
            className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]"
          >
            Note (required)
          </label>
          <Textarea
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
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Source
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                  source === s
                    ? "border-[var(--gold)] text-[var(--gold)]"
                    : "border-[rgba(255,255,255,0.06)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/50"
                }`}
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-lg border bg-[var(--bg-default)]/40 px-3 py-2 text-xs"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <span className="text-[var(--text-tertiary)]">preview · </span>
          <span
            className={`font-mono tabular-nums ${
              signed > 0
                ? "text-emerald-300"
                : signed < 0
                  ? "text-amber-300"
                  : "text-[var(--text-secondary)]"
            }`}
          >
            {signed > 0 ? `+${signed}` : signed}
          </span>{" "}
          <span className="text-[var(--text-secondary)]">
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
            cancel
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
            {logLedger.isPending ? "logging…" : "log entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
