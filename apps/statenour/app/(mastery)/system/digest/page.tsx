"use client";

/**
 * /system/digest (Wire 3) — read-only surface for the truth/intelligence
 * services that were previously chat-command / API-only:
 *   · What Changed (F2 system change digest, honest deploy status)
 *   · Truth Scoreboard (memory-eval report)
 *   · Recent Receipts (F4 action receipt feed)
 * No mutation, no new logic — just renders existing services. Each card links to
 * the chat command that drills in. Not a duplicate of /brain/continuity (that's
 * the raw activity firehose; this is glanceable summaries).
 */

import { FileText, Telescope, ListChecks, Receipt } from "lucide-react";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";

function Card({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-amber-200/90">
        <Icon className="h-4 w-4" />
        <h2 className="text-sm font-medium uppercase tracking-wide">{title}</h2>
        {action && <span className="ml-auto text-xs text-zinc-600">{action}</span>}
      </div>
      <div className="space-y-1 text-sm text-zinc-300">{children}</div>
    </section>
  );
}

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "ok" | "warn" }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-zinc-500">{k}</span>
    <span className={cn("text-right", tone === "warn" ? "text-rose-300" : tone === "ok" ? "text-emerald-300" : "text-zinc-200")}>{v}</span>
  </div>
);

export default function SystemDigestPage() {
  const changed = trpc.system.changeDigest.useQuery(undefined, { refetchInterval: 120_000 });
  const evals = trpc.system.memoryEvals.useQuery(undefined, { refetchInterval: 300_000 });
  const receipts = trpc.system.receiptFeed.useQuery(undefined, { refetchInterval: 120_000 });

  const cd = changed.data;
  const me = evals.data;
  const rf = receipts.data;
  const icon = (s: string) => (s === "success" ? "✓" : s === "failed" ? "✗" : "•");

  return (
    <StandardPage eyebrow="System / digest" title="Digest" description="What changed · truth scoreboard · recent receipts — read-only.">
      <div className="grid gap-4 md:grid-cols-3">
        <Card icon={Telescope} title="What Changed" action="/what-changed">
          {cd ? (
            <>
              {cd.latestWave && (
                <Row k="Last wave" v={`${cd.latestWave.date ?? "?"} · ${cd.latestWave.ships.length} ships`} />
              )}
              <Row k="Truth evals" v={`${cd.truth.evals.passed}/${cd.truth.evals.total}`} tone={cd.truth.evals.failed ? "warn" : "ok"} />
              <Row k="Stale docs" v={`${cd.truth.staleCriticalInKeyDocs} critical`} tone={cd.truth.staleCriticalInKeyDocs ? "warn" : "ok"} />
              <Row k="Deploy" v={cd.deployment.status} tone={cd.deployment.status === "production" ? "ok" : undefined} />
              <p className="pt-1 text-xs text-zinc-500">{cd.nextOwnerDecision}</p>
            </>
          ) : (
            <span className="text-zinc-600">{changed.isError ? "unavailable" : "loading…"}</span>
          )}
        </Card>

        <Card icon={ListChecks} title="Truth Scoreboard" action="eval:memory">
          {me ? (
            <>
              <Row k="Pass" v={`${me.passed}/${me.total}`} tone={me.failed ? "warn" : "ok"} />
              {me.failed > 0 && <Row k="Fail" v={me.failed} tone="warn" />}
              <Row k="Manual" v={me.manual} />
              <Row k="Grounding docs" v={`${me.sourcesFound}/${me.sourcesExpected}`} />
              <Row k="Dataset" v={me.datasetIssues.length ? `${me.datasetIssues.length} issue(s)` : "valid"} tone={me.datasetIssues.length ? "warn" : "ok"} />
            </>
          ) : (
            <span className="text-zinc-600">{evals.isError ? "unavailable" : "loading…"}</span>
          )}
        </Card>

        <Card icon={Receipt} title="Recent Receipts" action="/receipts">
          {rf ? (
            rf.items.length === 0 ? (
              <span className="text-zinc-600">No recent actions.</span>
            ) : (
              <>
                <Row k="Actions" v={`${rf.counts.total} · ${rf.counts.success} ok · ${rf.counts.failed} failed`} tone={rf.counts.failed ? "warn" : "ok"} />
                <ul className="space-y-0.5 pt-1 text-xs">
                  {rf.items.slice(0, 6).map((r) => (
                    <li key={r.receiptId} className={cn(r.status === "failed" ? "text-rose-300" : "text-zinc-400")}>
                      {icon(r.status)} {r.userVisibleSummary}
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <span className="text-zinc-600">{receipts.isError ? "unavailable" : "loading…"}</span>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-zinc-600">
        <FileText className="mr-1 inline h-3 w-3" />
        Read-only. These run the same services as the chat commands · the API routes under /api/system/*.
      </p>
    </StandardPage>
  );
}
