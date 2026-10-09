/**
 * /proof — mission control for the Dream-to-Proof loop.
 *
 * One screen, top to bottom: how much evidence exists at each grade, which
 * claims stand, what reality reported most recently, the judged commits
 * (Repo Time Machine), the weekly receptionist prompt experiments, what Nour
 * decided between candidates, and what Night Shift proposed. Server component
 * reading the ledger directly. /api/proof/summary serves the proofSummary()
 * part and /api/proof/timeline serves proofTimeline(); the receptionist
 * section (recentPromptExperiments) has no API equivalent yet.
 * Empty-state tolerant by design: on a fresh ledger every list says so.
 */
import { StandardPage } from "@/components/layout/standard-page";
import { proofSummary, recentPromptExperiments, type PromptExperimentGateView, type PromptExperimentRow } from "@/lib/services/reality-ledger";
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

/**
 * Receptionist experiments (2026-10-09): one line per weekly prompt-evolution
 * run. A gate the run never reached reads "not run", an absent number is
 * omitted (never printed as 0), and an unreadable lane parity is "unknown".
 */
function gateVerdict(g: PromptExperimentGateView): string {
  if (!g.ran) return "not run";
  return g.verdict ?? "unknown";
}

/**
 * Rose = this gate blocked the candidate or names harm, so the operator sees it
 * at a glance on a phone. Vocabulary from nickstire promptEvolutionGate.ts:
 * the success cohort vetoes on EVERY reason except "preserved" (judgeSuccessCohort,
 * veto = reason !== "preserved"; success-empty included: no evidence of harm from
 * no evidence is a false green); holdout and confirmation name harm only as
 * "regressed-seed". Not run and unknown stay grey: neither is a veto claim.
 */
function gateAlarm(kind: "holdout" | "success" | "confirmation", g: PromptExperimentGateView): boolean {
  if (!g.ran || g.verdict === null) return false;
  return kind === "success" ? g.verdict !== "preserved" : g.verdict === "regressed-seed";
}

function holdoutGateText(x: PromptExperimentRow): string {
  const g = x.holdout;
  if (!g.ran) return "holdout: not run";
  const p = g.pValue !== null ? ` p=${g.pValue.toFixed(3)}` : "";
  const seeds = g.comparable !== null ? ` · +${g.improved ?? "?"} -${g.worsened ?? "?"} of ${g.comparable} seeds` : "";
  const cohort = x.cohorts.holdout !== null ? ` (cohort ${x.cohorts.holdout})` : "";
  return `holdout: ${gateVerdict(g)}${p}${seeds}${cohort}`;
}

