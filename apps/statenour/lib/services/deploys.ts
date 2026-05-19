/**
 * Deploys service · Phase KK (2026-05-18 PM).
 *
 * Single source of truth for the deploy-history readout + Vercel
 * rollback action. Called by BOTH the legacy REST handlers
 * (`app/api/system/deploys/route.ts` + `app/api/system/deploys/rollback/route.ts`)
 * AND the new `trpc.system.deploys` query + `trpc.system.rollbackDeploy`
 * mutation. Drift between consumers structurally impossible.
 *
 * GitHub side · pulls the N most recent commits on the deploy branch
 * + their per-commit stats (additions / deletions / files). Gracefully
 * returns empty when GITHUB_TOKEN is unset.
 *
 * Vercel side · lists the last 10 production deploys, identifies the
 * current READY + the next-most-recent READY, and promotes the previous
 * to production via the v9 promote endpoint. Throws typed errors so the
 * tRPC layer can translate cleanly.
 */

const DEPLOY_REPO = "nourdean22/statenour-os";
const DEPLOY_BRANCH = "codex/ollama-local";
const VERCEL_PROJECT_ID_DEFAULT = "prj_CFa6JVJblNXaS5bIOOoLwkxh7g72";

export class GithubTokenMissingError extends Error {
  constructor() {
    super("GITHUB_TOKEN env not set");
    this.name = "GithubTokenMissingError";
  }
}

export class VercelTokenMissingError extends Error {
  constructor() {
    super("VERCEL_TOKEN env not set — rollback unavailable");
    this.name = "VercelTokenMissingError";
  }
}

export class NoPreviousDeployError extends Error {
  constructor() {
    super("no previous READY deploy to roll back to");
    this.name = "NoPreviousDeployError";
  }
}

interface GhCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  html_url: string;
  author: { login: string; avatar_url: string } | null;
}

interface GhCommitDetail {
  sha: string;
  stats: { additions: number; deletions: number; total: number };
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  parents: Array<{ sha: string }>;
}

export interface ShapedCommit {
  sha: string;
  shortSha: string;
  subject: string;
  bodyPreview: string;
  bodyFull: string;
  author: string;
  date: string;
  url: string;
  stats: { additions: number; deletions: number; total: number } | null;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  parentSha: string | null;
}

export interface DeployCommitsView {
  configured: boolean;
  hint?: string;
  branch?: string;
  repo?: string;
  commits: ShapedCommit[];
}

export async function listDeployCommits(
  opts: { limit?: number } = {},
): Promise<DeployCommitsView> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 15));
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      configured: false,
      hint: "Set GITHUB_TOKEN env var to enable deploy history",
      commits: [],
    };
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "nour-os-deploys",
  };

  const listRes = await fetch(
    `https://api.github.com/repos/${DEPLOY_REPO}/commits?sha=${DEPLOY_BRANCH}&per_page=${limit}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!listRes.ok) {
    throw new Error(`GitHub commits list failed: ${listRes.status}`);
  }
  const commits = (await listRes.json()) as GhCommit[];

  const details = await Promise.all(
    commits.slice(0, limit).map(async (c) => {
      try {
        const detailRes = await fetch(
          `https://api.github.com/repos/${DEPLOY_REPO}/commits/${c.sha}`,
          { headers, signal: AbortSignal.timeout(10_000) },
        );
        if (!detailRes.ok) return null;
        return (await detailRes.json()) as GhCommitDetail;
      } catch {
        return null;
      }
    }),
  );

  const shaped: ShapedCommit[] = commits.map((c, i) => {
    const detail = details[i];
    const msg = c.commit.message;
    const [subject, ...rest] = msg.split("\n");
    const body = rest.join("\n").trim();
    return {
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      subject: subject.slice(0, 120),
      bodyPreview: body.slice(0, 600),
      bodyFull: body,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
      stats: detail?.stats || null,
      files: detail?.files?.slice(0, 30) || [],
      parentSha: detail?.parents?.[0]?.sha || null,
    };
  });

  return {
    configured: true,
    branch: DEPLOY_BRANCH,
    repo: DEPLOY_REPO,
    commits: shaped,
  };
}

interface VercelDeployment {
  uid: string;
  state: string;
  target?: string | null;
  created: number;
  meta?: { githubCommitSha?: string };
  url?: string;
}

async function vercelApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.VERCEL_TOKEN ?? "";
  const teamId = process.env.VERCEL_TEAM_ID ?? "";
  const sep = path.includes("?") ? "&" : "?";
  const teamSuffix = teamId ? `${sep}teamId=${teamId}` : "";
  const res = await fetch(`https://api.vercel.com${path}${teamSuffix}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vercel ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface RollbackResult {
  ok: true;
  demoted: { uid: string; sha: string | undefined; url: string | undefined };
  promoted: { uid: string; sha: string | undefined; url: string | undefined };
}

export async function rollbackProductionDeploy(): Promise<RollbackResult> {
  if (!process.env.VERCEL_TOKEN) {
    throw new VercelTokenMissingError();
  }
  const projectId = process.env.VERCEL_PROJECT_ID ?? VERCEL_PROJECT_ID_DEFAULT;

  const list = await vercelApi<{ deployments: VercelDeployment[] }>(
    `/v6/deployments?projectId=${projectId}&limit=10&target=production`,
  );
  const deploys = (list.deployments ?? []).filter((d) => d.state === "READY");
  if (deploys.length < 2) {
    throw new NoPreviousDeployError();
  }
  const [current, previous] = deploys;
  if (!previous?.uid) {
    throw new Error("rollback target missing uid");
  }

  await vercelApi<unknown>(
    `/v9/projects/${projectId}/promote/${previous.uid}`,
    { method: "POST" },
  );

  return {
    ok: true,
    demoted: {
      uid: current.uid,
      sha: current.meta?.githubCommitSha,
      url: current.url,
    },
    promoted: {
      uid: previous.uid,
      sha: previous.meta?.githubCommitSha,
      url: previous.url,
    },
  };
}
