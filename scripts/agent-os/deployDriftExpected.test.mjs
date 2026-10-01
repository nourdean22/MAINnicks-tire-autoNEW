/**
 * deploy-drift.yml expects the release Railway actually deploys for
 * statenour-web, not one its own path list invents.
 *
 * THE DEFECT, 2026-10-01. The observer's "Resolve the expected release" step
 * picked the newest main commit touching `apps/statenour packages
 * pnpm-lock.yaml ...`, so every packages/** change counted. statenour-web
 * watches four packages. #2865 and #2863 changed packages/meta-ads-architect,
 * which only nickstire consumes; Railway rightly did not rebuild statenour-web,
 * and the observer reported DRIFT every 30 minutes from 18:20Z (run
 * 36906122176 onward), each one a failure email to the owner. The drift step
 * failed first, so the worker-liveness step after it never ran at all.
 *
 * WHAT THIS PROVES, by running the workflow's own step text with bash in a
 * scratch repository:
 *   - replaying that afternoon, the step picks the last statenour commit, not
 *     the newer meta-ads-architect one (the step text from before the fix picks
 *     the meta-ads-architect one; that is the PR's red-first receipt);
 *   - it still picks a commit for every pattern statenour-web watches,
 *     including a nested package.json: watch paths are gitignore-style, and
 *     statenour-web was serving e6eb59442f on 2026-09-23, a commit whose only
 *     watched path is apps/nickstire/package.json (deploy-drift run 35817756035);
 *   - it fails and records no release when railway.ts has no statenour-web
 *     list, instead of comparing against nothing;
 *   - the grace window, the operator pin and "nothing to compare" still hold;
 *   - the worker step runs after a failed drift step.
 *
 * Run: node --test scripts/agent-os/deployDriftExpected.test.mjs (or pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAgentChildEnv } from "./gitLocalEnv.mjs";
import { toPathspec, toPathspecs, watchPatterns } from "../ci/railway-watch-pathspecs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORKFLOW_TEXT = readFileSync(join(REPO, ".github", "workflows", "deploy-drift.yml"), "utf8");
const SCRIPT_REL = "scripts/ci/railway-watch-pathspecs.mjs";
const RAILWAY_REL = ".railway/railway.ts";
const RAILWAY_TS = readFileSync(join(REPO, RAILWAY_REL), "utf8");
const SERVICE = "statenour-web";

/** The `run: |` body of the named step, de-indented as the runner receives it. */
export function stepScript(workflowText, stepName) {
  const lines = workflowText.split(/\r?\n/);
  const indentOf = (l) => l.length - l.trimStart().length;
  const nameAt = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (nameAt === -1) throw new Error(`no step named "${stepName}"`);
  const stepIndent = indentOf(lines[nameAt]);
  let runAt = -1;
  for (let i = nameAt + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (indentOf(lines[i]) <= stepIndent) break;
    if (/^\s*run:\s*\|\s*$/.test(lines[i])) {
      runAt = i;
      break;
    }
  }
  if (runAt === -1) throw new Error(`step "${stepName}" has no "run: |" block`);
  const keyIndent = indentOf(lines[runAt]);
  const body = [];
  let blockIndent = null;
  for (let i = runAt + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      body.push("");
      continue;
    }
    if (indentOf(lines[i]) <= keyIndent) break;
    blockIndent ??= indentOf(lines[i]);
    body.push(lines[i].slice(blockIndent));
  }
  return body.join("\n").replace(/\n+$/, "\n");
}

/** The step's own top-level keys, in any order, comments and block bodies dropped. */
function stepKeys(workflowText, stepName) {
  const lines = workflowText.split(/\r?\n/);
  const indentOf = (l) => l.length - l.trimStart().length;
  const nameAt = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (nameAt === -1) throw new Error(`no step named "${stepName}"`);
  const keyIndent = indentOf(lines[nameAt]) + 2;
  const keys = [];
  for (let i = nameAt + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (indentOf(lines[i]) < keyIndent) break;
    if (indentOf(lines[i]) === keyIndent && !t.startsWith("#")) keys.push(t);
  }
  return keys;
}

/** Substitute the one expression the step uses; refuse any other. */
function render(script, { expectedSha = "" } = {}) {
  const out = script.replace(/\$\{\{\s*github\.event\.inputs\.expected_sha\s*\}\}/g, expectedSha);
  const left = out.match(/\$\{\{[^}]*\}\}/);
  if (left) throw new Error(`unrendered expression ${left[0]}: teach this test what it means`);
  return out;
}

const GRACE = WORKFLOW_TEXT.match(/GRACE_MINUTES:\s*"(\d+)"/)?.[1];
const RESOLVE = stepScript(WORKFLOW_TEXT, "Resolve the expected release");

