import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { hasAdminPermission, type AdminRole } from "@shared/adminPermissions";

// "Order from D&K" for one paid tire order (gatewayOrder v1). Prepare puts the order's line in
// the D&K cart and shows it; Submit places the supplier order only after the house confirm
// dialog. It spends the shop's money, so it renders only for admins with money.manage.

type PrepareResult = RouterOutputs["gatewayOrder"]["prepare"];
type Prepared = Extract<PrepareResult, { ok: true }>;
type Match = Prepared["match"];

type PanelOrder = { id: number; orderNumber: string; status: string; paymentStatus: string | null; gatewayOrderRef: string | null };

const OPEN_STATUSES = ["received", "confirmed"];

const MESSAGES: Record<string, string> = {
  disabled: "Online ordering is switched off. Place it in the D&K portal and enter the PO here.",
  not_paid: "Waiting for payment.",
  already_ordered: "Already ordered.",
  no_match: "D&K has no exact match for this tire. Order it in the portal and enter the PO.",
  cart_not_empty: "The D&K cart has other items in it. Clear it in the portal, then prepare again.",
  unconfigured: "D&K login is not set up on the server.",
  upstream_error: "D&K did not answer. Try again in a minute.",
  claimed: "Someone already placed this order; refreshing",
};
const RETRYABLE = new Set(["upstream_error", "cart_not_empty"]);

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type View =
  | { kind: "idle" }
  | { kind: "prepared"; data: Prepared }
  | { kind: "ambiguous"; candidates: Match[] }
  | { kind: "failed"; reason: string; detail?: string }
  | { kind: "ordered"; ref: string };

