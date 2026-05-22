/**
 * GitHub Integration — lets Nick AI read code, browse repos, and
 * manage issues / PRs via the GitHub REST API (GITHUB_TOKEN env var).
 *
 * 2026-05-21 · the write/deploy helpers (commitMultipleFiles,
 * createBranch, mergeBranch, deleteBranch, triggerVercelDeploy,
 * getDeploymentStatus) were removed — they were wired to the retired
 * `statenour-os` repo, the dead `codex/ollama-local` branch and
 * Vercel. statenour now deploys from the monorepo `main` via Railway;
 * there is no API deploy trigger, and an AI committing straight to
 * prod `main` would bypass the pre-push gates.
 */

const GITHUB_API = "https://api.github.com";
const OWNER = "nourdean22";

function getHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not configured");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...getHeaders(), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── READ OPERATIONS ────────────────────────────────

export async function listRepos(): Promise<Array<{ name: string; full_name: string; description: string | null; updated_at: string; language: string | null }>> {
  return ghFetch(`/users/${OWNER}/repos?sort=updated&per_page=10`);
}

export async function getFileContent(repo: string, path: string, branch?: string): Promise<{ content: string; sha: string }> {
  const ref = branch ? `?ref=${branch}` : "";
  const data = await ghFetch<{ content: string; sha: string; encoding: string }>(`/repos/${OWNER}/${repo}/contents/${path}${ref}`);
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

export async function listFiles(repo: string, path: string = "", branch?: string): Promise<Array<{ name: string; path: string; type: string; size: number }>> {
  const ref = branch ? `?ref=${branch}` : "";
  return ghFetch(`/repos/${OWNER}/${repo}/contents/${path}${ref}`);
}

export async function searchCode(repo: string, query: string): Promise<Array<{ path: string; matches: string[] }>> {
  const data = await ghFetch<{ items: Array<{ path: string; text_matches?: Array<{ fragment: string }> }> }>(
    `/search/code?q=${encodeURIComponent(query)}+repo:${OWNER}/${repo}`,
    { headers: { Accept: "application/vnd.github.text-match+json" } }
  );
  return data.items.map(i => ({
    path: i.path,
    matches: i.text_matches?.map(m => m.fragment) || [],
  }));
}

export async function getRecentCommits(repo: string, branch?: string, count: number = 5): Promise<Array<{ sha: string; message: string; date: string; author: string }>> {
  const ref = branch ? `?sha=${branch}&per_page=${count}` : `?per_page=${count}`;
  const data = await ghFetch<Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }>>(`/repos/${OWNER}/${repo}/commits${ref}`);
  return data.map(c => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    date: c.commit.author.date,
    author: c.commit.author.name,
  }));
}

// ─── WRITE OPERATIONS ───────────────────────────────

export async function createPullRequest(
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string = "main",
): Promise<{ number: number; url: string }> {
  const data = await ghFetch<{ number: number; html_url: string }>(`/repos/${OWNER}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, body, head, base }),
  });
  return { number: data.number, url: data.html_url };
}

export async function createIssue(
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<{ number: number; url: string }> {
  const data = await ghFetch<{ number: number; html_url: string }>(`/repos/${OWNER}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels }),
  });
  return { number: data.number, url: data.html_url };
}

export async function listOpenPRs(repo: string): Promise<Array<{ number: number; title: string; author: string; created_at: string }>> {
  const data = await ghFetch<Array<{ number: number; title: string; user: { login: string }; created_at: string }>>(`/repos/${OWNER}/${repo}/pulls?state=open&per_page=10`);
  return data.map(pr => ({ number: pr.number, title: pr.title, author: pr.user.login, created_at: pr.created_at }));
}

export async function listOpenIssues(repo: string): Promise<Array<{ number: number; title: string; labels: string[]; created_at: string }>> {
  const data = await ghFetch<Array<{ number: number; title: string; labels: Array<{ name: string }>; created_at: string }>>(`/repos/${OWNER}/${repo}/issues?state=open&per_page=10`);
  return data.map(i => ({ number: i.number, title: i.title, labels: i.labels.map(l => l.name), created_at: i.created_at }));
}

// ─── FILE DIFF ─────────────────────────────────────

export async function getFileDiff(repo: string, path: string, branch?: string): Promise<string> {
  try {
    const { content } = await getFileContent(repo, path, branch);
    return content;
  } catch {
    return ""; // File doesn't exist
  }
}

// ─── BULK FILE READER ──────────────────────────────
// Read multiple files in parallel for full feature context

export async function readMultipleFiles(
  repo: string,
  paths: string[],
  branch?: string
): Promise<Array<{ path: string; content: string; error?: string }>> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const { content } = await getFileContent(repo, path, branch);
        return { path, content };
      } catch (e) {
        return { path, content: "", error: e instanceof Error ? e.message : "not found" };
      }
    })
  );
}

// ─── REPO CONSTANTS ────────────────────────────────

export const REPO_CONFIG = {
  statenour: {
    name: "MAINnicks-tire-autoNEW",
    branch: "main",
    stack: "Next.js 16, TypeScript, Prisma, Neon PostgreSQL, Tailwind 4",
    keyPaths: {
      tools: "apps/statenour/lib/ai/tools/",
      systemPrompt: "apps/statenour/lib/ai/system-prompt.ts",
      provider: "apps/statenour/lib/ai/provider.ts",
      schema: "apps/statenour/prisma/schema.prisma",
      brain: "apps/statenour/lib/brain/",
      services: "apps/statenour/lib/services/",
      api: "apps/statenour/app/api/",
      pages: "apps/statenour/app/(mastery)/",
    },
  },
  nickstire: {
    name: "MAINnicks-tire-autoNEW",
    branch: "main",
    stack: "Express 4, tRPC 11, React 19, Vite, Drizzle ORM, TiDB MySQL",
    keyPaths: {
      routers: "server/routers.ts",
      bridge: "server/nour-os-bridge.ts",
      chatTools: "server/services/chatTools.ts",
      cron: "server/cron/",
      llm: "server/_core/llm.ts",
      admin: "client/src/pages/admin/",
      intelligence: "client/src/pages/admin/intelligence/",
      schema: "drizzle/schema.ts",
      shared: "client/src/pages/admin/shared.tsx",
    },
  },
} as const;
