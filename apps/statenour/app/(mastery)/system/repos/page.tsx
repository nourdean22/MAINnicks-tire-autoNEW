"use client";

/**
 * /system/repos · v10 Track E.2 · Apr 30.
 *
 * Live REPO-MAP. Reads /api/system/repos and shows every repo in
 * the ecosystem grouped by ring (personal / business / desktop /
 * archive) with health color, last commit, deploy target, branch,
 * and next-action.
 *
 * Closes the "what's going on with my repos?" gap. Combined with
 * /system/schema-history (B.4) and /system/deployment-truth (E.4),
 * the operator gets one screen per surface for "is this part of
 * the system healthy?"
 *
 * v10 contract: read-only. NICK never writes to repos from this
 * page.
 */

import { useCallback, useEffect, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { authedFetch } from "@/hooks/use-authed-fetch";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Archive,
  ExternalLink,
  GitBranch,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Health = "green" | "yellow" | "red" | "gray";
type Ring = "personal" | "business" | "desktop" | "archive";

interface RepoLive {
  name: string;
  lastCommitSha: string | null;
  lastCommitMessage: string | null;
  lastCommitAt: string | null;
  defaultBranch: string | null;
  fetchOk: boolean;
  fetchError: string | null;
}

interface RepoPayload {
  name: string;
  fullName: string;
  ring: Ring;
  tier: string;
  purpose: string;
  host: string;
  branch: string | null;
  productionUrl: string | null;
  status: string;
  monitored: boolean;
  nickWriteAccess: string;
  nextAction?: string;
  notes?: string;
  live: RepoLive | null;
  health: Health;
  lastCommitAgeHours: number | null;
}

interface ReposResponse {
  generatedAt: string;
  liveDataAvailable: boolean;
  repos: RepoPayload[];
  summary: {
    total: number;
    active: number;
    monitored: number;
    archived: number;
    green: number;
    yellow: number;
    red: number;
    gray: number;
  };
}

// v10 E.3 · Ecosystem briefing payload (commit-window narrative)
interface EcosystemDigest {
  generatedAt: string;
  liveDataAvailable: boolean;
  totalCommitsLast7d: number;
  totalCommitsLast30d: number;
  flags: Array<{
    repo: string;
    reason: string;
    severity: "info" | "warn" | "alert";
  }>;
  narrative: string;
  repos: Array<{
    repo: { name: string; ring: Ring };
    commitsLast7d: number | null;
    commitsLast30d: number | null;
    lastCommitMessage: string | null;
    flagReasons: string[];
  }>;
}

function HealthIcon({ health }: { health: Health }) {
  if (health === "green")
    return <CheckCircle2 size={14} className="text-emerald-300" />;
  if (health === "yellow")
    return <AlertTriangle size={14} className="text-amber-300" />;
  if (health === "red") return <XCircle size={14} className="text-rose-300" />;
  return <Archive size={14} className="text-zinc-500" />;
}

function ageLabel(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 1) return "<1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const RING_LABEL: Record<Ring, string> = {
  personal: "personal · command center",
  business: "business · Nick's Tire & Auto",
  desktop: "desktop · local agent",
  archive: "archive · historical",
};

