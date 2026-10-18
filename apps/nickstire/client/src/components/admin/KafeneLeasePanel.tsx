import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { hasAdminPermission, type AdminRole } from "@shared/adminPermissions";

// The Kafene lease on one tire order (server/routers/kafene.ts admin status / activate / cancel).
// Activating tells Kafene the tires are installed and starts their funding to the shop, so it is
// confirm-gated and only a signed lease can be activated. Seeing the lease needs money.view; the
// buttons need money.manage. A failed status read is "unknown", never "no lease".

const STATUS_LABEL: Record<string, string> = {
  started: "Started, not finished by the customer",
  approved: "Approved, not signed yet",
  signed: "Signed, waiting for installation",
  activating: "Activation in progress",
  activated: "Activated",
  cancelled: "Cancelled",
};

const ACTIVATE_TEXT =
  "This tells Kafene the tires are installed and starts their funding to the shop (about 2 business days). Only after the customer has the tires.";

const MESSAGES: Record<string, string> = {
  disabled: "Kafene is switched off on the server.",
  not_signed: "This lease is not signed, so it cannot be activated.",
  activate_upstream: "Kafene did not answer. The lease is still signed; try again.",
  upstream_error: "Kafene did not answer. Try again in a minute.",
  not_found: "There is no open Kafene lease to cancel.",
  conflict: "The lease changed while cancelling; refreshing.",
};

type Outcome = { text: string; detail?: string; retry?: "activate" | "cancel" } | null;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function KafeneLeasePanel({ order }: { order: { orderNumber: string } }) {
  const security = trpc.adminSecurity.status.useQuery();
  const role = security.data?.adminRole as AdminRole | undefined;
  const canView = !!role && hasAdminPermission(role, "money.view");
  const canAct = !!role && hasAdminPermission(role, "money.manage");

  const config = trpc.kafene.config.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const status = trpc.kafene.status.useQuery({ orderNumber: order.orderNumber }, { enabled: canView && config.data?.enabled === true });
  const activate = trpc.kafene.activate.useMutation();
  const cancel = trpc.kafene.cancel.useMutation();

  const [busy, setBusy] = useState<"activate" | "cancel" | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [done, setDone] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!canView || config.data?.enabled !== true) return null;
  if (status.data && !status.data.ok) return null; // the server says Kafene is disabled

  const runActivate = async () => {
    const ok = await confirmDialog({ title: "Activate this Kafene lease?", message: ACTIVATE_TEXT, confirmLabel: "Activate lease" });
    if (!ok) return;
    setBusy("activate");
    setOutcome(null);
    try {
      const r = await activate.mutateAsync({ orderNumber: order.orderNumber });
      if (r.ok) setDone(`Activated ${r.activationDate}`);
      else if (r.reason === "upstream_error") setOutcome({ text: MESSAGES.activate_upstream, detail: r.detail, retry: "activate" });
      else setOutcome({ text: MESSAGES[r.reason] ?? MESSAGES.upstream_error });
    } catch {
      setOutcome({ text: MESSAGES.activate_upstream, retry: "activate" });
    } finally {
      setBusy(null);
      void status.refetch();
    }
  };

  const runCancel = async () => {
    const why = reason.trim();
    if (!why) return;
    const ok = await confirmDialog({
      title: "Cancel this Kafene lease?",
      message: "Kafene is told the lease is cancelled, with your reason. The customer then pays another way.",
      confirmLabel: "Cancel lease",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("cancel");
    setOutcome(null);
    try {
      const r = await cancel.mutateAsync({ orderNumber: order.orderNumber, reason: why });
      if (r.ok) {
        setDone("Lease cancelled.");
        setCancelOpen(false);
        setReason("");
      } else setOutcome({ text: MESSAGES[r.reason] ?? MESSAGES.upstream_error, detail: "detail" in r ? r.detail : undefined, retry: r.reason === "upstream_error" ? "cancel" : undefined });
    } catch {
      setOutcome({ text: MESSAGES.upstream_error, retry: "cancel" });
    } finally {
      setBusy(null);
      void status.refetch();
    }
  };

  const headingId = `kafene-lease-${order.orderNumber}`;
  const button = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-50";
  const lease = status.data?.ok ? status.data.lease : null;

  return (
    <section aria-labelledby={headingId} className="mb-4 space-y-2 rounded-lg border border-border/40 bg-card/40 p-4">
      <h3 id={headingId} className="text-sm font-bold text-foreground">Kafene lease</h3>

      {status.isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}

      {status.isError && (
        <div role="alert" className="space-y-1">
          <p className="text-sm text-amber-500">Kafene lease couldn&apos;t load; state unknown.</p>
          <button type="button" onClick={() => void status.refetch()} className={`${button} border border-border text-foreground`}>
            Retry
          </button>
        </div>
      )}

      {status.data?.ok && !lease && <p className="text-sm text-muted-foreground">No Kafene lease on this order.</p>}

      {lease && (
        <>
          <p className="text-sm font-semibold text-foreground">{STATUS_LABEL[lease.status] ?? lease.status}</p>
          <p className="text-xs text-muted-foreground">
            {lease.uid ? `Application ${lease.uid}` : "No application id yet"} · {money(lease.merchandiseCents)}
            {lease.activationDate ? ` · delivery ${lease.activationDate}` : ""}
          </p>
          {lease.lastError && <p className="text-xs text-amber-500">{lease.lastError}</p>}

          {done && <p role="status" className="text-sm font-semibold text-green-500">{done}</p>}
          {outcome && (
            <div role="alert" className="space-y-1">
              <p className="text-sm text-amber-500">{outcome.text}</p>
              {outcome.detail && <p className="text-xs text-muted-foreground">{outcome.detail}</p>}
              {outcome.retry && (
                <button
                  type="button"
                  onClick={() => void (outcome.retry === "activate" ? runActivate() : runCancel())}
                  disabled={busy !== null}
                  className={`${button} border border-border text-foreground`}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {canAct && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void runActivate()}
                disabled={lease.status !== "signed" || busy !== null}
                className={`${button} bg-primary text-primary-foreground`}
              >
                {busy === "activate" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Activate lease (tires installed)
              </button>
              {lease.status !== "cancelled" && lease.status !== "activating" && !cancelOpen && (
                <button type="button" onClick={() => setCancelOpen(true)} disabled={busy !== null} className={`${button} border border-border text-foreground`}>
                  Cancel lease
                </button>
              )}
            </div>
          )}

          {canAct && cancelOpen && (
            <div className="space-y-2 pt-1">
              <label htmlFor={`${headingId}-reason`} className="block text-sm text-foreground">Reason for cancelling</label>
              <input
                id={`${headingId}-reason`}
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
                className="h-12 w-full rounded-md border border-border bg-background px-3 text-base text-foreground"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void runCancel()} disabled={!reason.trim() || busy !== null} className={`${button} border border-red-500/50 text-red-500`}>
                  {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Cancel this lease
                </button>
                <button type="button" onClick={() => { setCancelOpen(false); setReason(""); }} className={`${button} text-muted-foreground`}>
                  Keep lease
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