const baseEnv = (() => {
  const env = prepareAgentChildEnv(process.env);
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = [dirname(process.execPath), env[pathKey] ?? ""].join(delimiter);
  return env;
})();
const HAS_BASH = spawnSync("bash", ["-c", "mapfile -t x <<< ok && date -u -d '-1 minutes' +%s"], { env: baseEnv }).status === 0;

/**
 * A scratch repo holding the real script and railway.ts, plus one commit per
 * entry: { path, minutesAgo }. Returns the commit sha for each entry's label.
 */
function scratchRepo(entries, { railwayTs = RAILWAY_TS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-drift-"));
  const globalCfg = join(dir, ".gitconfig-empty");
  writeFileSync(globalCfg, "");
  const env = { ...baseEnv, GIT_CONFIG_GLOBAL: globalCfg, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args, extra = {}) => {
    const r = spawnSync("git", args, { cwd: dir, env: { ...env, ...extra }, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const now = Math.floor(Date.now() / 1000);
  const commit = (paths, message, minutesAgo) => {
    git(["add", "--", ...paths]);
    const date = `@${now - minutesAgo * 60} +0000`;
    const noHooks = `core.hooksPath=${join(dir, ".no-hooks")}`;
    git(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", noHooks, "commit", "-q", "-m", message], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    return git(["rev-parse", "HEAD"]);
  };
  const put = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  git(["init", "-q"]);
  put(SCRIPT_REL, readFileSync(join(REPO, SCRIPT_REL), "utf8"));
  put(RAILWAY_REL, railwayTs);
  commit([SCRIPT_REL, RAILWAY_REL], "base", 14 * 24 * 60);
  const sha = {};
  entries.forEach((e, i) => {
    put(e.path, `change ${i}\n`);
    sha[e.label ?? e.path] = commit([e.path], e.label ?? e.path, e.minutesAgo);
  });
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const run = (opts = {}) => {
    const out = join(dir, ".github-output");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-c", render(RESOLVE, opts)], {
      cwd: dir,
      env: { ...env, GITHUB_OUTPUT: out, GRACE_MINUTES: GRACE },
      encoding: "utf8",
    });
    const outputs = Object.fromEntries(
      readFileSync(out, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, outputs };
  };
  return { sha, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── The translation, as pure functions ────────────────────────────────────

test("a gitignore-style watch pattern becomes the git pathspec with the same reach", () => {
  assert.equal(toPathspec("apps/statenour/**"), ":(glob)apps/statenour/**");
  assert.equal(toPathspec("package.json"), ":(glob)**/package.json"); // no slash: any depth
  assert.equal(toPathspec("/turbo.json"), ":(glob)turbo.json"); // leading slash: root only
  assert.equal(toPathspec("dist/"), ":(glob)**/dist"); // trailing slash only: any depth
  assert.equal(toPathspec("!apps/x/docs/*.md"), ":(exclude,glob)apps/x/docs/*.md");
  assert.throws(() => toPathspec(""), /empty watch pattern/);
  assert.throws(() => toPathspec("!/"), /empty watch pattern/);
});

test("a list it cannot translate safely is refused, never narrowed", () => {
  assert.throws(() => toPathspecs([]), /no watch patterns/);
  assert.throws(() => toPathspecs(["!apps/x/docs/**"]), /no include pattern/);
  // gitignore lets the later line re-include what the negation removed; a git
  // exclude pathspec would drop it, so the observer would expect too little.
  assert.throws(() => toPathspecs(["apps/x/**", "!apps/x/docs/**", "apps/x/docs/keep/**"]), /follows a negation/);
  assert.deepEqual(toPathspecs(["apps/x/**", "!apps/x/docs/*.md"]), [":(glob)apps/x/**", ":(exclude,glob)apps/x/docs/*.md"]);
});

test("watchPatterns reads only the named service's own list", () => {
  const src = 'service("a", { build: { watchPatterns: ["a/**"] } });\nservice("b", { build: { watchPatterns: ["b/**"] } });';
  assert.deepEqual(watchPatterns(src, "a"), ["a/**"]);
  assert.deepEqual(watchPatterns(src, "b"), ["b/**"]);
  assert.equal(watchPatterns(src, "c"), null);
  assert.equal(watchPatterns('service("a", { build: { watchPatterns: [X] } });', "a"), null);
  // A service without a list must not borrow the next service's.
  assert.equal(watchPatterns('service("a", { build: {} });\nservice("b", { build: { watchPatterns: ["b/**"] } });', "a"), null);
});

test("statenour-web's real list translates, and it is the service's own", () => {
  const patterns = watchPatterns(RAILWAY_TS, SERVICE);
  assert.ok(patterns, `no ${SERVICE} watchPatterns in ${RAILWAY_REL}`);
  assert.ok(patterns.includes("apps/statenour/**"), patterns.join(", "));
  assert.ok(toPathspecs(patterns).length === patterns.length);
  assert.notDeepEqual(patterns, watchPatterns(RAILWAY_TS, "MAINnicks-tire-auto"));
});

// ── The workflow step itself, executed ────────────────────────────────────

test("the step is the one this test executes", () => {
  assert.ok(GRACE, "GRACE_MINUTES not found in deploy-drift.yml");
  assert.match(RESOLVE, /node scripts\/ci\/railway-watch-pathspecs\.mjs statenour-web/);
  assert.match(RESOLVE, /git log origin\/main --format='%H %ct' -- "\$\{pathspecs\[@\]\}"/);
});

test("2026-10-01 replay: a nickstire-only package edit is not a statenour release", { skip: !HAS_BASH && "bash with mapfile and GNU date is required" }, () => {
  // The precondition the replay depends on: statenour-web does not watch it.
  assert.ok(!watchPatterns(RAILWAY_TS, SERVICE).some((p) => p.startsWith("packages/meta-ads-architect")));
  const repo = scratchRepo([
    { label: "statenour", path: "apps/statenour/app/page.tsx", minutesAgo: 240 },
    { label: "meta-ads", path: "packages/meta-ads-architect/src/generator/prompts.ts", minutesAgo: 180 },
    { label: "nickstire", path: "apps/nickstire/server/routes/x.ts", minutesAgo: 120 },
  ]);
  try {
    const r = repo.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.outputs.sha, repo.sha.statenour, `picked ${r.outputs.sha}\n${r.stdout}${r.stderr}`);
  } finally {
    repo.cleanup();
  }
});

test("every pattern statenour-web watches selects its commit, a nested manifest included", { skip: !HAS_BASH && "bash with mapfile and GNU date is required" }, () => {
  const probes = [];
  for (const p of watchPatterns(RAILWAY_TS, SERVICE)) {
    if (p.startsWith("!")) continue;
    if (p.endsWith("/**")) probes.push(`${p.slice(0, -3)}/probe-file.ts`);
    else if (!p.includes("/")) probes.push(p, `apps/nickstire/${p}`);
    else probes.push(p);
  }
  assert.ok(probes.includes("apps/nickstire/package.json"), "the any-depth case is not being probed");
  const missed = [];
  for (const probe of probes) {
    const repo = scratchRepo([
      { label: "older", path: "apps/statenour/older.ts", minutesAgo: 300 },
      { label: "probe", path: probe, minutesAgo: 200 },
      { label: "unwatched", path: "docs/notes.md", minutesAgo: 100 },
    ]);
    try {
      const r = repo.run();
      if (r.status !== 0 || r.outputs.sha !== repo.sha.probe) missed.push(`${probe} (exit ${r.status}) ${r.stderr.trim()}`);
    } finally {
      repo.cleanup();
    }
  }
  assert.deepEqual(missed, [], `watched paths that did not select their commit:\n${missed.join("\n")}`);
});

test("an unreadable list fails the step and records no release", { skip: !HAS_BASH && "bash with mapfile and GNU date is required" }, () => {
  const broken = RAILWAY_TS.replace(`service("${SERVICE}"`, 'service("renamed-web"');
  assert.notEqual(broken, RAILWAY_TS);
  const repo = scratchRepo([{ label: "statenour", path: "apps/statenour/app/page.tsx", minutesAgo: 240 }], { railwayTs: broken });
  try {
    const r = repo.run();
    assert.notEqual(r.status, 0, `the step passed without a watch list\n${r.stdout}`);
    assert.equal(r.outputs.sha, undefined);
    assert.match(r.stderr, /no watchPatterns for service "statenour-web"/);
  } finally {
    repo.cleanup();
  }
});

test("the grace window, the operator pin and 'nothing to compare' still hold", { skip: !HAS_BASH && "bash with mapfile and GNU date is required" }, () => {
  const repo = scratchRepo([
    { label: "settled", path: "apps/statenour/a.ts", minutesAgo: 240 },
    { label: "building", path: "apps/statenour/b.ts", minutesAgo: Math.max(1, Number(GRACE) - 15) },
  ]);
  try {
    assert.equal(repo.run().outputs.sha, repo.sha.settled);
    const pin = "a".repeat(40);
    const pinned = repo.run({ expectedSha: pin });
    assert.equal(pinned.status, 0);
    assert.equal(pinned.outputs.sha, pin);
  } finally {
    repo.cleanup();
  }
  const quiet = scratchRepo([{ label: "nickstire", path: "apps/nickstire/server/x.ts", minutesAgo: 240 }]);
  try {
    const r = quiet.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.outputs.sha, "none");
  } finally {
    quiet.cleanup();
  }
});

test("the worker check runs after a failed drift check", () => {
  const keys = stepKeys(WORKFLOW_TEXT, "Worker liveness from persisted private-worker receipt");
  assert.ok(keys.includes("if: ${{ !cancelled() }}"), keys.join("\n"));
});
