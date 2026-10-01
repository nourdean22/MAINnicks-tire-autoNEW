/*
 * POTHOLE AUDIENCES (Q-53) — Cleveland 311 pothole repair requests by ward,
 * ranked, with a draft ad per ward to copy into an ad tool by hand.
 *
 * Draft only: there is no post, launch or spend control here. A failed 311
 * read renders as an error, never as an empty "no potholes" list.
 */
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Copy, Loader2, MapPin, RefreshCw } from "lucide-react";

const DAY_OPTIONS = [14, 30, 60] as const;

function fmtChange(n: number) {
  if (n > 0) return <span className="text-amber-400">+{n}</span>;
  if (n < 0) return <span className="text-emerald-400">{n}</span>;
  return <span className="text-muted-foreground">±0</span>;
}

export function PotholeAudiences({ days, onDaysChange }: { days: number; onDaysChange: (d: number) => void }) {
  const q = trpc.adStudio.potholeAudiences.useQuery({ days }, { staleTime: 30 * 60 * 1000, retry: 1 });

  if (q.isLoading) {
    return (
      <div className="grid place-items-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (q.error || !q.data) {
    return (
      <section className="border border-destructive/40 bg-destructive/10 rounded-lg p-4 space-y-3">
        <p className="flex items-center gap-2 font-semibold text-sm">
          <AlertTriangle className="w-4 h-4" /> Cleveland 311 could not be read
        </p>
        <p className="text-sm text-foreground/70">{q.error?.message ?? "No data returned."} Nothing is shown rather than a false zero.</p>
        <button
          onClick={() => q.refetch()}
          className="min-h-12 inline-flex items-center gap-2 border border-border px-4 rounded-lg text-sm hover:bg-muted"
        >
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </section>
    );
  }

  const r = q.data;
  const copyDraft = (w: (typeof r.wards)[number]) => {
    const text = [w.draft.headline, w.draft.body, `Targeting: ${w.draft.targeting}`, w.draft.attribution].join("\n\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${w.wardName} draft copied`),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <div className="space-y-4">
      <section className="border border-border bg-card/40 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground/80 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Pothole requests by ward
          </h2>
          <div className="flex bg-muted rounded-lg p-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => onDaysChange(d)}
                className={`min-h-10 px-3 text-sm font-semibold rounded-md ${days === d ? "bg-background shadow text-foreground" : "text-muted-foreground"}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-foreground/70">
          {r.totalRequests} requests in the last {r.window.days} days (previous {r.window.days}: {r.priorTotalRequests})
          {r.unassignedRequests > 0 ? ` · ${r.unassignedRequests} with no ward` : ""}. City of Cleveland only: the shop's own
          neighborhood is included; suburbs such as Euclid and East Cleveland are not. Wards within 8 mi of the shop are listed first. Drafts only: nothing here posts or spends.
        </p>
      </section>

      {r.wards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Cleveland 311 answered, and logged no pothole requests in this window.</p>
      ) : (
        <ul className="space-y-3">
          {r.wards.map((w) => (
            <li key={w.ward} className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {w.wardName} · {w.requests} requests <span className="text-xs">({fmtChange(w.change)} vs prior)</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {w.neighborhoods.map((n) => `${n.name} ${n.requests}`).join(" · ") || "No neighborhood names"}
                    {w.milesFromShop !== null ? ` · ${w.milesFromShop} mi from the shop` : ""}
                    {w.inServiceArea ? "" : " · outside the service area"}
                  </p>
                </div>
                <button
                  onClick={() => copyDraft(w)}
                  aria-label={`Copy ${w.wardName} ad draft`}
                  className="min-h-12 min-w-12 shrink-0 inline-flex items-center justify-center gap-1 border border-border rounded-lg px-3 text-xs hover:bg-muted"
                >
                  <Copy className="w-4 h-4" /> Copy
                </button>
              </div>
              <p className="text-sm font-medium">{w.draft.headline}</p>
              <p className="text-sm text-foreground/80">{w.draft.body}</p>
              <p className="text-xs text-muted-foreground">Targeting: {w.draft.targeting}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {r.source.attribution}{" "}
        <a href={r.source.url} target="_blank" rel="noreferrer" className="underline">Source</a> ·{" "}
        <a href={r.source.licenseUrl} target="_blank" rel="noreferrer" className="underline">ODbL</a>. Any ad published
        from a draft must carry this notice.
      </p>
    </div>
  );
}
