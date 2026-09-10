/**
 * CandidatesPanel — admin visibility for /careers job applicants.
 *
 * LIVE as of 2026-09-09: drizzle/0122_candidates.sql is applied to
 * production and Careers.tsx's ApplicationForm submits through
 * trpc.candidates.submit. New applications land here, not in the Leads
 * list above. See the `candidates` table's doc comment in
 * drizzle/schema.ts for the full rationale behind why this table exists.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ChevronRight, Briefcase, Phone, Mail } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  new: "text-amber-400 bg-amber-500/10",
  contacted: "text-sky-400 bg-sky-500/10",
  interviewing: "text-violet-400 bg-violet-500/10",
  hired: "text-emerald-400 bg-emerald-500/10",
  declined: "text-red-400 bg-red-500/10",
  withdrew: "text-foreground/40 bg-foreground/5",
};

const STATUS_OPTIONS = ["new", "contacted", "interviewing", "hired", "declined", "withdrew"] as const;

export function CandidatesPanel() {
  const [open, setOpen] = useState(true);
  const utils = trpc.useUtils();
  const { data, isLoading, isError, error } = trpc.candidates.list.useQuery(undefined, { enabled: open });

  const updateStatus = trpc.candidates.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Updated.");
      utils.candidates.list.invalidate();
    },
    onError: () => toast.error("Couldn't update this candidate."),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
          <Briefcase className="w-4 h-4 text-primary" />
          Candidates
          <span className="text-[11px] font-normal text-foreground/40">
            /careers job applications
          </span>
        </span>
        <ChevronRight className={`w-4 h-4 text-foreground/40 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border/20 px-4 py-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-foreground/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading&hellip;
            </div>
          ) : isError ? (
            // Was absent entirely: a failed query left data undefined, rows
            // fell back to [], and the panel rendered "No candidates yet" — a
            // confident zero for a read that never happened. The sibling
            // TechnicianReferralsPanel already branched on this.
            <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-400">
              <strong>Couldn't load candidates.</strong> This is a read failure, not an
              empty list — applications may exist that aren't shown.
              {error?.message ? <span className="block mt-1 opacity-80">{error.message}</span> : null}
            </div>
          ) : data?.available === false ? (
            <div className="border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-400">
              <strong>Database unavailable.</strong> The candidates table could not be
              read, so this is not "no applicants" — it is "we don't know".
            </div>
          ) : data?.migrationPending ? (
            <div className="border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-400">
              <strong>Candidate tracking isn't live yet.</strong> The database migration
              (drizzle/0122_candidates.sql) hasn't been applied to this environment, and
              /careers applications still route through the Leads list above until the
              follow-up cutover lands.
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-foreground/40">
              No candidates yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((c) => {
                const statusStyle = STATUS_STYLE[c.status] ?? "text-foreground/50 bg-foreground/5";
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] border border-border/20 rounded-lg px-3 py-2"
                  >
                    <span className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wider text-[10px] shrink-0 ${statusStyle}`}>
                      {c.status}
                    </span>
                    <span className="font-semibold text-foreground/85">{c.name}</span>
                    <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-primary hover:opacity-80">
                      <Phone className="w-3 h-3" /> {c.phone}
                    </a>
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-primary hover:opacity-80">
                        <Mail className="w-3 h-3" /> {c.email}
                      </a>
                    )}
                    {c.positionTitle && (
                      <span className="text-foreground/45">{c.positionTitle}</span>
                    )}
                    {c.experienceLevel && (
                      <span className="text-foreground/35">{c.experienceLevel} exp.</span>
                    )}
                    <span className="text-foreground/30">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </span>

                    <select
                      value={c.status}
                      onChange={(e) =>
                        updateStatus.mutate({ id: c.id, status: e.target.value as (typeof STATUS_OPTIONS)[number] })
                      }
                      disabled={updateStatus.isPending}
                      className="ml-auto shrink-0 bg-[oklch(0.08_0.004_260)] border border-border/30 rounded px-2 py-1 text-[11px] text-foreground focus:border-primary/50 focus:outline-none"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
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