export default function GatewayOrderPanel({ order }: { order: PanelOrder }) {
  const security = trpc.adminSecurity.status.useQuery();
  const prepareMut = trpc.gatewayOrder.prepare.useMutation();
  const submitMut = trpc.gatewayOrder.submit.useMutation();
  const clearMut = trpc.gatewayOrder.clearOurLines.useMutation();
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prepare" | "submit" | "clear" | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // Unknown role (loading or a failed read) is not permission.
  const role = security.data?.adminRole as AdminRole | undefined;
  const allowed = !!role && hasAdminPermission(role, "money.manage");
  const eligible = order.paymentStatus === "paid" && !order.gatewayOrderRef && OPEN_STATUSES.includes(order.status);
  if (!allowed || (!eligible && view.kind !== "ordered")) return null;

  const refresh = () => {
    void utils.gatewayTire.listOrders.invalidate();
    void utils.gatewayTire.orderStats.invalidate();
  };

  const fail = (reason: string, detail?: string) => {
    setView({ kind: "failed", reason, detail });
    if (reason === "claimed") refresh();
  };

  const prepare = async (partNumber?: string) => {
    setBusy("prepare");
    try {
      const r = await prepareMut.mutateAsync(partNumber ? { orderId: order.id, partNumber } : { orderId: order.id });
      if (r.ok) setView({ kind: "prepared", data: r });
      else if (r.reason === "ambiguous_match") {
        setPicked(null);
        setView({ kind: "ambiguous", candidates: r.candidates });
      } else fail(r.reason, "detail" in r ? r.detail : undefined);
    } catch {
      fail("upstream_error");
    } finally {
      setBusy(null);
    }
  };

  const submit = async (data: Prepared) => {
    const total = data.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
    const lines = data.lines
      .map((l) => `${l.quantity} x ${l.partNumber} ${l.description} at ${money(l.unitCostCents)} = ${money(l.lineTotalCents)} (PO ${l.poNumber})`)
      .join("; ");
    const ok = await confirmDialog({
      title: "Place this order with D&K?",
      message: `${lines}. Total ${money(total)}. This orders from the supplier and charges the shop's D&K account.`,
      confirmLabel: "Place order with D&K",
    });
    if (!ok) return;
    setBusy("submit");
    setNotice(null);
    try {
      const r = await submitMut.mutateAsync({ orderId: order.id, cartToken: data.cartToken });
      if (r.ok) {
        setView({ kind: "ordered", ref: r.gatewayOrderRef });
        refresh();
      } else if (r.reason === "token_mismatch") {
        setBusy(null);
        await prepare();
        setNotice("The D&K cart changed, so it was prepared again. Check the lines before submitting.");
        return;
      } else fail(r.reason, r.detail);
    } catch {
      fail("upstream_error");
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    try {
      const r = await clearMut.mutateAsync({ orderId: order.id });
      if (r.ok) {
        setView({ kind: "idle" });
        setNotice(`Removed ${r.removed} ${r.removed === 1 ? "line" : "lines"} from the D&K cart.`);
      } else fail(r.reason, r.detail);
    } catch {
      fail("upstream_error");
    } finally {
      setBusy(null);
    }
  };

  const headingId = `dk-order-${order.id}`;
  const primary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-50";

  return (
    <section aria-labelledby={headingId} className="mb-4 space-y-3 rounded-lg border border-border/40 bg-card/40 p-4">
      <h3 id={headingId} className="text-sm font-bold text-foreground">Order from D&amp;K</h3>

      {view.kind === "ordered" ? (
        <p role="status" className="text-sm font-semibold text-green-500">Ordered. D&amp;K reference {view.ref}</p>
      ) : (
        <>
          <button type="button" onClick={() => void prepare()} disabled={busy !== null} className={`${primary} border border-border text-foreground`}>
            {busy === "prepare" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Prepare D&amp;K order
          </button>

          {notice && <p role="status" className="text-sm text-amber-500">{notice}</p>}

          {view.kind === "failed" && (
            <div role="alert" className="space-y-1">
              <p className="text-sm text-amber-500">{MESSAGES[view.reason] ?? MESSAGES.upstream_error}</p>
              {view.detail && <p className="text-xs text-muted-foreground">{view.detail}</p>}
              {RETRYABLE.has(view.reason) && (
                <button type="button" onClick={() => void prepare()} disabled={busy !== null} className={`${primary} border border-border text-foreground`}>
                  Retry
                </button>
              )}
            </div>
          )}

          {view.kind === "ambiguous" && (
            <fieldset className="space-y-2">
              <legend className="text-sm text-foreground">D&amp;K has more than one match. Pick the part to order.</legend>
              {view.candidates.map((c) => (
                <label key={c.partNumber} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border/40 px-3 text-sm">
                  <input type="radio" name={`dk-part-${order.id}`} value={c.partNumber} checked={picked === c.partNumber} onChange={() => setPicked(c.partNumber)} />
                  <span>
                    {c.brand} {c.model} {c.size} · {c.partNumber} · {money(c.wholesaleCents)}
                    {c.qtyAvailable !== null && ` · ${c.qtyAvailable} available`}
                  </span>
                </label>
              ))}
              <button type="button" onClick={() => picked && void prepare(picked)} disabled={!picked || busy !== null} className={`${primary} bg-primary text-primary-foreground`}>
                Use this part
              </button>
            </fieldset>
          )}

          {view.kind === "prepared" && (
            <div className="space-y-2">
              {view.data.preview && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  Ordering is switched off (GATEWAY_ORDERING_ENABLED). This is what would be sent.
                </p>
              )}
              <p className="text-sm text-foreground">
                {view.data.match.brand} {view.data.match.model} {view.data.match.size} · part {view.data.match.partNumber}
              </p>
              {view.data.cartHadOtherLines && (
                <p className="text-xs text-amber-500">There were other items in the D&amp;K cart. They were left as they are.</p>
              )}
              {view.data.cutoff && <p className="text-xs text-muted-foreground">{view.data.cutoff}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Qty</th>
                      <th className="py-1 pr-3 font-medium">Unit cost</th>
                      <th className="py-1 pr-3 font-medium">Line total</th>
                      <th className="py-1 font-medium">PO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.data.lines.map((l) => (
                      <tr key={`${l.partNumber}-${l.poNumber}`} className="border-t border-border/30">
                        <td className="py-1 pr-3">{l.quantity}</td>
                        <td className="py-1 pr-3">{money(l.unitCostCents)}</td>
                        <td className="py-1 pr-3">{money(l.lineTotalCents)}</td>
                        <td className="py-1">{l.poNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!view.data.preview && (
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void submit(view.data)} disabled={busy !== null} className={`${primary} bg-primary text-primary-foreground`}>
                    {busy === "submit" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    Submit to D&amp;K
                  </button>
                  <button type="button" onClick={() => void clear()} disabled={busy !== null} className="min-h-12 text-sm text-muted-foreground underline underline-offset-4">
                    Remove my lines from the D&amp;K cart
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
