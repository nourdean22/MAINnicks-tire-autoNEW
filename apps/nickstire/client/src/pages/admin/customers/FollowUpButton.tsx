import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";

/**
 * Wave-102: outbound follow-up call trigger.
 *
 * Operator clicks → fires the VAPI follow-up assistant at the customer.
 * Asks them how the work held up + asks for word-of-mouth referrals.
 * 3-minute hard cap.
 */
export function FollowUpButton({ customerName, phone }: {
  customerName: string;
  phone: string;
}) {
  // wave-168: replaced native window.prompt() with an inline expandable input.
  // window.prompt() blocks the JS thread, is suppressed in iOS PWA standalone
  // mode (where Nour operates), and breaks the minimalist admin aesthetic.
  // Same class of native-primitive bug that wave-139 fixed for window.confirm().
  const [expanded, setExpanded] = useState(false);
  const [lastService, setLastService] = useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const mutation = trpc.vapi.makeFollowUpCall.useMutation({
    onSuccess: (result) => {
      if (result.success && result.callId) {
        toast.success(`Follow-up call queued (${result.callId.slice(0, 8)}...). Nick is dialing now.`);
        setExpanded(false);
        setLastService("");
      } else {
        toast.error(`Follow-up failed: ${result.error || "unknown error"}`);
      }
    },
    onError: (err) => toast.error(`Follow-up failed: ${err.message}`),
  });

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const triggerCall = async () => {
    // wave-181.x bug-fix · per code-explorer agent audit ·
    // FollowUpButton previously fired a real VAPI call after one Enter
    // keypress with no confirmation. The call dials a live customer ·
    // can't be unsent. Now wrapped in confirmDialog (iOS-PWA-safe vs
    // native window.confirm which is suppressed in standalone mode).
    const ok = await confirmDialog({
      title: `Call ${customerName.split(" ")[0]} now?`,
      message: `Nick AI will dial ${phone} for a 3-minute follow-up about "${(lastService.trim() || "recent visit")}". This is a real outbound call · the customer will see a Cleveland number ring through.`,
      confirmLabel: "Dial now",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    mutation.mutate({
      customerName,
      phone,
      lastService: lastService.trim() || "recent visit",
    });
  };

  if (expanded) {
    return (
      <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={lastService}
          onChange={(e) => setLastService(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") triggerCall();
            if (e.key === "Escape") { setExpanded(false); setLastService(""); }
          }}
          placeholder='Service (e.g. "tires", or blank)'
          aria-label={`Last service for ${customerName.split(" ")[0]} follow-up call`}
          className="px-2 py-1 bg-card border border-emerald-500/30 text-foreground text-[10px] tracking-wider placeholder:text-foreground/30 focus:outline-none focus:border-emerald-400 w-44"
        />
        <button
          onClick={triggerCall}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] tracking-wider hover:bg-emerald-500/25 disabled:opacity-50"
          aria-label="Trigger follow-up call now"
        >
          {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Phone className="w-3 h-3" aria-hidden="true" />}
          CALL
        </button>
        <button
          onClick={() => { setExpanded(false); setLastService(""); }}
          className="px-2 py-1 text-foreground/40 hover:text-foreground/70 text-[10px]"
          aria-label="Cancel follow-up"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setExpanded(true);
      }}
      disabled={mutation.isPending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
      title="Trigger Nick's follow-up call (3 min, asks for referrals)"
    >
      {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
      FOLLOW UP
    </button>
  );
}
