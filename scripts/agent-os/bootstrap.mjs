#!/usr/bin/env node
/**
 * Agent bootstrap receipt.
 *
 * Purpose: compose volatile repository state into one cheap, reproducible
 * startup snapshot without creating another policy or truth source.
 *
 * This is intentionally broader than the lightweight Claude SessionStart hook:
 * it can refresh origin/main, inspect worktrees, inspect open PRs when gh is
 * available, detect exact changed-file collisions, and route the next context
 * to read. Missing network/tooling becomes UNKNOWN/PARTIAL, never an all-clear.
 *
 * Human:
 *   pnpm agent:bootstrap
 * Machine-readable:
 *   pnpm agent:bootstrap -- --json
 * Hermetic/local-only:
 *   pnpm agent:bootstrap -- --no-fetch --no-remote
 * Cache the JSON under .agent-cache:
 *   pnpm agent:bootstrap -- --json --write
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "..", "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 15000,
    maxBuffer: 4 * 1024 * 1024,
    env: options.env ?? process.env,
    shell: false,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? result.error.message : null,
  };
}

function git(root, args, timeout = 10000) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  return run("git", ["-C", root, ...args], { cwd: root, timeout, env });
}

function lines(text) {
  return String(text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const set = new Set(argv);
  const maxArg = argv.find((x) => x.startsWith("--max-prs="));
  const maxPrs = maxArg ? Number(maxArg.slice("--max-prs=".length)) : 12;
  return {
    json: set.has("--json"),
    write: set.has("--write"),
    noFetch: set.has("--no-fetch"),
    noRemote: set.has("--no-remote"),
    maxPrs: Number.isFinite(maxPrs) ? Math.max(1, Math.min(30, maxPrs)) : 12,
  };
}

export function parseWorktrees(text) {
  const blocks = String(text || "").trim().split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.map((block) => {
    const row = {};
    for (const raw of block.split(/\r?\n/)) {
      const [key, ...rest] = raw.split(" ");
      const value = rest.join(" ").trim();
      if (key === "worktree") row.path = value;
      else if (key === "HEAD") row.head = value;
      else if (key === "branch") row.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "detached") row.detached = true;
      else if (key === "locked") row.locked = value || true;
      else if (key === "prunable") row.prunable = value || true;
    }
    return row;
  });
}

function statusPaths(statusText) {
  const out = [];
  for (const raw of String(statusText || "").split(/\r?\n/)) {
    if (!raw) continue;
    let path = raw.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ").at(-1).trim();
    if (path.startsWith('"') && path.endsWith('"')) {
      try { path = JSON.parse(path); } catch { /* keep git's raw spelling */ }
    }
    if (path) out.push(path);
  }
  return out;
}

export function contextPointers(changedFiles = [], branch = "") {
  const pointers = ["AGENTS.md", "NOUR-COMMAND.md"];
  const paths = changedFiles.map((p) => p.replaceAll("\\", "/"));
  const statenour = branch.startsWith("statenour/") || paths.some((p) => p.startsWith("apps/statenour/"));
  const nickstire = branch.startsWith("nickstire/") || paths.some((p) => p.startsWith("apps/nickstire/"));
  const worker = paths.some((p) => p.startsWith("apps/worker/"));

  if (statenour) pointers.push(
    "apps/statenour/AGENTS.md",
    "apps/statenour/docs/CURRENT-TRUTH.md",
    "apps/statenour/.remember/now.md",
  );
  if (nickstire) pointers.push(
    "apps/nickstire/AGENTS.md",
    "apps/nickstire/PROTECTED-CORE.md",
    "apps/nickstire/docs/CURRENT-TRUTH.md",
    "apps/nickstire/.remember/now.md",
  );
  if (worker) pointers.push("apps/worker/AGENTS.md", "apps/worker/DEPLOY.md");
  if (paths.some((p) => p.startsWith("scripts/agent-os/") || p.startsWith(".claude/") || p === "CLAUDE.md")) {
    pointers.push("docs/agent-os/README.md");
  }
  return [...new Set(pointers)];
}

export function classifyCollisions(changedFiles = [], branch = "", openPrs = []) {
  const changed = new Set(changedFiles.map((p) => p.replaceAll("\\", "/")));
  const collisions = [];
  for (const pr of openPrs) {
    if (!pr || pr.headRefName === branch) continue;
    const exactFiles = (pr.files || [])
      .map((p) => String(p).replaceAll("\\", "/"))
      .filter((p) => changed.has(p));
    if (!exactFiles.length) continue;
    collisions.push({
      pr: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      exactFiles,
      state: "ACTIVE_OTHER_OWNER",
    });
  }
  return collisions;
}

function remotePrState(root, branch, changedFiles, maxPrs) {
  const ghVersion = run("gh", ["--version"], { cwd: root, timeout: 5000 });
  if (!ghVersion.ok) {
    return {
      status: "unknown",
      reason: "gh CLI unavailable or unauthenticated",
      openPrs: [],
      collisions: [],
    };
  }

  const listed = run("gh", [
    "pr", "list",
    "--state", "open",
    "--limit", String(maxPrs),
    "--json", "number,title,headRefName,baseRefName,isDraft,updatedAt,url",
  ], { cwd: root, timeout: 15000 });

  if (!listed.ok) {
    return {
      status: "unknown",
      reason: listed.stderr || listed.error || "gh pr list failed",
      openPrs: [],
      collisions: [],
    };
  }

  let prs;
  try {
    prs = JSON.parse(listed.stdout || "[]");
  } catch {
    return { status: "unknown", reason: "gh pr list returned invalid JSON", openPrs: [], collisions: [] };
  }

  const openPrs = [];
  for (const pr of prs) {
    const viewed = run("gh", ["pr", "view", String(pr.number), "--json", "files"], {
      cwd: root,
      timeout: 10000,
    });
    let files = [];
    if (viewed.ok) {
      try {
        const parsed = JSON.parse(viewed.stdout || "{}");
        files = (parsed.files || []).map((f) => f.path).filter(Boolean);
      } catch {
        files = [];
      }
    }
    openPrs.push({ ...pr, files, filesKnown: viewed.ok });
  }

  return {
    status: "fresh",
    openPrs,
    collisions: classifyCollisions(changedFiles, branch, openPrs),
  };
}

