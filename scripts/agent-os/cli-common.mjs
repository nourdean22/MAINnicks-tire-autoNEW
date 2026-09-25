#!/usr/bin/env node
/**
 * Tiny shared helpers for the Session Authority CLIs (agent-start, agent-finish,
 * repo-status, repo-rescue, branch-sweep) — one implementation of "how do we parse
 * args / find owner-repo / resolve a session identity," not five (2026-09-23).
 */
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/** `--name value` -> value, else fallback. */
export function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

/** `--name` present with no value (boolean flag). */
export function flag(name) {
  return process.argv.includes(`--${name}`);
}

/** Run a git/shell command, trimmed stdout. Throws on nonzero exit — callers that
 * want "does this exist" semantics should catch, not pre-check. */
export function sh(cmd, cwd) {
  return execSync(cmd, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Parse {owner, repo} from `git remote get-url origin`, handling both
 * `git@github.com:owner/repo.git` and `https://github.com/owner/repo(.git)`. */
export function originOwnerRepo(cwd) {
  const url = sh("git remote get-url origin", cwd);
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!m) throw new Error(`could not parse owner/repo from origin url: ${url}`);
  return { owner: m[1], repo: m[2] };
}

/** A stable identity for THIS session across its lifetime. Falls back to a
 * pid+timestamp when CLAUDE_CODE_SESSION_ID is absent (a bare manual run), which is
 * intentionally unstable across invocations — that is correct for a manual run,
 * where there is no real session to be stable FOR. */
export function resolveSessionId(env = process.env) {
  return env.CLAUDE_CODE_SESSION_ID || `manual-${process.pid}-${Date.now()}`;
}

/** "bridge" | "cloud" | "unknown" — best-effort from the harness's own env vars,
 * overridable with --session-kind for the one caller (worktree-setup.ps1) that
 * already knows precisely which one it is. */
export function resolveSessionKind() {
  const explicit = arg("session-kind");
  if (explicit) return explicit;
  const t = (process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE || "").toLowerCase();
  if (t.includes("cloud")) return "cloud";
  if (t.includes("bridge") || t.includes("local")) return "bridge";
  return process.platform === "linux" && process.env.CLAUDE_PROJECT_DIR ? "cloud" : "unknown";
}

/** Current branch of `cwd`, or the explicit --branch override. */
export function resolveBranch(cwd) {
  return arg("branch") ?? sh("git rev-parse --abbrev-ref HEAD", cwd);
}

/**
 * True when the module whose `import.meta.url` is `metaUrl` is the script node was
 * launched with. Replaces `import.meta.url === \`file://${process.argv[1]}\``, which
 * is NEVER true on Windows (argv[1] is `C:\\…\\x.mjs`, the URL is
 * `file:///C:/…/x.mjs`) and not on POSIX either when the path has a space or other
 * URL-escaped character — so every Session Authority CLI and the lease-check hook
 * exited 0 having done nothing on the operator's machine (audit item O).
 * Compares filesystem paths, not URL strings; case-insensitive on Windows; falls
 * back to argv[1]'s realpath because node resolves symlinks for the main module.
 * `windows` is injectable so the Windows branch is testable on Linux CI.
 */
export function isMainModule(metaUrl, argv1 = process.argv[1], { windows = process.platform === "win32" } = {}) {
  if (!argv1) return false;
  const p = windows ? win32 : posix;
  let modulePath;
  try {
    modulePath = fileURLToPath(metaUrl, { windows });
  } catch {
    return false;
  }
  const norm = (x) => (windows ? p.resolve(x).toLowerCase() : p.resolve(x));
  if (norm(argv1) === norm(modulePath)) return true;
  try {
    return norm(realpathSync(argv1)) === norm(modulePath);
  } catch {
    return false;
  }
}
