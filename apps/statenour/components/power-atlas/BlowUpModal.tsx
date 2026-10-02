"use client";

/**
 * <BlowUpModal> · 2026-05-27 · Power Atlas Phase 1
 *
 * Nuclear blow-up confirmation modal. Requires a reason (min 5 chars)
 * before flipping `status="blown_up"`. The reason is stored forever on
 * `PersonProfile.blowUpReason` and revealed if the operator ever tries
 * to revive — a hedge against impulsive flips.
 *
 * Uses the existing `<Dialog>` primitive. Wires through to
 * `trpc.task.flipPersonStatus` mutation.
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

interface BlowUpModalProps {
  personId: string;
  personName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

const MIN_REASON = 5;

export default function BlowUpModal({
  personId,
  personName,
  open,
  onOpenChange,
  onDone,
}: BlowUpModalProps) {
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const flipStatus = trpc.task.flipPersonStatus.useMutation({
    onSuccess: async () => {
      await utils.task.personProfile.invalidate({ personId });
      setReason("");
      onOpenChange(false);
      onDone?.();
    },
  });

  const reasonValid = reason.trim().length >= MIN_REASON;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">
            Blow up {personName}?
          </DialogTitle>
          <DialogDescription>
            Auto-feeders (gmail · calendar · chat · kept-word) will stop
            writing to this row. The profile stays in the DB for history but
            disappears from the default view. Reviving requires acknowledging
            this reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <label
            htmlFor="blow-up-reason"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary"
          >
            Reason (min {MIN_REASON} chars) · stored forever
          </label>
          <Textarea
            id="blow-up-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What broke. One sentence is fine. This is the line you'll re-read if you ever try to revive."
            className="min-h-[5rem]"
            maxLength={2000}
            disabled={flipStatus.isPending}
            autoFocus
          />
          <div className="font-mono text-[11px] text-fg-tertiary tabular-nums">
            {reason.trim().length} / {MIN_REASON} min · {reason.length} / 2000
            max
          </div>
        </div>

        {flipStatus.error && (
          <div className="text-xs text-rose-300">{flipStatus.error.message}</div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setReason("");
              onOpenChange(false);
            }}
            disabled={flipStatus.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              flipStatus.mutate({
                personId,
                status: "blown_up",
                blowUpReason: reason.trim(),
              })
            }
            disabled={!reasonValid || flipStatus.isPending}
          >
            {flipStatus.isPending ? "Blowing up…" : "Confirm blow up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