function human(report) {
  const g = report.git;
  const remote = report.remote;
  console.log("NOUR AGENT BOOTSTRAP");
  console.log("====================");
  console.log(`GENERATED  ${report.generatedAt}`);
  console.log(`GIT        branch=${g.branch || "UNKNOWN"} head=${g.headShort || "UNKNOWN"} origin/main=${g.originMainShort || "UNKNOWN"} tree=${g.dirty ? "DIRTY" : "clean"}`);
  console.log(`DIVERGENCE ahead=${g.ahead ?? "?"} behind=${g.behind ?? "?"} changed=${g.changedFiles.length} working=${g.workingFiles.length}`);
  console.log(`WORKTREES  ${report.worktrees.length}`);
  console.log(`REMOTE     ${remote.status.toUpperCase()}${remote.reason ? " — " + remote.reason : ""}`);
  if (remote.status === "fresh") {
    console.log(`OPEN PRS   ${remote.openPrs.length}`);
    console.log(`COLLISIONS ${remote.collisions.length}`);
    for (const c of remote.collisions) {
      console.log(`  PR #${c.pr} ${c.headRefName}: ${c.exactFiles.join(", ")}`);
    }
  }
  console.log("READ NEXT");
  for (const p of report.readNext) console.log(`  - ${p}`);
  for (const warning of report.warnings) console.log(`WARN       ${warning}`);
  console.log(`BOOTSTRAP_RESULT=${report.result}`);
}

export function buildBootstrapReport(root, options) {
  const warnings = [];

  let fetchState = "skipped";
  if (!options.noFetch) {
    const fetched = git(root, ["fetch", "origin", "main", "--quiet"], 20000);
    fetchState = fetched.ok ? "fresh" : "failed";
    if (!fetched.ok) warnings.push(`origin/main refresh failed: ${fetched.stderr || fetched.error || "unknown error"}`);
  }

  const branchR = git(root, ["branch", "--show-current"]);
  const headR = git(root, ["rev-parse", "HEAD"]);
  const originR = git(root, ["rev-parse", "origin/main"]);
  const statusR = git(root, ["status", "--porcelain=v1"]);
  const worktreesR = git(root, ["worktree", "list", "--porcelain"]);

  const branch = branchR.ok ? branchR.stdout : null;
  const head = headR.ok ? headR.stdout : null;
  const originMain = originR.ok ? originR.stdout : null;
  const workingFiles = statusR.ok ? statusPaths(statusR.stdout) : [];

  let ahead = null;
  let behind = null;
  if (head && originMain) {
    const div = git(root, ["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
    if (div.ok) {
      const [left, right] = div.stdout.split(/\s+/).map(Number);
      behind = Number.isFinite(left) ? left : null;
      ahead = Number.isFinite(right) ? right : null;
    }
  }

  const diffR = originMain
    ? git(root, ["diff", "--name-only", "origin/main...HEAD"])
    : { ok: false, stdout: "" };
  const committedChanged = diffR.ok ? lines(diffR.stdout) : [];
  const changedFiles = [...new Set([...committedChanged, ...workingFiles])].sort();

  const worktrees = worktreesR.ok ? parseWorktrees(worktreesR.stdout) : [];
  if (!worktreesR.ok) warnings.push("git worktree state unavailable");

  const remote = options.noRemote
    ? { status: "skipped", reason: "--no-remote", openPrs: [], collisions: [] }
    : remotePrState(root, branch || "", changedFiles, options.maxPrs);

  if (remote.status === "unknown") warnings.push(`remote PR/collision truth unavailable: ${remote.reason}`);
  if (fetchState === "skipped") warnings.push("origin/main was not refreshed in this run");

  const result =
    !head || !originMain || remote.status === "unknown" || fetchState === "failed"
      ? "PARTIAL"
      : remote.collisions.length
        ? "ATTENTION"
        : "READY";

  return {
    generator: "scripts/agent-os/bootstrap.mjs@1",
    generatedAt: new Date().toISOString(),
    result,
    fetchState,
    root,
    git: {
      branch,
      head,
      headShort: head?.slice(0, 10) ?? null,
      originMain,
      originMainShort: originMain?.slice(0, 10) ?? null,
      dirty: workingFiles.length > 0,
      ahead,
      behind,
      changedFiles,
      workingFiles,
    },
    worktrees,
    remote,
    readNext: contextPointers(changedFiles, branch || ""),
    warnings,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const root = resolve(process.env.AGENT_OS_BOOTSTRAP_ROOT || DEFAULT_ROOT);
  const report = buildBootstrapReport(root, options);

  if (options.write) {
    const key = report.git.head || "unknown";
    const dir = join(root, ".agent-cache", "bootstrap");
    mkdirSync(dir, { recursive: true });
    const output = join(dir, `${key}.json`);
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    report.cachePath = output;
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else human(report);

  // PARTIAL/ATTENTION are valid information states, not command failure.
  // Only a broken local Git identity makes the bootstrap unusable.
  if (!report.git.head) process.exitCode = 2;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) main();
