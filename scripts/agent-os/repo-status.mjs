#!/usr/bin/env node
/**
 * repo:status — one screen: every local worktree's branch, dirty/unpushed state,
 * whether it exists on origin, its PR/classification, and its lease (2026-09-23).
 *
 * TWO INDEPENDENT DATA SOURCES, reported side by side, never conflated:
 *  - LOCAL (`git worktree list --porcelain` on THIS machine) — inherently
 *    machine-scoped. A run here shows only this container's one checkout, never
 *    the Windows bridge's worktrees, and vice versa. Said explicitly in the output,
 *    not implied as complete.
 *  - REMOTE (GitHub: branch existence, PR/merge state via classify-branch.mjs,
 *    lease state via lease.mjs) — reachable from anywhere.
 *
 * WORKTREE SWEEP (job 2026-10-17-worktree-sweep) lives here because this is the one script that already reads every
 * local worktree; the remover is the existing scripts/worktree-teardown.ps1, never a second one. Dry run by default:
 *   node scripts/agent-os/repo-status.mjs --sweep             # class + reason per worktree, counts per class
 *   node scripts/agent-os/repo-status.mjs --sweep --execute   # tear down LANDED only
 * merge-gate.mjs calls sweepAfterMerge() for the worktree(s) holding a head it just merged. Canary: worktreeSweep.test.mjs.
 *
 * Usage:
 *   node scripts/agent-os/repo-status.mjs             # local worktrees + their remote state
 *   node scripts/agent-os/repo-status.mjs --all-branches  # + every branch on origin
 *
 * BUDGET (2026-11-03): the heartbeat kills this check at 60-120 s, and the serial run took 3-4 min over 87 worktrees,
 * so it printed nothing. Rows now run 16 at a time (at most 6 git children) inside BUDGET_MS; every git child and GitHub read is cut at
 * SPAWN_TIMEOUT_MS; a cell that did not answer reads UNKNOWN (timeout) or UNKNOWN (error: ...), never "no" or "-";
 * the last line is a receipt with both counts. Canary: repoStatusBudget.test.mjs.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureProxyEnv, ghJson, ghPaginate } from "./github-client.mjs";
import { createGitHubLeaseStore, readLease, isExpired } from "./lease.mjs";
import { classifyBranch } from "./classify-branch.mjs";
import { flag, originOwnerRepo, ownerRepoFromUrl, isMainModule } from "./cli-common.mjs";
import { readLocalMarker } from "./local-lease-marker.mjs";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

export const BUDGET_MS = 25_000; // whole default run; under the heartbeat's shortest limit with room to print
export const SPAWN_TIMEOUT_MS = 5_000; // one git child or one GitHub read (git status here measured ~80 ms)
const ROW_CONCURRENCY = 16;
const GIT_CONCURRENCY = 6;
const TIMEOUT_CELL = "UNKNOWN (timeout)";

/** The tree-kill's platform and process call, properties so a canary can fake them off Windows (repoStatusBudget). */
export const killDeps = { platform: process.platform, spawn };

/**
 * Kill a child, and on Windows its whole tree: `git` there is the Git\cmd wrapper, and killing it alone left the real
 * git.exe and its conhost running (manager round 1). Never blocks: the budget's abort runs every listener synchronously,
 * and six blocking taskkills in a row held the answer for about 30 s (Codex, PR 3543). child.kill() is the fallback.
 */
function killTree(child) {
  if (killDeps.platform !== "win32" || !child.pid) return void child.kill();
  let k;
  try {
    k = killDeps.spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    return void child.kill();
  }
  k.on("error", () => child.kill());
  k.on("exit", (code) => { if (code !== 0) child.kill(); });
}

/** The run budget: a signal that aborts after `ms`, and stop() to clear its timer once the work is done. */
export function budgetSignal(ms) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), ms);
  return { signal: deadline.signal, stop: () => clearTimeout(timer) };
}

