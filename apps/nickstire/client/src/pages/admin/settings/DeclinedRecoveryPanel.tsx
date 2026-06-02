// ─── DECLINED RECOVERY STATUS PANEL ───────────────────────
// Surfaces FEATURE_DECLINED_RECOVERY env flag state + recoverable $.

import { trpc } from "@/lib/trpc";

export default function DeclinedRecoveryPanel() {
  const { data } = trpc.shopdriver.declinedRecoveryStatus.useQuery(undefined, { staleTime: 60_000 });
  if (!data) return null;
  const live = data.featureEnabled;

  return (
    <div className={`bg-card border ${live ? "border-emerald-500/30" : "border-amber-500/30"} p-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">
            DECLINED-WORK RECOVERY · {live ? "LIVE" : "DRY RUN"}
          </h3>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            7-day + 30-day SMS follow-ups to ALG estimates that never converted to invoice.
          </p>
        </div>
        <span className={`px-2.5 py-1 text-[10px] font-medium tracking-[0.12em] rounded ${live ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
          {live ? "FEATURE ENABLED" : "FEATURE OFF"}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Eligible</p>
          <p className="text-foreground font-bold text-lg">{data.eligible ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">unmatched estimates</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Recoverable</p>
          <p className="text-emerald-400 font-bold text-lg">${data.recoverableDollars ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">walked-away $</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Next 7-day</p>
          <p className="text-foreground font-bold text-lg">{data.next7dSends ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">due to send</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Next 30-day</p>
          <p className="text-foreground font-bold text-lg">{data.next30dSends ?? 0}</p>
          <p className="text-foreground/40 text-[10px]">due to send</p>
        </div>
      </div>

      <p className={`mt-3 text-[12px] ${live ? "text-emerald-300/80" : "text-amber-300/80"}`}>
        {data.message}
      </p>
    </div>
  );
}
