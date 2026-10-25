/**
 * NextEstimate: the one action on Money > Billed.
 *
 * Reads the same 30-day declined queue the Declined tab opens on and names the single estimate
 * with the highest recovery score that has a phone on file and no follow-up yet (paymentStatus
 * "pending": neither the 7-day nor the 30-day text has gone out). It shows a first name and the
 * vehicle only; the phone stays on the Declined tab, where the call happens.
 *
 * A failed or paused read is unknown, never "no estimate waiting".
 */
import type { ReactNode } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { navigateToAdminUrl } from "../shared/navigation";
import { recoveryScore } from "./moneyMath";

type DeclinedEstimate = NonNullable<RouterOutputs["invoices"]["declined"]>["estimates"][number];

const DECLINED_HREF = "/admin?tab=revenue&moneyTab=declined";
const DAY_MS = 86_400_000;

function daysAgoText(date: string | Date): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS));
  if (days === 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function pick(estimates: DeclinedEstimate[]): DeclinedEstimate | null {
  let best: DeclinedEstimate | null = null;
  for (const e of estimates) {
    if (!e.customerPhone || e.paymentStatus !== "pending") continue;
    if (!best || recoveryScore(e) > recoveryScore(best)) best = e;
  }
  return best;
}

export default function NextEstimate({ onOpenDeclined }: { onOpenDeclined?: () => void }) {
  const query = trpc.invoices.declined.useQuery({ days: 30 });
  const estimates = query.data?.estimates;
  const next = estimates ? pick(estimates) : null;

  let body: ReactNode;
  if (query.isLoading) {
    body = (
      <p className="flex items-center gap-2 text-sm text-foreground/60">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading the estimate queue…
      </p>
    );
  } else if (query.isError || !estimates) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-foreground/80">The estimate queue couldn't load: unknown, not empty.</p>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="min-h-[44px] px-4 rounded border border-border/60 text-sm text-foreground"
        >
          Retry
        </button>
      </div>
    );
  } else if (next) {
    const firstName = next.customerName?.trim().split(/\s+/)[0] || "Name not recorded";
    const amount = `$${Math.round((next.totalAmount ?? 0) / 100).toLocaleString("en-US")}`;
    body = (
      <p className="text-base text-foreground">
        Chase the next estimate: {firstName}, {next.vehicleInfo || "vehicle not recorded"}, {amount},{" "}
        {daysAgoText(next.invoiceDate)}
      </p>
    );
  } else if (estimates.length === 0) {
    body = <p className="text-sm text-foreground/70">No open estimates in the last 30 days.</p>;
  } else if (estimates.some((e: DeclinedEstimate) => e.paymentStatus === "pending")) {
    body = (
      <p className="text-sm text-foreground/70">
        No estimate waiting on a call. The open estimates with no follow-up have no phone on file.
      </p>
    );
  } else {
    body = (
      <p className="text-sm text-foreground/70">
        No estimate waiting on a call. Every open estimate has a follow-up logged.
      </p>
    );
  }

  const showLink = !query.isLoading && !query.isError && Boolean(estimates);

  return (
    <section className="rounded-lg border border-border/40 p-4 space-y-3" aria-label="One action">
      <h2 className="text-sm text-foreground/60 flex items-center gap-2">
        <PhoneCall className="w-4 h-4" /> One action
      </h2>
      {body}
      {showLink && (
        <a
          href={DECLINED_HREF}
          onClick={(e) => {
            if (!navigateToAdminUrl(e, DECLINED_HREF, "revenue")) return;
            e.preventDefault();
            onOpenDeclined?.();
          }}
          className="inline-flex min-h-[44px] items-center px-4 rounded border border-primary text-sm text-primary"
        >
          Open in Declined
        </a>
      )}
    </section>
  );
}