export default function ReposPage() {
  const [data, setData] = useState<ReposResponse | null>(null);
  const [digest, setDigest] = useState<EcosystemDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch repo state + briefing in parallel — both are owner-gated
      // and cached. The briefing endpoint is best-effort: a failure
      // there should never blank the dashboard.
      const [reposRes, briefingRes] = await Promise.all([
        authedFetch("/api/system/repos"),
        authedFetch("/api/system/repo-briefing").catch(() => null),
      ]);
      if (!reposRes.ok)
        throw new Error(`${reposRes.status} ${reposRes.statusText}`);
      const j = (await reposRes.json()) as
        | { data?: ReposResponse }
        | ReposResponse;
      setData(("data" in j && j.data ? j.data : (j as ReposResponse)));
      if (briefingRes && briefingRes.ok) {
        const b = (await briefingRes.json()) as
          | { data?: EcosystemDigest }
          | EcosystemDigest;
        setDigest(("data" in b && b.data ? b.data : (b as EcosystemDigest)));
      }
      setLastFetched(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 5min poll — repo state changes infrequently. v10 B.1 FIND-08
    // pattern: don't over-poll for low-frequency data.
    const i = setInterval(load, 5 * 60_000);
    return () => clearInterval(i);
  }, [load]);

  // v10.0.438 · sort key for repos within each ring
  type RepoSort = "name" | "live-first" | "monitored-first" | "fresh-commit" | "stale-commit";
  const [sortKey, setSortKey] = useState<RepoSort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("system-repos:sortKey");
    const valid: RepoSort[] = ["name", "live-first", "monitored-first", "fresh-commit", "stale-commit"];
    return saved && valid.includes(saved as RepoSort) ? (saved as RepoSort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-repos:sortKey", sortKey);
  }, [sortKey]);

  const grouped = data
    ? (Object.keys(RING_LABEL) as Ring[]).map((ring) => {
        const repos = data.repos.filter((r) => r.ring === ring);
        const sorted = [...repos].sort((a, b) => {
          switch (sortKey) {
            case "live-first": {
              const la = a.live ? 0 : 1;
              const lb = b.live ? 0 : 1;
              if (la !== lb) return la - lb;
              return a.name.localeCompare(b.name);
            }
            case "monitored-first": {
              const ma = a.monitored ? 0 : 1;
              const mb = b.monitored ? 0 : 1;
              if (ma !== mb) return ma - mb;
              return a.name.localeCompare(b.name);
            }
            case "fresh-commit":
              return (a.lastCommitAgeHours ?? 9999) - (b.lastCommitAgeHours ?? 9999);
            case "stale-commit":
              return (b.lastCommitAgeHours ?? 0) - (a.lastCommitAgeHours ?? 0);
            case "name":
            default:
              return a.name.localeCompare(b.name);
          }
        });
        return { ring, repos: sorted };
      })
    : [];

  return (
    <StandardPage
      eyebrow="System · v10 Track E.2"
      title="repos"
      description="Live REPO-MAP · 8 repos across personal/business/desktop/archive · read-only monitoring · NICK has no write access"
      width="2xl"
      rhythm="comfortable"
      actions={
        <div className="flex items-center gap-2">
          {/* v10.0.438 · sort dropdown · 5 modes within each ring */}
          <SortDropdown<RepoSort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="name"
            ariaLabel="Sort repos"
            options={[
              { value: "name", label: "name · A→Z" },
              { value: "live-first", label: "live first" },
              { value: "monitored-first", label: "monitored first" },
              { value: "fresh-commit", label: "commit · freshest" },
              { value: "stale-commit", label: "commit · stalest" },
            ]}
          />
          <FreshnessChip
            lastFetchedAt={lastFetched}
            source="api/system/repos"
            onReload={() => void load()}
          />
        </div>
      }
    >
      {error && !data && (
        <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
          <p className="p-3 text-[12px] text-rose-200">{error}</p>
        </Panel>
      )}

      {loading && !data && (
        <Panel>
          <p className="p-6 text-center text-[11px] text-zinc-500">
            Loading repos…
          </p>
        </Panel>
      )}

      {data && (
        <>
          {!data.liveDataAvailable && (
            <Panel className="border-amber-500/40 bg-amber-500/[0.04]">
              <p className="p-3 text-[11px] text-amber-200">
                <AlertTriangle size={12} className="inline mr-1" />
                <code>GITHUB_TOKEN</code> not configured · showing manifest-only
                data. Last-commit + age unavailable until the token lands in
                env.
              </p>
            </Panel>
          )}

          {/* v10 E.3 · Ecosystem briefing — Nick-readable narrative
              + week/month commit totals + flag list. Lives at the top
              so the operator sees "are we shipping?" before drilling
              into per-repo health. */}
          {digest && (
            <Panel>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                      ecosystem briefing · v10 E.3
                    </span>
                    {digest.flags.length > 0 && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-amber-200">
                        {digest.flags.length} flag
                        {digest.flags.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 text-[10px] tabular-nums text-zinc-400">
                    <span>
                      <span className="text-zinc-500">7d</span>{" "}
                      <span className="text-emerald-200">
                        {digest.totalCommitsLast7d}
                      </span>{" "}
                      commits
                    </span>
                    <span>
                      <span className="text-zinc-500">30d</span>{" "}
                      <span className="text-zinc-200">
                        {digest.totalCommitsLast30d}
                      </span>
                    </span>
                  </div>
                </div>
                <p className="text-[12px] leading-relaxed text-zinc-200">
                  {digest.narrative}
                </p>
                {digest.flags.length > 0 && (
                  <ul className="space-y-1 text-[11px]">
                    {digest.flags.map((f, i) => (
                      <li
                        key={i}
                        className={cn(
                          "flex items-start gap-1.5",
                          f.severity === "alert" && "text-rose-200",
                          f.severity === "warn" && "text-amber-200",
                          f.severity === "info" && "text-zinc-300",
                        )}
                      >
                        <span>•</span>
                        <span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {f.repo}
                          </span>{" "}
                          {f.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          )}

          {/* Summary row */}
          <Panel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 text-[11px]">
              <Cell label="total" value={data.summary.total} color="text-zinc-200" />
              <Cell label="active" value={data.summary.active} color="text-emerald-200" />
              <Cell label="monitored" value={data.summary.monitored} color="text-zinc-200" />
              <Cell label="archived" value={data.summary.archived} color="text-zinc-500" />
              <Cell label="green" value={data.summary.green} color="text-emerald-300" />
              <Cell
                label="yellow"
                value={data.summary.yellow}
                color={data.summary.yellow > 0 ? "text-amber-300" : "text-zinc-500"}
              />
              <Cell
                label="red"
                value={data.summary.red}
                color={data.summary.red > 0 ? "text-rose-300" : "text-zinc-500"}
              />
              <Cell label="gray" value={data.summary.gray} color="text-zinc-500" />
            </div>
          </Panel>

          {/* Grouped by ring */}
          {grouped
            .filter((g) => g.repos.length > 0)
            .map((g) => (
              <Panel key={g.ring}>
                <h2 className="mb-3 text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  {RING_LABEL[g.ring]} ({g.repos.length})
                </h2>
                <div className="divide-y divide-zinc-800/40">
                  {g.repos.map((r) => (
                    <RepoRow key={r.name} repo={r} />
                  ))}
                </div>
              </Panel>
            ))}

          <p className="text-center text-[10px] text-zinc-600">
            Generated {new Date(data.generatedAt).toLocaleString()} · v10 E.2 ·
            see <code>config/repos.ts</code> + <code>docs/REPO-MAP.md</code>
          </p>
        </>
      )}
    </StandardPage>
  );
}

function Cell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={cn("text-xl font-bold tabular-nums", color)}>
        {value}
      </div>
    </div>
  );
}

function RepoRow({ repo }: { repo: RepoPayload }) {
  return (
    <div
      className={cn(
        "py-2.5",
        repo.health === "gray" && "opacity-60",
        repo.health === "red" && "bg-rose-500/[0.03]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-2">
        <HealthIcon health={repo.health} />
        <span className="font-mono text-[12px] text-zinc-100">{repo.name}</span>
        <span className="rounded bg-zinc-500/10 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-zinc-300">
          {repo.tier}
        </span>
        <span className="rounded bg-zinc-500/10 px-1.5 py-[1px] text-[9px] uppercase tracking-wider text-zinc-400">
          {repo.host}
        </span>
        {repo.branch && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
            <GitBranch size={9} />
            {repo.branch}
          </span>
        )}
        {repo.live?.lastCommitAt && (
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-zinc-500">
            <Clock size={9} />
            {ageLabel(repo.lastCommitAgeHours)}
          </span>
        )}
        {repo.productionUrl && (
          <a
            href={repo.productionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[10px] text-emerald-300 hover:underline"
          >
            <ExternalLink size={9} /> live
          </a>
        )}
      </div>
      <div className="px-2 pt-1 text-[11px] text-zinc-300">{repo.purpose}</div>
      {repo.live?.lastCommitMessage && (
        <div className="px-2 pt-0.5 text-[10px] font-mono text-zinc-500">
          {repo.live.lastCommitSha}: {repo.live.lastCommitMessage}
        </div>
      )}
      {repo.nextAction && (
        <div className="mt-1.5 px-2 text-[10px] text-amber-200/90">
          → {repo.nextAction}
        </div>
      )}
      {repo.live?.fetchError && (
        <div className="mt-1 px-2 text-[10px] text-rose-300">
          fetch error: {repo.live.fetchError}
        </div>
      )}
    </div>
  );
}
