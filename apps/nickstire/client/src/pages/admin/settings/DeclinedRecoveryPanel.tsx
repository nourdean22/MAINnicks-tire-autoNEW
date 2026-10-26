// ─── DECLINED RECOVERY STATUS PANEL ───────────────────────
// Renders the server's ONE state for declined-work recovery (live / shadow / paused / off / unknown) and the
// sender cron's last run. 2026-10-26: it used to say "live" from the env switch alone while the observer said dormant.

import { trpc } from "@/lib/trpc";
import { ErrorState } from "../shared";
import { timeAgoShort } from "../shared/format";

export default function DeclinedRecoveryPanel() {
  const { data, isLoading, refetch } = trpc.shopdriver.declinedRecoveryStatus.useQuery(undefined, { staleTime: 60_000 });
  if (isLoading) return null;
  // A failed read must not remove the panel: a missing panel reads as "recovery is off".
  if (!data) {
    return (
      <div className="bg-card border border-amber-500/30 p-4">
        <ErrorState
          message="Declined-work recovery status couldn't load. Whether it is live is unknown, not off."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  // A server older than the v2 read has no `state`: that is unknown, never live.
  const state = data.state ?? "unknown";
  const line =
    state === "live"
      ? data.lastRun
        ? `Sends on · last run ${timeAgoShort(data.lastRun.at)}: ${data.lastRun.recordsProcessed ?? "?"} processed`
        : "Sends on · no run of the sender logged yet."
      : state === "shadow"
        ? "Counts only. Nothing sends until the send lane is enabled."
        : state === "paused"
          ? "Paused by the pause switch (ShopDriver HQ > Pause switches)."
          : state === "off"
            ? "The feature switch is off. Nothing sends."
            : "The pause switch could not be read; whether it sends is unknown.";
  const live = state === "live";
  // null = the count could not be read; never print it as 0.
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "unknown" : String(v));

  return (
    <div className={`bg-card border ${live ? "border-emerald-500/30" : "border-amber-500/30"} p-4`}>
      <div className="mb-3">
        <h3 className="font-bold text-sm text-foreground">Declined-work recovery · {state}</h3>
        <p className={`text-[13px] mt-1 ${live ? "text-emerald-300/90" : "text-amber-300/90"}`}>{line}</p>
        <p className="text-foreground/50 text-[12px] mt-1">
          7-day and 30-day follow-up texts to estimates with no matching invoice.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/50 mb-1">Eligible</p>
          <p className="text-foreground font-bold text-lg">{n(data.eligible)}</p>
          <p className="text-foreground/50 text-[12px]">estimates 7 to 60 days old, no invoice</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/50 mb-1">Estimated value</p>
          <p className="text-foreground font-bold text-lg">
            {data.recoverableDollars === null || data.recoverableDollars === undefined ? "unknown" : `$${data.recoverableDollars.toLocaleString()}`}
          </p>
          <p className="text-foreground/50 text-[12px]">of those estimates</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/50 mb-1">Next 7-day</p>
          <p className="text-foreground font-bold text-lg">{n(data.next7dSends)}</p>
          <p className="text-foreground/50 text-[12px]">due {live ? "to send" : "if sending were on"}</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/50 mb-1">Next 30-day</p>
          <p className="text-foreground font-bold text-lg">{n(data.next30dSends)}</p>
          <p className="text-foreground/50 text-[12px]">due {live ? "to send" : "if sending were on"}</p>
        </div>
      </div>
    </div>
  );
}
