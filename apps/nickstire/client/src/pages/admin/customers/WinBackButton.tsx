import React from "react";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * wave-149 · One-tap Win Back — fires a single re-engagement SMS to an
 * at-risk customer via customers.quickSms (opt-out honored + audit-logged).
 * Operator-initiated + confirm-gated, so it's a deliberate per-customer nudge,
 * NOT a blast. Distinct from FollowUpButton (a VAPI call) — this is the
 * lower-friction text channel. Rendered only on at-risk rows.
 */
export function WinBackButton({ customerId, firstName, phone }: {
  customerId: number;
  firstName: string | null;
  phone: string;
}) {
  const name = (firstName || "there").trim().split(/\s+/)[0] || "there";
  const mutation = trpc.customers.quickSms.useMutation({
    onSuccess: (r) => {
      if (r.success) toast.success(`Win-back text sent to ${name}`);
      else toast.error(`Win-back failed: ${r.error || "unknown error"}`);
    },
    onError: (err) => toast.error(`Win-back failed: ${err.message}`),
  });

  const send = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: `Win back ${name}?`,
      message: `Sends ONE re-engagement text to ${phone} — a free safety-inspection offer. Real SMS · opt-out honored.`,
      confirmLabel: "Send text",
      cancelLabel: "Cancel",
      tone: "default",
    });
    if (!ok) return;
    mutation.mutate({
      customerId,
      message: `Hi ${name}, it's Nick's Tire & Auto — been a while! Come in for a FREE safety inspection, no charge, no appointment needed. (216) 862-0005. Reply STOP to opt out.`,
    });
  };

  return (
    <button
      onClick={send}
      disabled={mutation.isPending}
      className="text-foreground/30 hover:text-amber-400 transition-colors p-1 disabled:opacity-50"
      title={`Send win-back text to ${name}`}
      aria-label={`Win back ${name}`}
    >
      {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
    </button>
  );
}
