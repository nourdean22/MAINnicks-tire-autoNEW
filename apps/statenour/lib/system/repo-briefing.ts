/**
 * Repo ecosystem briefings · v10 Track E.3 · Apr 30.
 *
 * Composes the cross-repo health snapshot (config/repos.ts +
 * GitHub API) into a Nick-readable digest:
 *
 *   "STATE NOUR shipped 12 commits this week. Nick's Tire repo
 *    deployed clean. Cron worker stayed healthy. Social engine
 *    hasn't posted in 2 days — flag."
 *
 * Two surfaces use this:
 *   1. /system/repos dashboard renders the digest at the top.
 *   2. Weekly-review + chat tools call getEcosystemDigest() to
 *      paste into the WHY block / weekly summary.
 *
 * Best-effort: if GITHUB_TOKEN is missing, returns a structural
 * digest based on manifest data only (no commit counts).
 */

import { REPOS, type RepoEntry } from "@/config/repos";

export interface RepoActivity {
  repo: RepoEntry;
  commitsLast7d: number | null;
  commitsLast30d: number | null;
  lastCommitAt: string | null;
  lastCommitMessage: string | null;
  lastCommitSha: string | null;
  /** True when GitHub's per_page=100 cap was hit — counts are a floor, not exact. */
  commitsCapHit: boolean;
  flagReasons: string[];
}

