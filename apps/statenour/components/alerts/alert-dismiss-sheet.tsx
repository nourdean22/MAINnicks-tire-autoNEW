"use client";

/**
 * UI v3 W5b · the in-DOM sheet behind an alert row's Dismiss (an iOS home-screen PWA drops
 * window.prompt silently). A closed list of reasons; the sheet says what the dismissal covers,
 * from the same alertSignal() the server keys the alert_dismiss row with.
 *
 * Built on the Base UI Dialog primitive the way MoreSheet is (focus trap and restore, Escape,
 * outside dismissal, scroll lock): the repo allows no new hand-rolled modal surfaces
 * (tests/repo/modal-contract.test.ts). Overlay z-[70] and panel z-[71] sit above the
 * BottomTabBar (z-[55]); pinned by tests/repo/alert-dismiss-sheet-layer.test.ts.
 */

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ALERT_DISMISS_DAYS,
  ALERT_DISMISS_REASONS,
  alertSignal,
  type AlertDismissReason,
} from "@/lib/brain/alert-lanes";

const REASON_WORD: Record<AlertDismissReason, string> = {
  expected: "Expected",
  fixed: "Fixed",
  noise: "Noise",
};

function coverage(category: string, key: string): string {
  const s = alertSignal(category, key);
  if (s.scope === "row") return `This one only, for ${ALERT_DISMISS_DAYS} days.`;
  if (category === "creation_spike_alert") {
    return `Hides creation spikes for ${s.identity} for ${ALERT_DISMISS_DAYS} days, so a new one stays quiet too.`;
  }
  return `Hides this pair of metrics for ${ALERT_DISMISS_DAYS} days, even if it fires again.`;
}

export function AlertDismissSheet({
  alert,
  pending,
  onCancel,
  onConfirm,
}: {
  alert: { category: string; key: string; label: string };
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: AlertDismissReason) => void;
}) {
  const [reason, setReason] = useState<AlertDismissReason | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        // Escape, the backdrop and outside taps cannot close it under an in-flight write.
        if (!nextOpen && !pending) onCancel();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-[70] bg-[var(--bg-void)]/70"
        className="fixed inset-x-0 bottom-0 z-[71] mx-auto max-h-[85dvh] w-full max-w-lg space-y-3 overflow-y-auto overscroll-contain border-t border-edge bg-canvas px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none sm:bottom-6 sm:rounded-surface sm:border"
      >
        <DialogTitle className="text-[16px] font-medium text-fg">Dismiss {alert.label}</DialogTitle>
        <p className="text-[14px] text-fg-secondary">{coverage(alert.category, alert.key)}</p>
        <fieldset className="space-y-1">
          <legend className="text-[13px] text-fg-tertiary">Reason</legend>
          {ALERT_DISMISS_REASONS.map((r) => (
            <label key={r} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[16px] text-fg">
              <input
                type="radio"
                name="alert-dismiss-reason"
                value={r}
                checked={reason === r}
                disabled={pending}
                onChange={() => setReason(r)}
                className="h-5 w-5"
              />
              {REASON_WORD[r]}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!reason || pending}
            onClick={() => reason && onConfirm(reason)}
            className="inline-flex min-h-[44px] items-center rounded-control bg-accent px-4 text-[14px] font-medium text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? "Dismissing" : "Dismiss alert"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center px-2 text-[14px] text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
