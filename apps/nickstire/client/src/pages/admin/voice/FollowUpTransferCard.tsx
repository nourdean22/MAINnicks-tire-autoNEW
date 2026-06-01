import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { fmtPhone } from "./format";

// ─── wave-114 · Follow-Up Caller transfer destination ──────
//
// The OUTBOUND assistant (Nick's Tire Follow-Up Caller) has its own
// transferCall destination that fires when an outbound campaign call
// gets transferred to a human. This destination should always stay
// pointed at the shop landline (+1 216 862 0005) so customers reaching
// the shop from a campaign callback hit the front counter.
//
// Compact card design:
//   · Read-only display of current number with shop-landline indicator
//   · "Reset to shop number" if currently NOT the landline (one-click fix)
//   · "Edit (advanced)" gated behind a window.confirm() with an explicit
//     warning so the operator can't accidentally redirect campaign callers
//
// Server-side: setTransferDestination accepts target="followUp" and
// requires acknowledgeNonShopFollowUp=true to set anything other than
// the shop landline. Belt-and-suspenders.

const SHOP_LANDLINE = "+12168620005";
const SHOP_LANDLINE_DISPLAY = "(216) 862-0005";

export function FollowUpTransferCard() {
  const utils = trpc.useUtils();
  const { data: dest, isLoading } = trpc.vapi.getFollowUpTransferDestination.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });
  const [editing, setEditing] = useState(false);
  const [draftNumber, setDraftNumber] = useState("");

  const setDest = trpc.vapi.setTransferDestination.useMutation({
    onSuccess: (result) => {
      toast.success(`Follow-up caller now forwards to ${fmtPhone(result.newNumber)}`);
      utils.vapi.getFollowUpTransferDestination.invalidate();
      setEditing(false);
    },
    onError: (err) => toast.error(`Failed: ${err.message.slice(0, 120)}`),
  });

  // Same E.164 normalizer used by the receptionist card. Keeps the two
  // input flows behaving identically.
  const toE164 = (raw: string): string | null => {
    const digits = raw.replace(/[^\d+]/g, "");
    if (/^\+1\d{10}$/.test(digits)) return digits;
    if (/^1\d{10}$/.test(digits)) return `+${digits}`;
    if (/^\d{10}$/.test(digits)) return `+1${digits}`;
    return null;
  };

  const resetToShop = async () => {
    if (!await confirmDialog({
      title: "Reset transfer destination?",
      message: "Restore Follow-Up Caller transfer to the shop landline (216) 862-0005.",
      confirmLabel: "Reset",
    })) return;
    setDest.mutate({
      phoneNumber: SHOP_LANDLINE,
      target: "followUp",
      message: "Hold on, I'll get you over to the shop.",
    });
  };

  const submitEdit = async () => {
    const e164 = toE164(draftNumber);
    if (!e164) {
      toast.error("Invalid number — type a 10-digit US number");
      return;
    }
    if (e164 !== SHOP_LANDLINE) {
      const ok = await confirmDialog({
        title: "Redirect callbacks away from shop?",
        message: `New destination: ${fmtPhone(e164)}\n\nCustomers calling back from your follow-up campaigns will reach this number instead of the shop landline. Are you sure?`,
        confirmLabel: "Redirect",
        tone: "danger",
      });
      if (!ok) return;
    }
    setDest.mutate({
      phoneNumber: e164,
      target: "followUp",
      acknowledgeNonShopFollowUp: e164 !== SHOP_LANDLINE,
    });
  };

  if (isLoading) {
    return (
      <div className="bg-card/50 border border-border/30 rounded p-3">
        <div className="h-3 w-32 bg-foreground/10 animate-pulse rounded mb-2" />
        <div className="h-5 w-44 bg-foreground/15 animate-pulse rounded" />
      </div>
    );
  }

  if (!dest?.ok) {
    // Either no follow-up assistant in this org, or VAPI unreachable. Both
    // are non-actionable here — silent on no-followup, warn-tinted on error.
    if (dest && "reason" in dest && dest.reason === "no-followup") return null;
    return (
      <div className="bg-card/50 border border-border/20 rounded p-3 flex items-center gap-2 text-[12px] text-foreground/40">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Follow-up caller status unavailable</span>
      </div>
    );
  }

  const isShop = dest.isShopLandline;

  return (
    <div className="bg-card/50 border border-border/30 rounded p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/40">
              Follow-Up Caller transfer
            </span>
            {isShop ? (
              <span className="text-[10px] font-medium tracking-[0.12em] uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Shop landline
              </span>
            ) : (
              <span className="text-[10px] font-medium tracking-[0.12em] uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Off shop number
              </span>
            )}
          </div>
          <div className="text-sm font-mono text-foreground/80">
            {fmtPhone(dest.currentNumber)}
          </div>
          <div className="text-[10px] text-foreground/40 mt-0.5">
            Outbound campaign callbacks transfer here. Should stay set to the shop landline {SHOP_LANDLINE_DISPLAY}.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isShop && (
            <button
              onClick={resetToShop}
              disabled={setDest.isPending}
              className="text-[11px] font-medium tracking-[0.15em] uppercase px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50"
              title="One-click reset to (216) 862-0005"
            >
              Reset to shop
            </button>
          )}
          {!editing ? (
            <button
              onClick={() => {
                setDraftNumber(dest.currentNumber || "");
                setEditing(true);
              }}
              disabled={setDest.isPending}
              className="text-[11px] font-medium tracking-[0.15em] uppercase px-2.5 py-1 rounded text-foreground/60 border border-border/40 hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
              title="Change the follow-up transfer destination (will require confirmation)"
            >
              Edit (advanced)
            </button>
          ) : (
            <>
              <input
                type="tel"
                inputMode="tel"
                value={draftNumber}
                onChange={(e) => setDraftNumber(e.target.value)}
                placeholder="216-862-0005"
                className="bg-background border border-border/40 rounded px-2 py-1 text-xs font-mono w-44 focus:border-primary focus:outline-none"
                autoFocus
                disabled={setDest.isPending}
              />
              <button
                onClick={submitEdit}
                disabled={setDest.isPending}
                className="text-[11px] font-medium tracking-[0.15em] uppercase px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {setDest.isPending ? "Saving" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={setDest.isPending}
                className="text-[11px] font-medium tracking-[0.15em] uppercase px-2.5 py-1 rounded text-foreground/50 hover:text-foreground"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
