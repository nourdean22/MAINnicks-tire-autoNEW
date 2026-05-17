/**
 * GET /api/system/repos · v10 Track E.2 · Apr 30.
 *
 * Reads the `config/repos.ts` manifest and (when GITHUB_TOKEN is
 * configured) augments each monitored repo with live state from
 * GitHub: last commit SHA + age, last push timestamp, default branch
 * status. Returns a single payload the /system/repos dashboard can
 * render directly.
 *
 * Without GITHUB_TOKEN, falls back to manifest-only data — every
 * repo still renders, just without "last commit Xh ago" detail.
 *
 * Owner-gated per v9.1.14 sensitive-GET requirement.
 *
 * Cost note: each monitored repo = 1 GitHub API call. 6 monitored
 * repos = 6 calls per page load. GitHub authenticated rate limit is
 * 5000/hour, so this is well within budget. Cached for 60s by the
 * apiHandler envelope so repeat dashboard loads don't burn quota.
 */

import { apiHandler } from "@/lib/utils/http";
import { REPOS, type RepoEntry } from "@/config/repos";
import { cached } from "@/lib/utils/cache";

interface LiveRepoData {
  name: string;
  lastCommitSha: string | null;
  lastCommitMessage: string | null;
  lastCommitAt: string | null;
  defaultBranch: string | null;
  fetchOk: boolean;
  fetchError: string | null;
}

interface RepoPayload extends RepoEntry {
  live: LiveRepoData | null;
  health: "green" | "yellow" | "red" | "gray";
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

/**
 * Pull live state from GitHub for one repo. Best-effort — any error
 * resolves to fetchOk=false with the error message.
 */
async function fetchGithubState(
  fullName: string,
  token: string,
): Promise<LiveRepoData> {
  const base: LiveRepoData = {
    name: fullName,
    lastCommitSha: null,
    lastCommitMessage: null,
    lastCommitAt: null,
    defaultBranch: null,
    fetchOk: false,
    fetchError: null,
  };
  try {
    // 1. Repo metadata (default branch + push time)
    const repoRes = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 60 },
    });
    if (!repoRes.ok) {
      base.fetchError = `${repoRes.status} ${repoRes.statusText}`;
      return base;
    }
    const repoJson = (await repoRes.json()) as {
      default_branch?: string;
      pushed_at?: string;
    };
    base.defaultBranch = repoJson.default_branch ?? null;

    // 2. Latest commit on default branch
    if (repoJson.default_branch) {
      const commitRes = await fetch(
        `https://api.github.com/repos/${fullName}/commits/${repoJson.default_branch}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          next: { revalidate: 60 },
        },
      );
      if (commitRes.ok) {
        const commitJson = (await commitRes.json()) as {
          sha?: string;
          commit?: { message?: string; committer?: { date?: string } };
        };
        base.lastCommitSha = commitJson.sha?.slice(0, 7) ?? null;
        base.lastCommitMessage =
          commitJson.commit?.message?.split("\n")[0]?.slice(0, 80) ?? null;
        base.lastCommitAt = commitJson.commit?.committer?.date ?? null;
        base.fetchOk = true;
      } else {
        base.fetchError = `commit fetch ${commitRes.status}`;
      }
    } else {
      base.fetchError = "no default branch";
    }
  } catch (err) {
    base.fetchError = err instanceof Error ? err.message : String(err);
  }
  return base;
}

/**
 * Compute the health color for a repo given manifest state + live
 * GitHub state.
 *
 *   green  · active, monitored, recent commit (within 30d)
 *   yellow · active but stale (no commit in 30d), or live fetch failed
 *   red    · status=stale (manifest declared) — operator review needed
 *   gray   · archived / dead
 */
function computeHealth(
  repo: RepoEntry,
  live: LiveRepoData | null,
  ageHours: number | null,
): "green" | "yellow" | "red" | "gray" {
  if (repo.status === "archived" || repo.status === "dead") return "gray";
  if (repo.status === "stale") return "red";
  // Active repos: stale if no commit in 30 days OR fetch failed
  if (live && !live.fetchOk) return "yellow";
  if (ageHours != null && ageHours > 30 * 24) return "yellow";
  return "green";
}

export const GET = apiHandler(
  async () => {
    const token = process.env.GITHUB_TOKEN;
    const liveDataAvailable = !!token;

    // Cache for 60s — dashboards reload often, GitHub rate-limit
    // is 5000/hr authenticated. 6 monitored repos × 2 calls each ×
    // (3600s / 60s) = 720 calls/hr — well under cap.
    const repos = await cached(
      "system_repos_live",
      60,
      async (): Promise<RepoPayload[]> => {
        const enriched = await Promise.all(
          REPOS.map(async (repo) => {
            let live: LiveRepoData | null = null;
            if (token && repo.monitored && repo.fullName) {
              live = await fetchGithubState(repo.fullName, token);
            }

            const ageHours =
              live?.lastCommitAt != null
                ? Math.round(
                    (Date.now() - new Date(live.lastCommitAt).getTime()) /
                      3_600_000,
                  )
                : null;

            const health = computeHealth(repo, live, ageHours);

            return {
              ...repo,
              live,
              health,
              lastCommitAgeHours: ageHours,
            };
          }),
        );
        return enriched;
      },
    );

    const summary = {
      total: repos.length,
      active: repos.filter((r) => r.status === "active").length,
      monitored: repos.filter((r) => r.monitored).length,
      archived: repos.filter(
        (r) => r.status === "archived" || r.status === "dead",
      ).length,
      green: repos.filter((r) => r.health === "green").length,
      yellow: repos.filter((r) => r.health === "yellow").length,
      red: repos.filter((r) => r.health === "red").length,
      gray: repos.filter((r) => r.health === "gray").length,
    };

    const response: ReposResponse = {
      generatedAt: new Date().toISOString(),
      liveDataAvailable,
      repos,
      summary,
    };

    return response;
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate
);
