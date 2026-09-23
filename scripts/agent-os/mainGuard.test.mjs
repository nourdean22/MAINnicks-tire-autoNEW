/**
 * Canaries for the "am I the entry script?" guard — audit item O, 2026-09-23.
 *
 * Every Session Authority CLI and the lease-check PreToolUse hook guarded main()
 * with import.meta.url === `file://${argv[1]}`. On Windows (the operator's machine)
 * argv[1] is `C:\…\x.mjs` and the URL `file:///C:/…/x.mjs`, so the comparison was
 * never true: the CLIs and the hook exited 0 having done NOTHING, silently. The same
 * comparison also fails on Linux whenever the path holds a URL-escaped character
 * (a space -> %20), which is how the real-binary arm below reproduces it on CI.
 *
 * Three arms: the helper against a simulated Windows argv/URL pair (with the old
 * expression shown false on the same input), a static scan so the pattern cannot
 * come back, and every CLI run as a real process from a path containing a space,
 * asserting it DID something (spoke, or blocked) — not merely exit 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./cli-common.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIS = ["agent-start", "agent-finish", "lease-check", "repo-status", "repo-rescue", "branch-sweep", "check-source-citation"];

// ── helper, Windows simulated ────────────────────────────────────────────────

const WIN_ARGV = "C:\\Users\\nourd\\NOURCITY\\scripts\\agent-os\\lease-check.mjs";
const WIN_URL = "file:///C:/Users/nourd/NOURCITY/scripts/agent-os/lease-check.mjs";

test("the OLD comparison is false for a Windows argv/URL pair (the defect, reproduced)", () => {
  assert.equal(WIN_URL === `file://${WIN_ARGV}`, false);
});

test("isMainModule: true for the Windows entry script, including drive-letter/case differences", () => {
  assert.equal(isMainModule(WIN_URL, WIN_ARGV, { windows: true }), true);
  assert.equal(isMainModule("file:///c:/Users/nourd/x.mjs", "C:\\USERS\\nourd\\x.mjs", { windows: true }), true);
});

test("isMainModule: false for a DIFFERENT script (an import is not the entry point)", () => {
  assert.equal(isMainModule(WIN_URL, "C:\\Users\\nourd\\NOURCITY\\scripts\\agent-os\\agent-finish.mjs", { windows: true }), false);
  assert.equal(isMainModule("file:///repo/scripts/agent-os/lease.mjs", "/repo/scripts/agent-os/agent-start.mjs", { windows: false }), false);
  assert.equal(isMainModule("file:///repo/x.mjs", undefined, { windows: false }), false);
});

test("isMainModule: true on POSIX for a path with a URL-escaped character (the old guard's Linux blind spot)", () => {
  assert.equal("file:///tmp/a%20b/x.mjs" === "file:///tmp/a b/x.mjs", false);
  assert.equal(isMainModule("file:///tmp/a%20b/x.mjs", "/tmp/a b/x.mjs", { windows: false }), true);
});

// ── static: the broken pattern cannot come back ─────────────────────────────

test("no agent-os script guards main() with a file:// + argv[1] string comparison", () => {
  const offenders = readdirSync(HERE)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .filter((f) => /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/.test(readFileSync(join(HERE, f), "utf8")));
  assert.deepEqual(offenders, []);
  for (const cli of CLIS) {
    assert.match(readFileSync(join(HERE, `${cli}.mjs`), "utf8"), /if \(isMainModule\(import\.meta\.url\)\)/, `${cli}.mjs`);
  }
});

// ── real binaries, from a path the old guard could not match ────────────────

function cleanEnv() {
  // No GIT_* (hook-inherited git state), no proxy re-exec, no token: nothing here
  // may reach the network or a real ref.
  const drop = /^(GIT_|HTTPS?_PROXY$|GITHUB_TOKEN$|GH_TOKEN$)/;
  return { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !drop.test(k))), CLAUDE_CODE_SESSION_ID: "me" };
}

test("REAL BINARIES from a path with a space: every CLI actually runs main()", (t) => {
  const root = mkdtempSync(join(tmpdir(), "main guard "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, "scripts", "agent-os");
  mkdirSync(scripts, { recursive: true });
  cpSync(HERE, scripts, { recursive: true });
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: repo, env: cleanEnv(), stdio: "ignore" });
  git("init -q -b main");
  git('-c user.email=t@x.com -c user.name=t commit -q --allow-empty -m init');

  for (const cli of CLIS) {
    const r = spawnSync(process.execPath, [join(scripts, `${cli}.mjs`)], { cwd: repo, input: "", encoding: "utf8", env: cleanEnv(), timeout: 20000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.ok(out.trim().length > 0, `${cli}.mjs exited ${r.status} with NO output — main() never ran`);
  }
});

test("REAL BINARY from a path with a space: lease-check still BLOCKS a foreign live marker (exit 2)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "main guard "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, "scripts", "agent-os");
  mkdirSync(scripts, { recursive: true });
  cpSync(HERE, scripts, { recursive: true });
  const repo = join(root, "repo");
  mkdirSync(repo);
  execSync("git init -q -b main", { cwd: repo, env: cleanEnv() });
  execSync("git -c user.email=t@x.com -c user.name=t commit -q --allow-empty -m init", { cwd: repo, env: cleanEnv() });
  const { writeLocalMarker } = await import("./local-lease-marker.mjs");
  writeLocalMarker(repo, { branch: "main", sessionId: "someone-else", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const r = spawnSync(process.execPath, [join(scripts, "lease-check.mjs")], {
    cwd: repo,
    input: JSON.stringify({ cwd: repo, tool_name: "Bash", tool_input: { command: "git status" } }),
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 10000,
  });
  assert.equal(r.status, 2, `expected a block, got exit ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /REFUSED/);
});
