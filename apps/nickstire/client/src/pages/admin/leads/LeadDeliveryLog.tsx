/**
 * LeadDeliveryLog — read-only per-lead notification chronology.
 *
 * Surfaces the durable lead_delivery_events ledger (lead.deliveryEvents query)
 * so an operator can see whether each email / SMS / Telegram for a lead was
 * attempted, sent, or failed — the observability the append-only Google Sheet
 * never had. Lazy: the query only fires when the row is expanded (`enabled`),
 * so the lead list doesn't fan out N delivery queries on mount.
 *
 * NOTE: until migration 0079 is applied + notifications fire post-deploy, this
 * correctly shows the empty state ("No delivery events recorded yet").
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, ChevronRight, Mail, MessageSquare, Send, Radio } from "lucide-react";

// The lead.deliveryEvents query returns rows from the loosely-typed db()
// handle (same trait as lead.list, which LeadsSection casts to LeadItem[]),
// so we annotate the row shape locally rather than rely on tRPC inference.
interface DeliveryEvent {
  id: number;
  channel: string;
  status: string;
  provider: string | null;
  providerRef: string | null;
  detail: string | null;
  createdAt: string | Date;
}

const CHANNEL_ICON = {
  email: Mail,
  sms: MessageSquare,
  telegram: Send,
  push: Radio,
  capi: Radio,
} as const;

// Terminal-failure red, in-flight amber, success emerald, skipped muted.
const STATUS_STYLE: Record<string, string> = {
  sent: "text-emerald-400 bg-emerald-500/10",
  delivered: "text-emerald-400 bg-emerald-500/10",
  queued: "text-sky-400 bg-sky-500/10",
  attempted: "text-amber-400 bg-amber-500/10",
  failed: "text-red-400 bg-red-500/10",
  skipped: "text-foreground/40 bg-foreground/5",
};

export function LeadDeliveryLog({ leadId }: { leadId: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.lead.deliveryEvents.useQuery(
    { leadId },
    { enabled: open },
  );

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wide text-foreground/50 hover:text-foreground/80 transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} />
        Delivery log
      </button>

      {open && (
        <div className="mt-1.5 border border-border/30 bg-background/40 p-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-[11px] text-foreground/40">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          ) : !data || data.length === 0 ? (
            <p className="text-[11px] text-foreground/40">
              No delivery events recorded yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {(data as DeliveryEvent[]).map((ev) => {
                const Icon = CHANNEL_ICON[ev.channel as keyof typeof CHANNEL_ICON] ?? Radio;
                const statusStyle = STATUS_STYLE[ev.status] ?? "text-foreground/50 bg-foreground/5";
                return (
                  <li key={ev.id} className="flex items-center gap-2 text-[11px]">
                    <Icon className="w-3 h-3 text-foreground/40 shrink-0" />
                    <span className="font-mono text-foreground/60 uppercase tracking-wider w-14 shrink-0">
                      {ev.channel}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[10px] ${statusStyle}`}>
                      {ev.status}
                    </span>
                    {ev.provider && (
                      <span className="text-foreground/35 font-mono">{ev.provider}</span>
                    )}
                    <span className="text-foreground/30 ml-auto shrink-0">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