export interface EcosystemDigest {
  generatedAt: string;
  liveDataAvailable: boolean;
  totalCommitsLast7d: number;
  totalCommitsLast30d: number;
  repos: RepoActivity[];
  flags: Array<{
    repo: string;
    reason: string;
    severity: "info" | "warn" | "alert";
  }>;
  /** One-paragraph narrative for system-prompt injection / chat / weekly review */
  narrative: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

interface CommitListItem {
  sha?: string;
  commit?: {
    message?: string;
    committer?: { date?: string };
    author?: { date?: string };
  };
}

/**
 * Pull recent commits for one repo. Returns counts in two windows
 * + the most-recent commit's metadata. Best-effort.
 *
 * v10.0.15 hardening:
 *   · 8s AbortController so a slow GitHub never blocks the route.
 *   · `commitsCapHit` flag when the response returned exactly 100
 *     commits (the per_page max). The narrative + UI can warn the
 *     operator that the count is a floor, not the real number.
 */
async function fetchRepoActivity(
  repo: RepoEntry,
  token: string,
): Promise<{
  commitsLast7d: number | null;
  commitsLast30d: number | null;
  lastCommitAt: string | null;
  lastCommitMessage: string | null;
  lastCommitSha: string | null;
  fetchError: string | null;
  commitsCapHit: boolean;
}> {
  const empty = {
    commitsLast7d: null,
    commitsLast30d: null,
    lastCommitAt: null,
    lastCommitMessage: null,
    lastCommitSha: null,
    commitsCapHit: false,
  };
  if (!repo.fullName) {
    return { ...empty, fetchError: "no fullName" };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const url = `https://api.github.com/repos/${repo.fullName}/commits?since=${since}&per_page=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 300 },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        ...empty,
        fetchError: `${res.status} ${res.statusText}`,
      };
    }
    const commits = (await res.json()) as CommitListItem[];
    const now = Date.now();
    let last7 = 0;
    let last30 = 0;
    for (const c of commits) {
      const iso = c.commit?.committer?.date ?? c.commit?.author?.date;
      if (!iso) continue;
      const age = now - new Date(iso).getTime();
      if (age <= THIRTY_DAYS_MS) last30 += 1;
      if (age <= SEVEN_DAYS_MS) last7 += 1;
    }
    const head = commits[0];
    return {
      commitsLast7d: last7,
      commitsLast30d: last30,
      lastCommitAt:
        head?.commit?.committer?.date ?? head?.commit?.author?.date ?? null,
      lastCommitMessage:
        head?.commit?.message?.split("\n")[0]?.slice(0, 80) ?? null,
      lastCommitSha: head?.sha?.slice(0, 7) ?? null,
      fetchError: null,
      // GitHub's per_page max for /commits is 100. If we hit it, the
      // 30d count is a floor (real count >= 100). Flag for narrative.
      commitsCapHit: commits.length === 100,
    };
  } catch (err) {
    return {
      ...empty,
      fetchError: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

function computeFlags(activity: RepoActivity): RepoActivity["flagReasons"] {
  const flags: string[] = [];
  if (activity.repo.status === "stale") {
    flags.push("manifest marked stale — review and re-classify");
  }
  if (
    activity.repo.status === "active" &&
    activity.lastCommitAt != null
  ) {
    const ageDays =
      (Date.now() - new Date(activity.lastCommitAt).getTime()) /
      (24 * 3600 * 1000);
    if (ageDays > 30) {
      flags.push(
        `${Math.round(ageDays)}d since last commit — active repo going dormant`,
      );
    } else if (ageDays > 7 && activity.repo.tier === "core") {
      flags.push(
        `${Math.round(ageDays)}d since last commit — core repo idle`,
      );
    }
  }
  if (
    activity.repo.status === "active" &&
    activity.commitsLast7d === 0 &&
    activity.repo.tier === "core"
  ) {
    flags.push("zero commits this week — core repo stalled");
  }
  if (activity.commitsCapHit) {
    flags.push(
      "30d commit count capped at 100 — real number higher (paginate to confirm)",
    );
  }
  return flags;
}

function buildNarrative(repos: RepoActivity[]): string {
  const personal = repos.filter((r) => r.repo.ring === "personal");
  const business = repos.filter((r) => r.repo.ring === "business");
  const desktop = repos.filter((r) => r.repo.ring === "desktop");

  const parts: string[] = [];

  // Personal ring
  for (const r of personal) {
    if (r.repo.status !== "active") continue;
    const c = r.commitsLast7d;
    if (c == null) continue;
    if (c === 0) {
      parts.push(`${r.repo.name} idle this week`);
    } else if (c < 3) {
      parts.push(`${r.repo.name} shipped ${c} commit${c !== 1 ? "s" : ""} this week`);
    } else {
      parts.push(`${r.repo.name} shipped ${c} commits this week`);
    }
  }

  // Business ring digest — collapse if all healthy
  const businessActive = business.filter((r) => r.repo.status === "active");
  const businessFlagged = businessActive.filter(
    (r) => r.flagReasons.length > 0,
  );
  if (businessActive.length > 0) {
    if (businessFlagged.length === 0) {
      parts.push(`business ring (${businessActive.length} repos) healthy`);
    } else {
      const names = businessFlagged
        .map((r) => `${r.repo.name} (${r.flagReasons[0]})`)
        .join(", ");
      parts.push(`business ring flag: ${names}`);
    }
  }

  // Desktop ring
  for (const r of desktop) {
    if (r.repo.status !== "active") continue;
    if (r.flagReasons.length > 0) {
      parts.push(`${r.repo.name}: ${r.flagReasons[0]}`);
    }
  }

  if (parts.length === 0) {
    return "No activity to report. (live data unavailable or no monitored repos.)";
  }

  // Capitalize first letter, end with period
  const joined = parts.join(". ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

/**
 * Compose the full ecosystem digest. Requires GITHUB_TOKEN for
 * commit-window data; degrades gracefully without it.
 */
export async function getEcosystemDigest(): Promise<EcosystemDigest> {
  const token = process.env.GITHUB_TOKEN;
  const monitored = REPOS.filter((r) => r.monitored && r.fullName);

  let totals7 = 0;
  let totals30 = 0;
  const reposActivity: RepoActivity[] = [];

  if (token) {
    // Concurrent best-effort
    const enriched = await Promise.all(
      monitored.map(async (repo) => {
        const live = await fetchRepoActivity(repo, token);
        const activity: RepoActivity = {
          repo,
          commitsLast7d: live.commitsLast7d,
          commitsLast30d: live.commitsLast30d,
          lastCommitAt: live.lastCommitAt,
          lastCommitMessage: live.lastCommitMessage,
          lastCommitSha: live.lastCommitSha,
          commitsCapHit: live.commitsCapHit,
          flagReasons: [],
        };
        activity.flagReasons = computeFlags(activity);
        if (activity.commitsLast7d != null) totals7 += activity.commitsLast7d;
        if (activity.commitsLast30d != null)
          totals30 += activity.commitsLast30d;
        return activity;
      }),
    );
    reposActivity.push(...enriched);
  } else {
    // No token — manifest-only digest
    for (const repo of monitored) {
      const activity: RepoActivity = {
        repo,
        commitsLast7d: null,
        commitsLast30d: null,
        lastCommitAt: null,
        lastCommitMessage: null,
        lastCommitSha: null,
        commitsCapHit: false,
        flagReasons: [],
      };
      activity.flagReasons = computeFlags(activity);
      reposActivity.push(activity);
    }
  }

  const flags: EcosystemDigest["flags"] = [];
  for (const r of reposActivity) {
    for (const reason of r.flagReasons) {
      const sev: "info" | "warn" | "alert" =
        reason.includes("stalled") || reason.includes("going dormant")
          ? "warn"
          : reason.includes("stale")
            ? "warn"
            : "info";
      flags.push({ repo: r.repo.name, reason, severity: sev });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    liveDataAvailable: !!token,
    totalCommitsLast7d: totals7,
    totalCommitsLast30d: totals30,
    repos: reposActivity,
    flags,
    narrative: buildNarrative(reposActivity),
  };
}
