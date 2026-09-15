/**
 * /proof — mission control for the Dream-to-Proof loop.
 *
 * One screen, top to bottom: how much evidence exists at each grade, what
 * reality reported most recently, which claims stand, what Nour decided
 * between candidates, and what Night Shift proposed. Server component
 * reading the ledger directly (the same query /api/proof/summary serves).
 * Empty-state tolerant by design: on a fresh ledger every list says so.
 */
import { StandardPage } from "@/components/layout/standard-page";
import { proofSummary } from "@/lib/services/reality-ledger";
import { proofTimeline, type ProofCommitRow } from "@/lib/services/proof-timeline";

const REPO_COMMIT_URL = "https://github.com/nourdean22/MAINnicks-tire-autoNEW/commit/";

function delta(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return " (=)";
  return n > 0 ? ` (+${n})` : ` (${n})`;
}

function holdoutText(h: ProofCommitRow["holdout"], d: number | null): string {
  if (!h) return "holdout: not run";
  if (h.outcome === "unmeasured") return "holdout: unmeasured";
  const counts = h.total !== null ? ` ${h.unexpected ?? "?"}/${h.total} failed` : "";
  return `holdout: ${h.outcome}${counts}${delta(d)}`;
}

export const dynamic = "force-dynamic";

const GRADE_LABEL: Record<string, string> = {
  H0: "hypothesis",
  H1: "heuristic",
  H2: "synthetic",
  H3: "observational",
  H4: "randomized",
  H5: "physical / revenue",
};

