/**
 * HarnessCard: the three PCs, open PRs and what each site runs, on Settings > Status
 * (job 2026-11-05-harness-apps-connect).
 *
 * Read-only: this card has no action, and nothing behind it can reach a PC. A PC that stopped
 * reporting reads UNKNOWN with its last-seen time. A null reading says unknown, never zero.
 */
import { Activity } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { ErrorState, Panel } from "../shared";

const CHECK_WORD = { SUCCESS: "passing", FAILURE: "failing", PENDING: "running", NONE: "no checks" } as const;
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "unknown");
const lastSeen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: BUSINESS.timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const count = (n: number) => n.toLocaleString("en-US");

export default function HarnessCard() {
  const query = trpc.nourOsBridge.harnessStatus.useQuery(undefined, { refetchInterval: 60_000 });
  const status = query.data;

  if (!status) {
    return (
      <Panel title="Harness" icon={<Activity className="w-4 h-4" />}>
        {query.isError ? (
          <ErrorState message="The harness could not be read; state unknown, not healthy." onRetry={() => void query.refetch()} />
        ) : (
          <p className="text-[13px] text-foreground/50 p-2">The harness has not been read yet; state unknown.</p>
        )}
      </Panel>
    );
  }

  const { graph, vault } = status;
  const server = graph?.serverUp === null ? "server unknown" : graph?.serverUp ? "server up" : "server down";
  const behind = graph?.behind === null ? "commits behind unknown" : `${graph?.behind} behind main`;

  return (
    <Panel title="Harness" subtitle={`${status.reporting} of ${status.pcs.length} PCs reporting`} icon={<Activity className="w-4 h-4" />}>
      <div className="flex flex-col gap-4 p-2">
        {query.isError ? (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-amber-400">Last refresh failed; state unknown. This is the read from {lastSeen(status.generatedAt)}.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="min-h-12 min-w-12 self-start px-4 rounded-md border border-border/40 text-[12px] text-foreground/85"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-foreground/50">Read {lastSeen(status.generatedAt)}</p>
        )}
        <ul className="flex flex-col gap-3">
          {status.pcs.map((pc) =>
            pc.state === "unknown" ? (
              <li key={pc.key} className="flex flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-foreground">{pc.label}</span>
                  <span className="text-[11px] font-semibold text-amber-400">UNKNOWN</span>
                </span>
                <span className="text-[12px] text-foreground/60">
                  {pc.lastSeenAt ? `Last seen ${lastSeen(pc.lastSeenAt)}. ` : ""}
                  {pc.reason}
                </span>
              </li>
            ) : (
              <li key={pc.key} className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-foreground">{pc.label}</span>
                <span className="text-[12px] text-foreground/60">
                  {pc.ramFreeMb === null ? "RAM unknown" : `${(pc.ramFreeMb / 1024).toFixed(1)} GB free`}
                  {" · "}
                  {pc.sessionsActive === null
                    ? "sessions unknown"
                    : `${pc.sessionsActive} session${pc.sessionsActive === 1 ? "" : "s"}`}
                </span>
                <span className={`text-[12px] ${pc.health?.ok ? "text-foreground/50" : "text-amber-400"}`}>
                  {pc.health === null ? "Health unknown" : pc.health.ok ? "Health ok" : pc.health.problems.join(", ")}
                </span>
              </li>
            ),
          )}
        </ul>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-foreground/60">
          <span>bdnick {short(status.sites.bdnick?.commit)}</span>
          <span>nickstire {short(status.sites.nickstire?.commit)}</span>
          <span>main {short(status.mainSha)}</span>
        </p>
        <div className="flex flex-col gap-1 text-[12px] text-foreground/60">
          <p>{graph ? `Code graph ${server} · built ${short(graph.builtCommit)} · ${behind}` : `Code graph unknown. ${status.graphReason}.`}</p>
          <p>{vault.lastExportAt ? `Last export ${lastSeen(vault.lastExportAt)}` : "Last export unknown"}</p>
          <p>
            {vault.exportedCount !== null && vault.liveCount !== null
              ? `${count(vault.exportedCount)} of ${count(vault.liveCount)} memories exported`
              : "Memory counts unknown"}
          </p>
          <p>
            {!vault.graph
              ? "Vault graph unknown"
              : vault.graph.exists
                ? `Vault graph built ${vault.graph.builtAt ? lastSeen(vault.graph.builtAt) : "at an unknown time"}`
                : "Vault graph not built"}
          </p>
        </div>
        {!status.prs ? (
          <p className="text-[12px] text-amber-400">PRs unknown. {status.prsReason}.</p>
        ) : status.prs.items.length === 0 ? (
          <p className="text-[12px] text-foreground/60">No open PRs.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {status.prs.items.map((pr) => (
              <li key={pr.number} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate text-foreground/70">
                  #{pr.number} {pr.title}
                </span>
                <span className={`shrink-0 ${pr.checks === "FAILURE" ? "text-red-400" : "text-foreground/50"}`}>
                  {CHECK_WORD[pr.checks]}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-foreground/50">Read-only. Nothing here can merge, restart or run anything.</p>
      </div>
    </Panel>
  );
}