function laneText(x: PromptExperimentRow): string {
  if (x.laneParity === "match") return "lanes: parity";
  if (x.laneParity === "unknown") return "lanes: parity unknown";
  return `lanes: MISMATCH${x.laneDifferences.length > 0 ? ` (${x.laneDifferences.slice(0, 4).join(", ")})` : ""}`;
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
  const [s, timeline, experiments] = await Promise.all([proofSummary(12), proofTimeline(10), recentPromptExperiments(8)]);
  const totalClaims = Object.values(s.byGrade).reduce((a, b) => a + b, 0);

  return (
    <StandardPage eyebrow="System / proof" title="Proof" description="reality → hypothesis → proof → judgment → retained learning">
      {!s.ledgerAvailable && (
        <div role="status" className="mb-6 rounded-surface border border-edge-subtle bg-content px-4 py-3 text-sm">
          <span className="font-semibold">Ledger not migrated yet.</span>{" "}
          <span className="text-fg-secondary">
            Apply <code className="font-mono text-xs">prisma/migrations/20260915140000_reality_ledger</code> and confirm with <code className="font-mono text-xs">prisma migrate status</code>. Until then every list below is empty by construction, not by fact.
          </span>
        </div>
      )}
      <section aria-labelledby="grades" className="mb-8">
        <h2 id="grades" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">
          Evidence on file · {totalClaims} claim{totalClaims === 1 ? "" : "s"}
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(s.byGrade).map(([grade, n]) => (
            <div key={grade} className="rounded-surface border border-edge-subtle bg-content px-3 py-2">
              <div className="font-mono text-sm text-fg-secondary">{grade}</div>
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-[11px] text-fg-secondary">{GRADE_LABEL[grade]}</div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="claims" className="mb-8">
        <h2 id="claims" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">Standing claims</h2>
        {s.claims.length === 0 ? (
          <p className="text-sm text-fg-secondary">No claims yet. The first arrives when a web experiment resolves or a proof run fails an episode.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {s.claims.map((c) => (
              <li key={c.id} className="py-3 flex gap-3">
                <span className="font-mono text-xs text-fg-secondary shrink-0 w-8">{c.grade}</span>
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
        <h2 id="events" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">Reality, most recent</h2>
        {s.events.length === 0 ? (
          <p className="text-sm text-fg-secondary">No events yet. The nickstire cron and the proof workflow post here.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
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
        <h2 id="timeline" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">Repo Time Machine · judged commits</h2>
        {timeline.commits.length === 0 ? (
          <p className="text-sm text-fg-secondary">No judged commits yet. Every proof run records the commit the live site actually served; rows appear here, newest first, with the delta against the previous judged commit.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {timeline.commits.map((c) => (
              <li key={c.liveCommit ?? "unknown"} className="py-3 text-sm">
                <div className="flex flex-wrap gap-x-3 items-baseline">
                  {c.liveCommit ? (
                    <a href={`${REPO_COMMIT_URL}${c.liveCommit}`} className="font-mono text-xs text-fg-secondary underline-offset-2 hover:text-fg hover:underline">{c.liveCommit.slice(0, 9)}</a>
                  ) : (
                    <span className="font-mono text-xs text-fg-secondary">unknown commit</span>
                  )}
                  <span className="font-mono text-xs">
                    run: {c.runOutcome ?? "—"}
                    {c.unexpected !== null ? ` ${c.unexpected} failed${delta(c.deltas.unexpected)}` : ""}
                  </span>
                  <span className={`font-mono text-xs ${c.holdout?.outcome === "failure" ? "text-rose-300" : "text-fg-secondary"}`}>{holdoutText(c.holdout, c.deltas.holdoutUnexpected)}</span>
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

      <section aria-labelledby="receptionist" className="mb-8">
        <h2 id="receptionist" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">Receptionist experiments &middot; weekly prompt evolution</h2>
        {experiments.status === "unavailable" ? (
          <p role="status" data-experiments-state="unavailable" className="text-sm text-fg-secondary">
            {experiments.reason === "not_migrated"
              ? "Couldn't load receptionist experiments: the ledger is not migrated here. State unknown, not empty."
              : "Couldn't load receptionist experiments: the ledger read failed. State unknown, not empty."}
          </p>
        ) : experiments.rows.length === 0 ? (
          <p data-experiments-state="empty" className="text-sm text-fg-secondary">No receptionist experiments recorded yet. Each weekly prompt-evolution run in Nick&apos;s posts one receipt here; approving a candidate stays the Push Config in Nick&apos;s admin.</p>
        ) : (
          <ul data-experiments-state="rows" className="divide-y divide-edge-subtle">
            {experiments.rows.map((x) => (
              <li key={x.id} className="py-3 text-sm">
                <div className="flex flex-wrap gap-x-3 items-baseline">
                  <span className="font-mono text-xs">{x.outcome ?? "outcome unknown"}</span>
                  <span className="font-mono text-xs text-fg-secondary">stage: {x.promotionStage ?? "unknown"}</span>
                  <span className={`font-mono text-xs ${gateAlarm("holdout", x.holdout) ? "text-rose-300" : "text-fg-secondary"}`}>{holdoutGateText(x)}</span>
                  <span className="text-fg-secondary text-xs ml-auto">{when(x.occurredAt)}</span>
                </div>
                <p className="text-[11px] text-fg-secondary mt-1">
                  <span className={gateAlarm("success", x.success) ? "text-rose-300" : undefined}>{`success cohort: ${gateVerdict(x.success)}`}</span> &middot;{" "}
                  <span className={gateAlarm("confirmation", x.confirmation) ? "text-rose-300" : undefined}>{`confirmation: ${gateVerdict(x.confirmation)}`}</span> &middot;{" "}
                  <span className={x.laneParity === "mismatch" ? "text-rose-300" : undefined}>{laneText(x)}</span> &middot; previous proposal: {x.previousProposalStatus ?? "not reported"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="taste" className="mb-8">
        <h2 id="taste" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">Your judgments</h2>
        {s.judgments.length === 0 ? (
          <p className="text-sm text-fg-secondary">None yet. Every accept/reject between two candidates lands here and teaches the critic what you prefer &mdash; never what is &ldquo;objectively better&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
            {s.judgments.map((j) => (
              <li key={j.id} className="py-3">
                <p className="text-sm">
                  <span className="font-semibold">{j.surface}</span> · preferred <span className="font-mono text-fg">{j.winner}</span> · {j.reasonCodes.join(", ")}
                </p>
                <p className="text-[11px] text-fg-secondary mt-1">{j.context.slice(0, 160)} · {when(j.decidedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="proposals">
        <h2 id="proposals" className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-3">Night Shift proposals</h2>
        {s.proposals.length === 0 ? (
          <p className="text-sm text-fg-secondary">None yet. A proposal is one PR with its proof receipts; merging it is the only way it ships.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle">
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
