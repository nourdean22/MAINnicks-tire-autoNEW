/**
 * NHTSA panel (Q-50) — lives in the work-order drawer.
 *
 * Shows the vehicle's recall campaigns and owner-complaint counts by year/make/model, read from
 * NHTSA's public API through `vehicleData.*` (server-cached 24 h). Information for the advisor
 * only: nothing here contacts the customer, and nothing is worded as a diagnosis.
 *
 * empty-vs-error: a failed lookup renders as "unavailable" with a retry — never as "no recalls".
 * The service returns `{ ok: false }` as a value on upstream failure, so both that and a thrown
 * query count as unavailable.
 */
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";

const NHTSA_RECALLS_URL = "https://www.nhtsa.gov/recalls";

type Vehicle = { year?: string | number | null; make?: string | null; model?: string | null };

function vehicleLookup(v: Vehicle): { year: string; make: string; model: string } | null {
  const year = String(v.year ?? "").trim();
  const make = String(v.make ?? "").trim();
  const model = String(v.model ?? "").trim();
  if (!/^\d{4}$/.test(year) || !make || !model) return null;
  return { year, make, model };
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-foreground/40 tracking-wide mb-2">
        NHTSA · RECALLS &amp; COMPLAINTS <span className="font-normal">(information only)</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Unavailable({ what, detail, onRetry }: { what: string; detail?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          NHTSA {what} unavailable — this is NOT the same as "none on file".{detail ? ` ${detail}` : ""}
        </span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-12 px-3 text-xs font-medium rounded border border-amber-500/30 hover:bg-amber-500/10 inline-flex items-center gap-1.5"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
}

export default function NhtsaVehiclePanel({ vehicle }: { vehicle?: Vehicle }) {
  const lookup = vehicleLookup(vehicle ?? {});
  const input = lookup ?? { year: "0000", make: "-", model: "-" };
  const opts = { enabled: lookup !== null, retry: 1, staleTime: 60 * 60 * 1000 } as const;
  const recalls = trpc.vehicleData.recalls.useQuery(input, opts);
  const complaints = trpc.vehicleData.complaints.useQuery(input, opts);

  if (!lookup) {
    return (
      <Section>
        <div className="text-xs text-foreground/40">
          Add the 4-digit year, make and model to check NHTSA recalls and complaints.
        </div>
      </Section>
    );
  }

  const label = `${lookup.year} ${lookup.make} ${lookup.model}`;
  const r = recalls.data;
  const c = complaints.data;

  return (
    <Section>
      {/* Recalls */}
      {recalls.isLoading ? (
        <div className="text-xs text-foreground/40 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking recalls for {label}…
        </div>
      ) : recalls.isError || !r || !r.ok ? (
        <Unavailable
          what="recall lookup"
          detail={recalls.error?.message ?? (r && !r.ok ? r.error : undefined)}
          onRetry={() => void recalls.refetch()}
        />
      ) : r.recallCount === 0 ? (
        <div className="text-xs text-foreground/60">No recall campaigns on file for {label}.</div>
      ) : (
        <div className="bg-card border border-border/30 p-3 space-y-2">
          <div className="text-xs font-medium flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            {r.recallCount} recall campaign{r.recallCount === 1 ? "" : "s"} for {label}
            {r.recallCount > r.recalls.length && (
              <span className="text-foreground/40 font-normal">(newest {r.recalls.length} shown)</span>
            )}
          </div>
          <ul className="space-y-2">
            {r.recalls.map((rc, i) => (
              <li key={rc.campaign ?? i} className="text-[11px] border-t border-border/20 pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-foreground/60">{rc.campaign ?? "—"}</span>
                  {rc.reportedDate && <span className="text-foreground/30">{rc.reportedDate}</span>}
                  {rc.parkIt && (
                    <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 font-semibold">
                      Maker says: do not drive until repaired
                    </span>
                  )}
                  {rc.parkOutside && (
                    <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 font-semibold">
                      Maker says: park outside until repaired
                    </span>
                  )}
                </div>
                {rc.component && <div className="text-foreground/70 mt-0.5">{rc.component}</div>}
                {rc.summary && <div className="text-foreground/50 mt-0.5 line-clamp-3">{rc.summary}</div>}
                {rc.remedy && <div className="text-foreground/40 mt-0.5 line-clamp-2">Remedy: {rc.remedy}</div>}
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-foreground/40">{r.disclaimer}</div>
        </div>
      )}
      {recalls.data?.ok && recalls.data.recallCount > 0 && (
        <a
          href={NHTSA_RECALLS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary inline-flex items-center gap-1 min-h-12"
        >
          Check whether a recall is still open on this VIN at nhtsa.gov <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {/* Complaint counts */}
      {complaints.isLoading ? (
        <div className="text-xs text-foreground/40 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking owner complaints…
        </div>
      ) : complaints.isError || !c || !c.ok ? (
        <Unavailable
          what="complaint lookup"
          detail={complaints.error?.message ?? (c && !c.ok ? c.error : undefined)}
          onRetry={() => void complaints.refetch()}
        />
      ) : c.complaintCount === 0 ? (
        <div className="text-xs text-foreground/60">No owner complaints on file for {label}.</div>
      ) : (
        <div className="bg-card border border-border/30 p-3 space-y-1.5">
          <div className="text-xs font-medium">
            {c.complaintCount.toLocaleString()} owner complaint{c.complaintCount === 1 ? "" : "s"} filed
            {(c.crashCount > 0 || c.fireCount > 0 || c.injuryCount > 0) && (
              <span className="text-foreground/50 font-normal">
                {" "}· {c.crashCount} crash · {c.fireCount} fire · {c.injuryCount} injury
              </span>
            )}
          </div>
          {c.topComponents.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.topComponents.map((tc) => (
                <span key={tc.component} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60">
                  {tc.component} · {tc.count}
                </span>
              ))}
            </div>
          )}
          <div className="text-[10px] text-foreground/40">{c.disclaimer}</div>
        </div>
      )}
    </Section>
  );
}
