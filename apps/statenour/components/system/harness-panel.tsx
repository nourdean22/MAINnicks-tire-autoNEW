"use client";

/**
 * HarnessPanel: the three PCs, open PRs and what each site runs, on /system (job 2026-11-05-harness-apps-connect).
 *
 * Read-only: this card has no action, and nothing in the path behind it can reach a PC. A PC that
 * stopped reporting reads UNKNOWN with its last-seen time. A null reading says unknown, never zero.
 */
import type { HarnessPcView, HarnessStatus } from "@/lib/services/harness-status";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { readState } from "@/lib/query-state";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const CHECK_WORD = { SUCCESS: "passing", FAILURE: "failing", PENDING: "running", NONE: "no checks" } as const;
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "unknown");
const lastSeen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function pcLine(pc: HarnessPcView): string {
  const ram = pc.ramFreeMb === null ? "RAM unknown" : `${(pc.ramFreeMb / 1024).toFixed(1)} GB free`;
  const sessions =
    pc.sessionsActive === null ? "sessions unknown" : `${pc.sessionsActive} session${pc.sessionsActive === 1 ? "" : "s"}`;
  return `${ram} · ${sessions}`;
}

function PcRow({ pc }: { pc: HarnessPcView }) {
  if (pc.state === "unknown") {
    return (
      <li className="flex flex-col gap-0.5" data-harness-pc={pc.key}>
        <span className="flex items-baseline gap-2">
          <span className="font-medium text-fg">{pc.label}</span>
          <span className="text-[11px] font-semibold tracking-wide text-amber-300">UNKNOWN</span>
        </span>
        <span className="text-xs text-fg-secondary">
          {pc.lastSeenAt ? `Last seen ${lastSeen(pc.lastSeenAt)}. ` : ""}
          {pc.reason}
        </span>
      </li>
    );
  }
  const health = pc.health === null ? "Health unknown" : pc.health.ok ? "Health ok" : pc.health.problems.join(", ");
  return (
    <li className="flex flex-col gap-0.5" data-harness-pc={pc.key}>
      <span className="font-medium text-fg">{pc.label}</span>
      <span className="text-xs text-fg-secondary">{pcLine(pc)}</span>
      <span className={cn("text-xs", pc.health?.ok ? "text-fg-tertiary" : "text-amber-200")}>{health}</span>
    </li>
  );
}

function Sites({ status }: { status: HarnessStatus }) {
  const site = (name: "bdnick" | "nickstire") => {
    const commit = status.sites[name]?.commit;
    return (
      <span>
        {name} {short(commit)}
      </span>
    );
  };
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
      {site("bdnick")}
      {site("nickstire")}
      <span>main {short(status.mainSha)}</span>
    </p>
  );
}

function GraphAndVault({ status }: { status: HarnessStatus }) {
  const { graph, vault } = status;
  const server = graph?.serverUp === null ? "server unknown" : graph?.serverUp ? "server up" : "server down";
  const counts =
    vault.exportedCount !== null && vault.liveCount !== null
      ? `${vault.exportedCount.toLocaleString("en-US")} of ${vault.liveCount.toLocaleString("en-US")} memories exported`
      : vault.liveCount !== null
        ? `${vault.liveCount.toLocaleString("en-US")} live memories, exported count unknown`
        : "Memory counts unknown";
  const vaultGraph = !vault.graph
    ? "Vault graph unknown"
    : vault.graph.exists
      ? `Vault graph built ${vault.graph.builtAt ? lastSeen(vault.graph.builtAt) : "at an unknown time"}`
      : "Vault graph not built";
  return (
    <div className="flex flex-col gap-1 text-xs text-fg-secondary">
      <p>
        {graph
          ? `Code graph ${server} · built ${short(graph.builtCommit)} · ${graph.behind === null ? "commits behind unknown" : `${graph.behind} behind main`}`
          : `Code graph unknown. ${status.graphReason}.`}
      </p>
      <p>{vault.lastExportAt ? `Last export ${lastSeen(vault.lastExportAt)}` : "Last export unknown"}</p>
      <p>{counts}</p>
      <p>{vaultGraph}</p>
    </div>
  );
}

function Prs({ status }: { status: HarnessStatus }) {
  if (!status.prs) return <p className="text-xs text-amber-200">PRs unknown. {status.prsReason}.</p>;
  if (status.prs.items.length === 0) return <p className="text-xs text-fg-secondary">No open PRs.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {status.prs.items.map((pr) => (
        <li key={pr.number} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-fg-secondary">
            #{pr.number} {pr.title}
          </span>
          <span className={cn("shrink-0", pr.checks === "FAILURE" ? "text-rose-300" : "text-fg-tertiary")}>
            {CHECK_WORD[pr.checks]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HarnessView({ status }: { status: HarnessStatus }) {
  return (
    <>
      <p className="text-sm text-fg">
        {status.reporting} of {status.pcs.length} PCs reporting
      </p>
      <ul className="flex flex-col gap-3">
        {status.pcs.map((pc) => (
          <PcRow key={pc.key} pc={pc} />
        ))}
      </ul>
      <Sites status={status} />
      <GraphAndVault status={status} />
      <Prs status={status} />
      <p className="text-[11px] text-fg-tertiary">
        Read {lastSeen(status.generatedAt)}. Read-only. Nothing here can merge, restart or run anything.
      </p>
    </>
  );
}

export function HarnessPanel() {
  const query = trpc.system.harnessStatus.useQuery(undefined, { refetchInterval: 60_000 });
  const rs = readState(query);
  const status = query.data as HarnessStatus | undefined;
  const allReporting = status ? status.reporting === status.pcs.length : false;

  return (
    <section
      aria-labelledby="harness-heading"
      className={cn("flex flex-col gap-4 border-l-2 pl-5 sm:pl-6", allReporting ? "border-edge-strong" : "border-amber-400/70")}
    >
      <h2 id="harness-heading" className="vt-eyebrow text-fg-secondary">
        Harness
      </h2>
      {!status && rs === "loading" && <ShimmerSkeleton className="h-24 w-full" />}
      {!status && rs !== "loading" && (
        <div data-read-failed>
          <ReadStateNote state={rs} label="Harness" onRetry={() => void query.refetch()} />
        </div>
      )}
      {status && (
        <>
          <ReadStateNote state={rs} label="Harness" onRetry={() => void query.refetch()} />
          <HarnessView status={status} />
        </>
      )}
    </section>
  );
}