/**
 * Run one child without a shell. Resolves trimmed stdout on exit 0; rejects on a non-zero exit or a spawn error, and
 * with error.timedOut after timeoutMs or when `signal` aborts. On a timeout the child is killed and its pipes dropped,
 * so a grandchild that inherited a pipe (git's fsmonitor hook, a credential helper) cannot hold the caller.
 */
export function runBounded(cmd, args, { cwd, env, timeoutMs = SPAWN_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    const timedOut = (why) => Object.assign(new Error(`${why}: ${cmd} ${args.join(" ")}`), { timedOut: true });
    if (signal?.aborted) return reject(timedOut("run budget spent"));
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const stop = (why) => {
      settle();
      killTree(child);
      child.stdout.destroy();
      child.stderr.destroy();
      reject(timedOut(why));
    };
    const timer = setTimeout(() => stop(`timeout after ${timeoutMs} ms`), timeoutMs);
    const onAbort = () => stop("run budget spent");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => (settle(), reject(e)));
    child.on("close", (code) => {
      settle();
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim().split("\n")[0] || `${cmd} exited ${code}`));
    });
  });
}

/** Parse `git worktree list --porcelain` into [{path, branch, headSha, detached, locked}]. */
export function parseWorktreePorcelain(text) {
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const entry = { path: null, headSha: null, branch: null, detached: false, bare: false, locked: false };
    for (const line of lines) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) entry.headSha = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) entry.branch = line.slice("branch refs/heads/".length);
      else if (line === "detached") entry.detached = true;
      else if (line === "bare") entry.bare = true;
      // The Claude harness locks a live agent's worktree ("locked claude agent agent-x (pid N)").
      else if (line === "locked" || line.startsWith("locked ")) entry.locked = line.slice("locked".length).trim() || true;
    }
    return entry;
  });
}

// ---------------------------------------------------------------- worktree sweep ---

export const WORKTREE_CLASSES = Object.freeze({
  LANDED: "LANDED",
  OPEN_PR: "OPEN_PR",
  NO_PR: "NO_PR",
  DIRTY: "DIRTY",
  ACTIVE: "ACTIVE",
  DETACHED_UNKNOWN: "DETACHED_UNKNOWN",
  SESSION: "SESSION",
  UNKNOWN: "UNKNOWN",
});
const K = WORKTREE_CLASSES;
const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
const SWEPT_DIRS = [".claude/worktrees/", ".worktrees/"];
// agent-finish.mjs, run by the teardown, intermittently dies on Windows with a libuv assertion after its GitHub call
// and prints a false REFUSED; it has never crashed twice in a row (memory branch-triage-2026-10-15).
const LIBUV_CRASH = /Assertion failed|libuv|UV_HANDLE/i;
const short = (sha) => String(sha ?? "").slice(0, 7);
const firstLine = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0];
const norm = (p) => {
  const r = resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};

const defaultGit = (args, cwd) =>
  execFileSync("git", args, { cwd, env: stripGitLocalEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 << 20, timeout: SPAWN_TIMEOUT_MS }).trim();