function when(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function ProofPage() {
  const [s, timeline] = await Promise.all([proofSummary(12), proofTimeline(10)]);
  const totalClaims = Object.values(s.byGrade).reduce((a, b) => a + b, 0);

  return (
    <StandardPage eyebrow="System / proof" title="Proof" description="reality → hypothesis → proof → judgment → retained learning">
      {!s.ledgerAvailable && (
        <div role="status" className="mb-6 rounded-lg border border-glass bg-elevated px-4 py-3 text-sm">
          <span className="font-semibold">Ledger not migrated yet.</span>{" "}
          <span className="text-fg-secondary">
            Apply <code className="font-mono text-xs">prisma/migrations/20260915140000_reality_ledger</code> and confirm with <code className="font-mono text-xs">prisma migrate status</code>. Until then every list below is empty by construction, not by fact.
          </span>
        </div>
      )}
      <section aria-labelledby="grades" className="mb-8">
        <h2 id="grades" className="text-xs uppercase tracking-widest text-fg-secondary mb-3">
          Evidence on file · {totalClaims} claim{totalClaims === 1 ? "" : "s"}
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(s.byGrade).map(([grade, n]) => (
            <div key={grade} className="rounded-lg border border-glass bg-elevated px-3 py-2">
              <div className="font-mono text-sm text-gold">{grade}</div>
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-[11px] text-fg-secondary">{GRADE_LABEL[grade]}</div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="claims" className="mb-8">
        <h2 id="claims" className="text-xs uppercase tracking-widest text-fg-secondary mb-3">Standing claims</h2>
        {s.claims.length === 0 ? (
          <p className="text-sm text-fg-secondary">No claims yet. The first arrives when a web experiment resolves or a proof run fails an episode.</p>
        ) : (
          <ul className="divide-y divide-glass">
            {s.claims.map((c) => (
              <li key={c.id} className="py-3 flex gap-3">
                <span className="font-mono text-xs text-gold shrink-0 w-8">{c.grade}</span>
                <div className="min-w-0">
                  <p className="text-sm">{c.claimText}</p>
                  <p className="text-[11px] text-fg-secondary mt-1">
                    {c.disposition.toLowerCase()} · {c.createdBy.toLowerCase()} · {c.hypothesisId ?? "—"} · {when(c.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="events" className="mb-8">
        <h2 id="events" className="text-xs uppercase tracking-widest text-fg-secondary mb-3">Reality, most recent</h2>
        {s.events.length === 0 ? (
          <p className="text-sm text-fg-secondary">No events yet. The nickstire cron and the proof workflow post here.</p>
        ) : (
          <ul className="divide-y divide-glass">
            {s.events.map((e) => (
              <li key={e.id} className="py-2 text-sm flex flex-wrap gap-x-3">
                <span className="font-mono text-xs">{e.eventType}</span>
                <span className="text-fg-secondary text-xs">{e.sourceSystem}</span>
                <span className="text-fg-secondary text-xs">{(e.objects as Array<{ type: string; id: string }>).map((o) => `${o.type}:${o.id}`).join(" · ")}</span>
                <span className="text-fg-secondary text-xs ml-auto">{when(e.observedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="timeline" className="mb-8">
        <h2 id="timeline" className="text-xs uppercase tracking-widest text-fg-secondary mb-3">Repo Time Machine · judged commits</h2>
        {timeline.commits.length === 0 ? (
          <p className="text-sm text-fg-secondary">No judged commits yet. Every proof run records the commit nickstire.org actually served; rows appear here, newest first, with the delta against the previous judged commit.</p>
        ) : (
          <ul className="divide-y divide-glass">
            {timeline.commits.map((c) => (
              <li key={c.liveCommit ?? "unknown"} className="py-3 text-sm">
                <div className="flex flex-wrap gap-x-3 items-baseline">
                  {c.liveCommit ? (
                    <a href={`${REPO_COMMIT_URL}${c.liveCommit}`} className="font-mono text-xs text-gold underline-offset-2 hover:underline">{c.liveCommit.slice(0, 9)}</a>
                  ) : (
                    <span className="font-mono text-xs text-fg-secondary">unknown commit</span>
                  )}
                  <span className="font-mono text-xs">
                    run: {c.runOutcome ?? "—"}
                    {c.unexpected !== null ? ` ${c.unexpected} failed${delta(c.deltas.unexpected)}` : ""}
                  </span>
                  <span className={`font-mono text-xs ${c.holdout?.outcome === "failure" ? "text-gold" : "text-fg-secondary"}`}>{holdoutText(c.holdout, c.deltas.holdoutUnexpected)}</span>
                  <span className="text-fg-secondary text-xs ml-auto">
                    {c.runs} run{c.runs === 1 ? "" : "s"} · {when(c.judgedAt)}
                  </span>
                </div>
                {(c.episodeFailures.length > 0 || c.deltas.fixedFailures.length > 0) && (
                  <p className="text-[11px] text-fg-secondary mt-1">
                    {c.episodeFailures.length > 0 && <>failing: {c.episodeFailures.join(", ")}</>}
                    {c.deltas.newFailures.length > 0 && <> · new: {c.deltas.newFailures.join(", ")}</>}
                    {c.deltas.fixedFailures.length > 0 && <> · fixed since previous: {c.deltas.fixedFailures.join(", ")}</>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="taste" className="mb-8">
        <h2 id="taste" className="text-xs uppercase tracking-widest text-fg-secondary mb-3">Your judgments</h2>
        {s.judgments.length === 0 ? (
          <p className="text-sm text-fg-secondary">None yet. Every accept/reject between two candidates lands here and teaches the critic what you prefer &mdash; never what is &ldquo;objectively better&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-glass">
            {s.judgments.map((j) => (
              <li key={j.id} className="py-3">
                <p className="text-sm">
                  <span className="font-semibold">{j.surface}</span> · preferred <span className="text-gold font-mono">{j.winner}</span> · {j.reasonCodes.join(", ")}
                </p>
                <p className="text-[11px] text-fg-secondary mt-1">{j.context.slice(0, 160)} · {when(j.decidedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="proposals">
        <h2 id="proposals" className="text-xs uppercase tracking-widest text-fg-secondary mb-3">Night Shift proposals</h2>
        {s.proposals.length === 0 ? (
          <p className="text-sm text-fg-secondary">None yet. A proposal is one PR with its proof receipts; merging it is the only way it ships.</p>
        ) : (
          <ul className="divide-y divide-glass">
            {s.proposals.map((p) => (
              <li key={p.id} className="py-2 text-sm flex flex-wrap gap-x-3">
                <span className="font-mono text-xs">{p.status.toLowerCase()}</span>
                <span className="truncate">{String((p.requestPayload as Record<string, unknown>)?.hypothesis ?? p.id)}</span>
                <span className="text-fg-secondary text-xs ml-auto">{when(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </StandardPage>
  );
}
