/**
 * GitHub Integration — lets Nick AI read/write code, create PRs, manage issues.
 * Uses GitHub REST API with a Personal Access Token.
 * Set GITHUB_TOKEN env var on Vercel.
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

export async function createOrUpdateFile(
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
): Promise<{ sha: string; url: string }> {
  // Check if file exists to get SHA for update
  let sha: string | undefined;
  try {
    const existing = await getFileContent(repo, path, branch);
    sha = existing.sha;
  } catch {
    // File doesn't exist — creating new
  }

  const encoded = Buffer.from(content).toString("base64");
  const body: Record<string, unknown> = { message, content: encoded };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const data = await ghFetch<{ content: { sha: string; html_url: string } }>(`/repos/${OWNER}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return { sha: data.content.sha, url: data.content.html_url };
}

export async function createBranch(repo: string, branchName: string, fromBranch: string = "main"): Promise<{ ref: string }> {
  // Get the SHA of the source branch
  const data = await ghFetch<{ object: { sha: string } }>(`/repos/${OWNER}/${repo}/git/ref/heads/${fromBranch}`);
  return ghFetch(`/repos/${OWNER}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: data.object.sha }),
  });
}

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

// ─── MULTI-FILE COMMIT ─────────────────────────────
// Creates a single commit with multiple file changes (like a real git commit)

export async function commitMultipleFiles(
  repo: string,
  files: { path: string; content: string }[],
  message: string,
  branch: string = "codex/ollama-local"
): Promise<{ sha: string; url: string }> {
  // 1. Get the latest commit SHA for the branch
  const refData = await ghFetch<{ object: { sha: string } }>(
    `/repos/${OWNER}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const latestCommitSha = refData.object.sha;

  // 2. Get the tree SHA from the latest commit
  const commitData = await ghFetch<{ tree: { sha: string } }>(
    `/repos/${OWNER}/${repo}/git/commits/${latestCommitSha}`
  );
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for each file
  const treeEntries = await Promise.all(
    files.map(async (file) => {
      const blobData = await ghFetch<{ sha: string }>(
        `/repos/${OWNER}/${repo}/git/blobs`,
        {
          method: "POST",
          body: JSON.stringify({
            content: Buffer.from(file.content).toString("base64"),
            encoding: "base64",
          }),
        }
      );
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blobData.sha,
      };
    })
  );

  // 4. Create a new tree with all file changes
  const treeData = await ghFetch<{ sha: string }>(
    `/repos/${OWNER}/${repo}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    }
  );

  // 5. Create the commit
  const newCommit = await ghFetch<{ sha: string; html_url: string }>(
    `/repos/${OWNER}/${repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `${message}\n\nCo-Authored-By: Nick AI <nick@bdnick.info>`,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    }
  );

  // 6. Update the branch ref to point to the new commit
  await ghFetch(
    `/repos/${OWNER}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha }),
    }
  );

  return { sha: newCommit.sha, url: newCommit.html_url };
}

// ─── DEPLOY TRIGGER ────────────────────────────────

export async function triggerVercelDeploy(repo: string): Promise<{ status: string }> {
  // Vercel auto-deploys on push. The multi-file commit above triggers it.
  // This function creates an empty commit to force a redeploy if needed.
  const branch = repo === "statenour-os" ? "codex/ollama-local" : "main";
  const { sha } = await commitMultipleFiles(
    repo,
    [], // No file changes — just a deploy trigger
    "chore: trigger deployment",
    branch
  ).catch(() => ({ sha: "" }));

  return { status: sha ? "deploy_triggered" : "failed" };
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

// ─── DEPLOY STATUS (Vercel API) ────────────────────

export async function getDeploymentStatus(): Promise<{
  status: string;
  url: string;
  createdAt: string;
  buildDuration: number;
  error?: string;
}> {
  // Use Vercel API if token available, otherwise check via GitHub
  const vercelToken = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (vercelToken && projectId) {
    try {
      const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        const deploy = data.deployments?.[0];
        if (deploy) {
          return {
            status: deploy.state ?? deploy.readyState ?? "unknown",
            url: deploy.url ? `https://${deploy.url}` : "",
            createdAt: deploy.created ? new Date(deploy.created).toISOString() : "",
            buildDuration: deploy.buildingAt && deploy.ready
              ? Math.round((deploy.ready - deploy.buildingAt) / 1000)
              : 0,
            error: deploy.state === "ERROR" ? "Build failed" : undefined,
          };
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: check latest commit status via GitHub
  try {
    const commits = await getRecentCommits("statenour-os", "codex/ollama-local", 1);
    return {
      status: "unknown (no Vercel token — check dashboard)",
      url: "https://bdnick.info",
      createdAt: commits[0]?.date ?? "",
      buildDuration: 0,
    };
  } catch {
    return { status: "unknown", url: "", createdAt: "", buildDuration: 0 };
  }
}

// ─── MERGE BRANCH ──────────────────────────────────

export async function mergeBranch(
  repo: string,
  head: string,
  base: string,
  commitMessage?: string
): Promise<{ sha: string; merged: boolean }> {
  try {
    const data = await ghFetch<{ sha: string }>(`/repos/${OWNER}/${repo}/merges`, {
      method: "POST",
      body: JSON.stringify({
        base,
        head,
        commit_message: commitMessage ?? `Merge ${head} into ${base}`,
      }),
    });
    return { sha: data.sha, merged: true };
  } catch (e) {
    return { sha: "", merged: false };
  }
}

// ─── DELETE BRANCH ─────────────────────────────────

export async function deleteBranch(repo: string, branch: string): Promise<boolean> {
  try {
    await ghFetch(`/repos/${OWNER}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "DELETE",
    });
    return true;
  } catch {
    return false;
  }
}

// ─── REPO CONSTANTS ────────────────────────────────

export const REPO_CONFIG = {
  statenour: {
    name: "statenour-os",
    branch: "codex/ollama-local",
    stack: "Next.js 16, TypeScript, Prisma, Neon PostgreSQL, Tailwind 4",
    keyPaths: {
      tools: "lib/ai/tools.ts",
      systemPrompt: "lib/ai/system-prompt.ts",
      provider: "lib/ai/provider.ts",
      schema: "prisma/schema.prisma",
      brain: "lib/brain/",
      services: "lib/services/",
      api: "app/api/",
      pages: "app/(mastery)/",
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
