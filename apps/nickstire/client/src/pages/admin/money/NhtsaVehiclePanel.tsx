/**
 * NHTSA panel (Q-50) — lives in the work-order drawer.
 *
 * Shows the vehicle's recall campaigns and owner-complaint counts by year/make/model, read from
 * NHTSA's public API through `vehicleData.*` (server-cached 24 h). Information for the advisor
 * only: nothing here contacts the customer, and nothing is worded as a diagnosis.
 *
 * empty-vs-error: a failed lookup renders as "unavailable" with a retry — never as "no recalls".
 * The service returns `{ ok: false }` as a value on upstream failure, so both that and a thrown
 * query count as unavailable. A name NHTSA does not know (`reason: "unknown_vehicle"`, its 400 with
 * an empty body) is said plainly, without a Retry that could never succeed — and still never as
 * "none on file".
 *
 * Manufacturer warranty programs (Q-50 phase 2b, ADR-0021 §7) come from the stored NHTSA
 * manufacturer-communications ingest, not a live call. They are worded "may apply": the panel never
 * says a repair is covered, free or paid for, because eligibility depends on VIN, mileage,
 * in-service date and sometimes state, none of which it can check.
 */
import { useState } from "react";
import { AlertTriangle, ExternalLink, FileText, Info, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
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
        NHTSA · RECALLS, COMPLAINTS &amp; MANUFACTURER PROGRAMS <span className="font-normal">(information only)</span>
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

/** NHTSA does not know this make/model spelling: a retry cannot help, and it is still not "none on file". */
function UnknownVehicle({ what, detail }: { what: string; detail: string }) {
  return (
    <div role="status" className="bg-foreground/5 border border-border/30 p-3 text-xs text-foreground/70 flex items-start gap-2">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        NHTSA {what}: {detail} This is NOT the same as "none on file".
      </span>
    </div>
  );
}

function etDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })
    : iso;
}

type WarrantyMatch = {
  nhtsaId: number;
  documentId: string;
  signal: "nhtsa_type" | "summary_text" | "both";
  mfrDate: string | null;
  components: string | null;
  summary: string;
  match: "exact" | "related";
  nhtsaModels: string[];
  yearStated: boolean;
};

/** Summaries longer than this get a two-line clamp and a toggle; shorter ones fit as they are. */
const SUMMARY_CLAMP_CHARS = 160;

function WarrantyItem({ m }: { m: WarrantyMatch }) {
  const [open, setOpen] = useState(false);
  const long = m.summary.length > SUMMARY_CLAMP_CHARS;
  return (
    <li className="text-[11px] border-t border-border/20 pt-2 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-foreground/60">{m.documentId}</span>
        {m.mfrDate && <span className="text-foreground/30">{m.mfrDate}</span>}
        <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60">
          {m.signal === "summary_text" ? "found by summary wording" : "NHTSA: warranty program"}
        </span>
        {m.match === "related" && m.nhtsaModels.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">listed for {m.nhtsaModels.join(", ")}</span>
        )}
        {!m.yearStated && (
          <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/50">model year not stated by the manufacturer</span>
        )}
      </div>
      {m.components && <div className="text-foreground/70 mt-0.5">{m.components}</div>}
      <div className={"text-foreground/50 mt-0.5 whitespace-pre-line" + (long && !open ? " line-clamp-2" : "")}>{m.summary}</div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-h-12 text-[11px] text-primary"
          aria-expanded={open}
        >
          {open ? "Show less" : "Show full summary"}
        </button>
      )}
    </li>
  );
}

export default function NhtsaVehiclePanel({ vehicle }: { vehicle?: Vehicle }) {
  const lookup = vehicleLookup(vehicle ?? {});
  const input = lookup ?? { year: "0000", make: "-", model: "-" };
  const opts = { enabled: lookup !== null, retry: 1, staleTime: 60 * 60 * 1000 } as const;
  const recalls = trpc.vehicleData.recalls.useQuery(input, opts);
  const complaints = trpc.vehicleData.complaints.useQuery(input, opts);
  const warranty = trpc.vehicleData.warrantyExtensions.useQuery(input, opts);

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
  const w = warranty.data;
  const asked = r?.ok ? r : c?.ok ? c : null;

  return (
    <Section>
      {asked?.aliased && (
        <div className="text-[10px] text-foreground/40">
          Looked up as NHTSA spells it: {asked.make} {asked.model}
        </div>
      )}
      {/* Recalls */}
      {recalls.isLoading ? (
        <div className="text-xs text-foreground/40 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking recalls for {label}…
        </div>
      ) : r && !r.ok && r.reason === "unknown_vehicle" ? (
        <UnknownVehicle what="recall lookup" detail={r.error} />
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
      ) : c && !c.ok && c.reason === "unknown_vehicle" ? (
        <UnknownVehicle what="complaint lookup" detail={c.error} />
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

      {/* Manufacturer warranty programs (stored NHTSA ingest) */}
      {warranty.isLoading ? (
        <div className="text-xs text-foreground/40 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking manufacturer warranty programs…
        </div>
      ) : warranty.isError || !w || !w.ok ? (
        <Unavailable
          what="manufacturer program list"
          detail={warranty.error?.message ?? (w && !w.ok ? w.error : undefined)}
          onRetry={() => void warranty.refetch()}
        />
      ) : (
        <div className="bg-card border border-border/30 p-3 space-y-2">
          <div className="text-xs font-medium flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-sky-400" />
            Manufacturer warranty programs (may apply)
            {w.matchCount > w.matches.length && (
              <span className="text-foreground/40 font-normal">(newest {w.matches.length} of {w.matchCount} shown)</span>
            )}
          </div>
          {w.matchCount === 0 ? (
            <div className="text-xs text-foreground/60">None listed by NHTSA under {w.year} {w.make} {w.model}.</div>
          ) : (
            <ul className="space-y-2">
              {w.matches.map((m) => (
                <WarrantyItem key={m.nhtsaId} m={m} />
              ))}
            </ul>
          )}
          {w.truncated && (
            <div className="text-[10px] text-amber-300">The NHTSA list for this make and year is long; this view may be incomplete.</div>
          )}
          <div className={"text-[10px] " + (w.freshness.stale ? "text-amber-300" : "text-foreground/40")}>
            NHTSA list last updated {etDate(w.freshness.lastSuccessAt)}
            {w.freshness.stale ? ", may be out of date." : "."}
          </div>
          <div className="text-[10px] text-foreground/40">{w.disclaimer}</div>
          <a
            href={NHTSA_RECALLS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary inline-flex items-center gap-1 min-h-12"
          >
            Look up this vehicle at nhtsa.gov <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </Section>
  );
}