/** Real dependencies. Every one is lazy and throws on failure; the classifier turns a throw into UNKNOWN. */
export function defaultSweepDeps(cwd) {
  const ghEnv = { ...stripGitLocalEnv() };
  delete ghEnv.GITHUB_TOKEN; // a dummy token in the env overrides gh's keyring login (AGENTS.md > Branching)
  delete ghEnv.GH_TOKEN;
  return {
    git: defaultGit,
    gh: (args) => execFileSync("gh", args, { cwd, env: ghEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }),
    readLease: (branch) => {
      const { owner, repo } = originOwnerRepo(cwd);
      return readLease(branch, { store: createGitHubLeaseStore(owner, repo) });
    },
    teardown: (path, primary) => {
      const script = fileURLToPath(new URL("../worktree-teardown.ps1", import.meta.url));
      const shell = process.platform === "win32" ? "powershell" : "pwsh";
      const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-targetDir", path, "-ForceDirtyRelease"];
      const r = spawnSync(shell, args, { cwd: primary, env: stripGitLocalEnv(), encoding: "utf8", timeout: 10 * 60_000 });
      return { status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
    },
    now: Date.now,
  };
}

/** The newest tracked or untracked (not ignored) file, or the branch reflog, modified after `since`; else null. */
function recentChange(path, git, since) {
  const gitDir = git(["rev-parse", "--absolute-git-dir"], path);
  const reflog = statSync(join(gitDir, "logs", "HEAD"), { throwIfNoEntry: false });
  if (reflog && reflog.mtimeMs >= since) return { file: "the branch reflog (a commit or checkout)", mtimeMs: reflog.mtimeMs };
  for (const file of git(["ls-files", "-z", "-co", "--exclude-standard"], path).split("\0")) {
    if (!file) continue;
    const st = statSync(join(path, file), { throwIfNoEntry: false });
    if (st && st.mtimeMs >= since) return { file, mtimeMs: st.mtimeMs };
  }
  return null;
}

/**
 * One worktree -> {cls, reason}. Only LANDED is ever removable, and LANDED needs ALL of: not a Desktop session
 * worktree, not the caller's worktree, not locked, every local read succeeded, nothing modified in 2 h, no live lease (local marker or GitHub), a clean tree, a
 * branch, and a MERGED PR whose head is HEAD or whose commit list holds HEAD. Squash merges make cherry and ahead-counts
 * lie, so neither is consulted. Any failed read is UNKNOWN, never LANDED.
 */
export async function classifyWorktree(wt, { git, gh, readLease: leaseOf, now, self, primary }) {
  // Checked before any read. A Claude Desktop session's worktree (a direct child of .claude/worktrees not named agent-*,
  // e.g. musing-ramanujan-25e4e3) has no harness lock and commits on PR branches in its own cwd, so an idle session whose
  // PR merged would otherwise read LANDED and lose its working directory (manager review 2026-10-17). Agent worktrees
  // and anything under a .worktrees/ (nested ones too) stay eligible.
  if (!primary) return { cls: K.UNKNOWN, reason: "no primary checkout to place this worktree against" };
  const desktop = norm(wt.path).slice(norm(primary).length + 1).match(/^\.claude\/worktrees\/([^/]+)$/);
  if (desktop && !desktop[1].startsWith("agent-")) return { cls: K.SESSION, reason: "Claude Desktop session worktree; the app's archive removes it" };
  if (self && norm(wt.path) === self) return { cls: K.ACTIVE, reason: "the caller's own worktree" };
  if (wt.locked) return { cls: K.ACTIVE, reason: `locked${typeof wt.locked === "string" ? `: ${wt.locked}` : ""}` };
  let recent, marker, status;
  try {
    if (!existsSync(wt.path)) return { cls: K.UNKNOWN, reason: "directory missing (stale registration; git worktree prune clears it)" };
    recent = recentChange(wt.path, git, now() - ACTIVE_WINDOW_MS);
    marker = readLocalMarker(wt.path);
    status = git(["--no-optional-locks", "status", "--porcelain"], wt.path); // no index refresh, so the sweep never makes a worktree look modified
  } catch (e) {
    return { cls: K.UNKNOWN, reason: `local read failed: ${firstLine(e)}` };
  }
  if (recent) return { cls: K.ACTIVE, reason: `${recent.file} modified ${Math.max(0, Math.round((now() - recent.mtimeMs) / 60_000))} min ago` };
  if (marker && !isExpired(marker)) return { cls: K.ACTIVE, reason: `local lease marker: session ${marker.sessionId} until ${marker.expiresAt}` };
  if (status) {
    // Not slice(3): defaultGit trims, so a first line " M path" arrives as "M path".
    const files = status.split("\n").map((l) => l.replace(/^\s*\S{1,2}\s+/, ""));
    return { cls: K.DIRTY, reason: `${files.length} uncommitted or untracked: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ", ..." : ""}` };
  }
  if (wt.detached || !wt.branch) return { cls: K.DETACHED_UNKNOWN, reason: `detached HEAD ${short(wt.headSha)}: no branch to find a PR by` };

  let lease;
  try {
    lease = await leaseOf(wt.branch);
  } catch (e) {
    return { cls: K.UNKNOWN, reason: `lease read failed: ${firstLine(e)}` };
  }
  if (lease && lease.status === "active" && !isExpired(lease)) {
    return { cls: K.ACTIVE, reason: `live Session Authority lease: session ${lease.sessionId} until ${lease.expiresAt}` };
  }

  let prs;
  try {
    prs = JSON.parse(gh(["pr", "list", "--head", wt.branch, "--state", "all", "--json", "number,state,headRefOid", "--limit", "100"]));
  } catch (e) {
    return { cls: K.UNKNOWN, reason: `gh pr list failed: ${firstLine(e)}` };
  }
  const open = prs.filter((p) => p.state === "OPEN");
  if (open.length) return { cls: K.OPEN_PR, reason: `open PR ${open.map((p) => `#${p.number}`).join(", ")}` };
  const mergedPrs = prs.filter((p) => p.state === "MERGED");
  for (const pr of mergedPrs) {
    let view;
    try {
      view = JSON.parse(gh(["pr", "view", String(pr.number), "--json", "state,commits,headRefOid"]));
    } catch (e) {
      return { cls: K.UNKNOWN, reason: `gh pr view #${pr.number} failed: ${firstLine(e)}` };
    }
    if (view.state !== "MERGED") continue;
    if (view.headRefOid === wt.headSha) return { cls: K.LANDED, reason: `PR #${pr.number} merged; HEAD ${short(wt.headSha)} is its head` };
    if ((view.commits ?? []).some((c) => c.oid === wt.headSha)) {
      return { cls: K.LANDED, reason: `PR #${pr.number} merged; HEAD ${short(wt.headSha)} is in its commits` };
    }
  }
  if (mergedPrs.length) {
    const nums = mergedPrs.map((p) => `#${p.number}`).join(", ");
    return { cls: K.UNKNOWN, reason: `PR ${nums} merged, but HEAD ${short(wt.headSha)} is not its head and not in its commits (work after the merge?)` };
  }
  return { cls: K.NO_PR, reason: prs.length ? `no open or merged PR; only ${prs.map((p) => `#${p.number} ${p.state}`).join(", ")}` : `no PR for ${wt.branch}` };
}

/**
 * Classify every worktree under .claude/worktrees/ and .worktrees/ (never the primary checkout). With `execute`, tear
 * down LANDED ones only, one at a time through worktree-teardown.ps1 -ForceDirtyRelease, after re-classifying each
 * immediately before its teardown. `only` narrows the candidates (merge-gate passes the merged head).
 */
export async function sweepWorktrees({ cwd, execute = false, deps = {}, only = () => true }) {
  const d = { ...defaultSweepDeps(cwd), ...deps };
  const list = () => parseWorktreePorcelain(d.git(["worktree", "list", "--porcelain"], cwd)).filter((w) => !w.bare && w.path);
  const all = list();
  const primary = all[0]?.path; // git lists the main worktree first
  const P = norm(primary);
  const self = norm(d.git(["rev-parse", "--show-toplevel"], cwd));
  const ctx = { git: d.git, gh: d.gh, readLease: d.readLease, now: d.now, self, primary };
  const registered = (path) => list().some((w) => norm(w.path) === norm(path));
  const candidates = all.filter((w) => norm(w.path) !== P && SWEPT_DIRS.some((dir) => norm(w.path).startsWith(`${P}/${dir}`)) && only(w));

  const results = [];
  for (const wt of candidates) {
    const { cls, reason } = await classifyWorktree(wt, ctx);
    const r = { path: wt.path, branch: wt.branch, headSha: wt.headSha, cls, reason, removed: false };
    results.push(r);
    if (!execute || cls !== K.LANDED) continue;

    const fresh = list().find((w) => norm(w.path) === norm(wt.path));
    const again = fresh && fresh.headSha === wt.headSha ? await classifyWorktree(fresh, ctx) : { cls: K.UNKNOWN, reason: "HEAD moved or registration gone" };
    if (again.cls !== K.LANDED) {
      Object.assign(r, { cls: again.cls, reason: `kept by the re-check before teardown: ${again.reason}` });
      continue;
    }
    let t, attempts = 0;
    try {
      t = d.teardown(wt.path, primary);
      attempts = 1;
      if (t.status !== 0 && registered(wt.path) && LIBUV_CRASH.test(t.output ?? "")) {
        t = d.teardown(wt.path, primary);
        attempts = 2;
      }
    } catch (e) {
      t = { status: 1, output: firstLine(e) };
    }
    r.removed = !registered(wt.path);
    const tail = String(t.output ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
    r.reason += r.removed ? `; removed${attempts > 1 ? " after one libuv-crash retry" : ""}` : `; teardown failed (exit ${t.status}): ${tail}`;
  }
  return { primary, execute, results };
}

/** Counts per class, then one row per worktree: class, path relative to the primary, branch, reason. */
export function formatSweep({ primary, execute, results }) {
  const order = Object.values(K);
  const rel = (p) => {
    const n = norm(p);
    const P = norm(primary);
    return n.startsWith(`${P}/`) ? p.replace(/\\/g, "/").slice(P.length + 1) : p;
  };
  const counts = order.map((c) => `${c} ${results.filter((r) => r.cls === c).length}`).join(" · ");
  const removed = results.filter((r) => r.removed).length;
  const rows = [...results]
    .sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || a.path.localeCompare(b.path))
    .map((r) => `${(r.removed ? "REMOVED" : r.cls).padEnd(16)}  ${rel(r.path)}  ${r.branch ?? "(detached)"}  ${r.reason}`);
  return [
    execute ? "worktree sweep · EXECUTE: LANDED torn down through worktree-teardown.ps1" : "worktree sweep · DRY RUN: nothing removed (--execute tears down LANDED only)",
    `primary ${primary} is never swept · ${results.length} worktree(s) under .claude/worktrees and .worktrees`,
    `${counts} · removed ${removed}`,
    "",
    ...rows,
  ].join("\n");
}

/** merge-gate's hook: sweep only the worktree(s) holding the head it just merged. Logs; the caller never fails on it. */
export async function sweepAfterMerge({ branch, headSha }, { cwd = process.cwd(), deps, log = console.log } = {}) {
  const sweep = await sweepWorktrees({ cwd, execute: true, deps, only: (w) => (branch && w.branch === branch) || (headSha && w.headSha === headSha) });
  if (!sweep.results.length) log(`SWEEP: no local worktree holds ${branch} (${short(headSha)}); nothing to remove`);
  for (const r of sweep.results) log(r.removed ? `SWEEP: removed ${r.path} (${r.reason})` : `SWEEP: kept ${r.path}: ${r.cls} (${r.reason})`);
  return sweep;
}

/** Gather remote evidence for one branch: existence, PR/merge state (per-PR reads
 * only), ahead/behind via the compare endpoint. Exported — repo-rescue.mjs and
 * branch-sweep.mjs reuse this exact gathering, not a second implementation. */
export async function gatherRemoteEvidence(
  owner,
  repo,
  branch,
  { knownExistsOnOrigin, ghJsonImpl = ghJson } = {},
) {
  const base = `/repos/${owner}/${repo}`;
  let existsOnOrigin = knownExistsOnOrigin;
  if (existsOnOrigin === undefined) {
    existsOnOrigin = true;
    try {
      await ghJsonImpl(`${base}/branches/${encodeURIComponent(branch)}`);
    } catch (e) {
      if (/404/.test(e.message)) existsOnOrigin = false;
      else throw e;
    }
  }

  let aheadOfMain, behindOfMain;
  if (existsOnOrigin) {
    try {
      const cmp = await ghJsonImpl(`${base}/compare/main...${encodeURIComponent(branch)}`);
      aheadOfMain = cmp.ahead_by;
      behindOfMain = cmp.behind_by;
    } catch (e) {
      // compare can fail on an empty/orphan branch — leave undefined, not a false 0. A TIMEOUT is not that: it goes on,
      // so the caller's cell reads UNKNOWN instead of a class built on a read that never answered (manager round 1).
      if (e?.timedOut || e?.name === "TimeoutError" || e?.name === "AbortError") throw e;
    }
  }

  // For an existing branch whose current tip is fully contained in main,
  // classifyBranch() is provably LANDED and does not consult PR history.
  // Avoid the head-filter + per-PR reads entirely in that common case.
  if (existsOnOrigin && aheadOfMain === 0) {
    return { branch, existsOnOrigin, prs: [], aheadOfMain, behindOfMain };
  }

  const candidates = await ghJsonImpl(`${base}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=all`);
  const prs = await Promise.all(
    candidates.map(async (c) => {
      const full = await ghJsonImpl(`${base}/pulls/${c.number}`); // authoritative merged field, never the list one
      return { number: full.number, merged: full.merged === true, mergedAt: full.merged_at ?? undefined };
    }),
  );

  return { branch, existsOnOrigin, prs, aheadOfMain, behindOfMain };
}

/** Pure formatter — one row per branch, one screen. */
export function formatStatusTable(rows) {
  const cols = ["branch", "local", "dirty", "unpushed", "origin", "PR/class", "lease"];
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

async function main() {
  ensureProxyEnv();
  const cwd = process.cwd();
  if (flag("sweep") || flag("execute")) {
    if (!flag("sweep")) {
      console.error("[repo-status] --execute only works with --sweep: node scripts/agent-os/repo-status.mjs --sweep --execute");
      process.exit(64);
    }
    const sweep = await sweepWorktrees({ cwd, execute: flag("execute") });
    console.log(formatSweep(sweep));
    // Exit 1 when a worktree that stayed LANDED through the re-check could not be torn down.
    process.exit(sweep.results.some((r) => r.cls === K.LANDED && sweep.execute && !r.removed) ? 1 : 0);
  }
  const started = Date.now();
  const { signal, stop } = budgetSignal(BUDGET_MS);
  // At most GIT_CONCURRENCY git children at once: 16 rows' worth starved each other past SPAWN_TIMEOUT_MS on a loaded
  // machine, while one status alone took 200-280 ms (2026-11-03). A queued call still ends at the run's abort.
  let running = 0;
  const waiting = [];
  const git = async (args, at) => {
    while (running >= GIT_CONCURRENCY) await new Promise((wake) => waiting.push(wake));
    running += 1;
    try {
      return await runBounded("git", args, { cwd: at, env: stripGitLocalEnv(), signal });
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
  const read = (opts = {}) => ({ ...opts, signal: AbortSignal.any([signal, AbortSignal.timeout(SPAWN_TIMEOUT_MS)]) });
  const json = (path, opts) => ghJson(path, read(opts));

  const { owner, repo } = ownerRepoFromUrl(await git(["remote", "get-url", "origin"], cwd));
  const worktrees = parseWorktreePorcelain(await git(["worktree", "list", "--porcelain"], cwd)).filter((w) => !w.bare && w.branch);

  // One listing answers "exists on origin" for every row (22 origin branches vs 82 worktrees, 2026-11-03); if it
  // fails, each row asks for itself as before.
  const onOrigin = await ghPaginate(`/repos/${owner}/${repo}/branches`, read()).then((all) => new Set(all.map((b) => b.name)), () => null);
  let branchesToReport = worktrees.map((w) => w.branch);
  if (flag("all-branches")) {
    if (!onOrigin) throw new Error("--all-branches: the origin branch list could not be read");
    branchesToReport = [...new Set([...branchesToReport, ...onOrigin])];
  }

  // Same for leases: one listing of refs/leases/* replaces a lookup per row; a row only reads the lease it has.
  const leaseStore = createGitHubLeaseStore(owner, repo, { json });
  const leaseRefs = await ghPaginate(`/repos/${owner}/${repo}/git/matching-refs/leases`, read()).then(
    (refs) => new Map(refs.filter((r) => r.ref.startsWith("refs/leases/")).map((r) => [r.ref.slice("refs/leases/".length), { sha: r.object.sha }])),
    () => null,
  );
  const store = leaseRefs ? { ...leaseStore, getRef: async (b) => leaseRefs.get(b) ?? null } : leaseStore;
  const ctx = { owner, repo, git, json, onOrigin, store };
  const rows = new Array(branchesToReport.length);
  let next = 0;
  const worker = async () => {
    while (next < branchesToReport.length) {
      const i = next++;
      rows[i] = await statusRow(branchesToReport[i], worktrees.find((w) => w.branch === branchesToReport[i]), ctx);
    }
  };
  await Promise.all(Array.from({ length: ROW_CONCURRENCY }, worker)); // after the abort every read rejects at once
  stop();

  const cells = rows.flat().map(String);
  const timeouts = cells.filter((c) => c === TIMEOUT_CELL).length;
  const errors = cells.filter((c) => c.startsWith("UNKNOWN (error")).length;
  const receipt =
    `receipt: ${rows.length} branch row(s) in ${((Date.now() - started) / 1000).toFixed(1)} s (budget ${BUDGET_MS / 1000} s)` +
    ` · ${timeouts} cell(s) UNKNOWN (timeout) · ${errors} cell(s) UNKNOWN (error)`; // cells: one failed remote read fills two
  const text = `repo:status · ${owner}/${repo} · local worktrees shown are THIS machine's only\n\n${formatStatusTable(rows)}\n\n${receipt}\n`;
  // Exit once the text is flushed: an orphaned grandchild or a keep-alive socket must not hold the answer back.
  process.stdout.write(text, () => process.exit(0));
}

/** One table row. Each read settles on its own, so a hung status still leaves the remote cells (and the reverse). */
export async function statusRow(branch, wt, { owner, repo, git, json, onOrigin, store }) {
  const unknown = (e) =>
    e?.timedOut || ["AbortError", "TimeoutError"].includes(e?.name) ? TIMEOUT_CELL : `UNKNOWN (error: ${firstLine(e).slice(0, 60)})`;
  const upstream = (path) =>
    git(["rev-parse", "--verify", `origin/${branch}`], path).then(() => true, (e) => (e.timedOut ? Promise.reject(e) : false));
  const [dirty, unpushed, remote, lease] = await Promise.all([
    wt ? git(["--no-optional-locks", "status", "--porcelain"], wt.path).then((s) => (s ? "yes" : "no"), unknown) : "-",
    wt
      ? upstream(wt.path)
          .then((up) => git(["rev-list", "--count", up ? `origin/${branch}..HEAD` : "HEAD"], wt.path))
          .then((n) => parseInt(n || "0", 10), unknown)
      : "-",
    gatherRemoteEvidence(owner, repo, branch, { ghJsonImpl: json, knownExistsOnOrigin: onOrigin?.has(branch) }).then((ev) => ({ ev, cls: classifyBranch(ev) }), unknown),
    readLease(branch, { store }).then(
      (l) => (!l ? "-" : l.status !== "active" ? "released" : isExpired(l) ? `expired (was ${l.sessionId})` : `${l.sessionId} (${l.sessionKind})`),
      unknown,
    ),
  ]);
  const prs = typeof remote === "string" ? "" : remote.ev.prs.length ? ` (#${remote.ev.prs.map((p) => p.number).join(",")})` : "";
  return [
    branch,
    wt ? wt.path : "(not checked out here)",
    dirty,
    unpushed,
    typeof remote === "string" ? remote : remote.ev.existsOnOrigin ? "yes" : "no",
    typeof remote === "string" ? remote : `${remote.cls.classification}${prs}`,
    lease,
  ];
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => {
    console.error(`[repo-status] ${e.message}`);
    process.exit(1);
  });
}
