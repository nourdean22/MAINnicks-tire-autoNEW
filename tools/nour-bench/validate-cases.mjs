#!/usr/bin/env node
/**
 * tools/nour-bench/validate-cases.mjs - NOUR-Bench case validator (2026-10-09).
 *
 * WHY THIS EXISTS. cases.jsonl pins each case to real history: an agent starts
 * at base_commit and is graded by the tests the fix (source_commit) added or
 * changed (the grader copies those test files from source_commit over the
 * agent's tree; README.md "Running a case's verify commands"). Nothing checked
 * that pinning. The first run of this validator found
 * two of the five seed cases with base_commit set to the source's GRANDPARENT,
 * so the "pre-change" tree was missing an unrelated commit and the case diff
 * carried two changes, not one. A typo'd SHA, a test path that never existed,
 * or a verify command that cannot run would each have scored as a broken model,
 * not a broken case.
 *
 * THE VERIFY COMMAND FORM CHANGED THE SAME DAY. The seed cases used
 * `corepack pnpm exec vitest run apps/<app>/<path>`. Run from the repo root that
 * fails before any test loads: the root package has no vitest, so pnpm prints
 * ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL 'Command "vitest" not found' (exit 1). Run
 * from apps/<app> it fails too: vitest resolves the repo-relative filter against
 * the app directory and prints "No test files found" (exit 1). Measured on this
 * repo, 2026-10-09, vitest 3.2.7. Every model would have failed every vitest case.
 * The one form that runs from the repo root is
 *   corepack pnpm --dir apps/<app> exec vitest run <app-relative test paths>
 * (pnpm --dir runs vitest inside the app, where its own config and binary live).
 * node:test files keep `node --test <repo-relative test paths>`. EVERY verify
 * command runs from the repository root.
 *
 * WHAT IT CHECKS, per line of the cases file:
 *   - the line is JSON, a plain object, with exactly the schema fields
 *     {id, difficulty, base_commit, source_commit, task, acceptance[], verify[]}
 *     and the right types (full 40-hex SHAs, difficulty easy|medium|hard,
 *     1-3 acceptance bullets, at least one verify command);
 *   - ids are unique across the file, on any two lines;
 *   - both SHAs are commits in this repository (git cat-file -e);
 *   - base_commit is the FIRST parent of source_commit (a merge's second parent
 *     is rejected, and the message says it is off the first-parent line);
 *   - each verify command is one of the two forms above, followed only by plain
 *     relative test-file paths (app-relative after --dir, repo-relative after
 *     node --test), and every path exists at source_commit;
 *   - a vitest command's app declares vitest in its package.json at source_commit
 *     (pnpm --dir apps/worker exec vitest finds no vitest: the worker has none);
 *   - a node:test file is not run under vitest, and a node --test file must
 *     import node:test. Merely "not importing vitest" is not enough: with vitest
 *     `globals: true` (statenour) a vitest file can have no vitest import at all.
 *     A test file that cannot be read is an ERROR, never "no imports";
 *   - whether each test path is added, changed or IDENTICAL between base and
 *     source. Identical is a warning: the case grades on a test the fix did not
 *     touch, so it probably passes before any work is done.
 *
 * WHAT IT DOES NOT DO: check out old commits, run any case's tests, evaluate an
 * app's vitest `include` globs, or touch the network. Every git call is
 * read-only and passes argv (no shell).
 *
 * USAGE (from anywhere inside the repo)
 *   node tools/nour-bench/validate-cases.mjs                 validate tools/nour-bench/cases.jsonl
 *   node tools/nour-bench/validate-cases.mjs --cases <file>  validate another file
 *   node tools/nour-bench/validate-cases.mjs --self-test     plant defects; exit 1 if ANY is accepted
 * Exit codes: 0 = no errors (warnings allowed); 1 = errors, or a self-test failure; 2 = usage error.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REQUIRED_FIELDS = Object.freeze([
  "id",
  "difficulty",
  "base_commit",
  "source_commit",
  "task",
  "acceptance",
  "verify",
]);
export const DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);
/**
 * Recognised verify runners. A command is the prefix tokens, then one or more test paths. A null
 * prefix token is the app directory (`apps/<app>`); the paths after it are relative to that app.
 */
export const RUNNERS = Object.freeze([
  Object.freeze({
    name: "vitest",
    prefix: Object.freeze(["corepack", "pnpm", "--dir", null, "exec", "vitest", "run"]),
    form: "corepack pnpm --dir apps/<app> exec vitest run <app-relative test paths>",
  }),
  Object.freeze({
    name: "node-test",
    prefix: Object.freeze(["node", "--test"]),
    form: "node --test <repo-relative test paths>",
  }),
]);
export const MAX_ACCEPTANCE = 3;

const SHA40 = /^[0-9a-f]{40}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APP_DIR_RE = /^apps\/[a-z0-9][a-z0-9._-]*$/;
const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const IMPORTS_NODE_TEST = /(?:from\s*["']node:test["']|require\(\s*["']node:test["']\s*\))/;
const IMPORTS_VITEST = /(?:from\s*["']vitest["']|require\(\s*["']vitest["']\s*\))/;
/** The pre-2026-10-09 form: vitest from the repo root, which has no vitest. */
const ROOT_VITEST_PREFIX = Object.freeze(["corepack", "pnpm", "exec", "vitest"]);

/**
 * Read-only git accessor rooted at `cwd`. Every call is argv-based and cached.
 * Injected into validateCasesText so a caller (or a test) can substitute a fake.
 */
export function makeGit(cwd) {
  const cache = new Map();
  const env = { ...process.env, GIT_LITERAL_PATHSPECS: "1" };
  const run = (args) => {
    const key = args.join("\0");
    if (cache.has(key)) return cache.get(key);
    let out;
    try {
      out = {
        ok: true,
        stdout: execFileSync("git", args, {
          cwd,
          env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer: 64 * 1024 * 1024,
        }),
      };
    } catch {
      out = { ok: false, stdout: "" };
    }
    cache.set(key, out);
    return out;
  };
  return {
    /** true when `sha` names a commit object in this repository. */
    commitExists(sha) {
      return run(["cat-file", "-e", `${sha}^{commit}`]).ok;
    },
    /** The first parent's full SHA, or null for a root commit / unknown commit. */
    firstParent(sha) {
      const r = run(["rev-list", "--parents", "-n", "1", sha]);
      if (!r.ok) return null;
      return r.stdout.trim().split(/\s+/)[1] ?? null;
    },
    /**
     * N when `ancestor` is exactly N first-parent steps behind `sha` (sha~N), else null.
     * `merge-base --is-ancestor` alone is not enough: it follows every parent, so a merge's
     * second parent would get a distance it does not have.
     */
    firstParentDistance(ancestor, sha) {
      const r = run(["rev-list", "--count", "--first-parent", `${ancestor}..${sha}`]);
      if (!r.ok) return null;
      const n = Number(r.stdout.trim());
      if (!Number.isInteger(n) || n < 1) return null;
      const at = run(["rev-parse", "--verify", "--quiet", `${sha}~${n}^{commit}`]);
      return at.ok && at.stdout.trim() === ancestor ? n : null;
    },
    /** true when `<sha>:<path>` names an object (git cat-file -e). */
    pathExists(sha, p) {
      return run(["cat-file", "-e", `${sha}:${p}`]).ok;
    },
    /** The blob id of `<sha>:<path>`, or null when absent or not a file. */
    blobId(sha, p) {
      const r = run(["ls-tree", "--full-tree", sha, "--", p]);
      if (!r.ok) return null;
      const m = /^\d+ (\w+) ([0-9a-f]+)\t/.exec(r.stdout);
      return m && m[1] === "blob" ? m[2] : null;
    },
    /** The text of a blob, or null when it cannot be read. */
    blobText(blob) {
      const r = run(["cat-file", "blob", blob]);
      return r.ok ? r.stdout : null;
    },
  };
}

/** The repository root that contains this script (falls back to the cwd). */
export function repoRoot(from = HERE) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: from,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

const startsWith = (tokens, prefix) => prefix.every((t, i) => t === null ? tokens[i] !== undefined : tokens[i] === t);
const isPlainRelative = (p) =>
  !(/^[\\/]/.test(p) || /^[A-Za-z]:/.test(p) || p.includes("\\") || p.split("/").includes("..") || p.startsWith("./"));

/**
 * Parse one verify command. Returns { runner, appDir, paths, problems }: runner is a RUNNERS name
 * or null; appDir is the vitest app (`apps/<app>`) or null; paths are REPO-relative (an app-relative
 * vitest path is joined onto its app); problems is a list of strings (empty = well formed).
 */
export function parseVerifyCommand(cmd) {
  const problems = [];
  const none = (msg) => ({ runner: null, appDir: null, paths: [], problems: [msg] });
  if (typeof cmd !== "string" || cmd.trim() === "") return none("is not a non-empty string");
  const tokens = cmd.trim().split(/\s+/);
  if (startsWith(tokens, ROOT_VITEST_PREFIX)) {
    return none(
      `runs vitest from the repo root, which has no vitest (pnpm: Command "vitest" not found); use "${RUNNERS[0].form}"`,
    );
  }
  const runner = RUNNERS.find((r) => startsWith(tokens, r.prefix));
  if (!runner) return none(`uses an unrecognised runner; expected one of: ${RUNNERS.map((r) => `"${r.form}"`).join(", ")}`);

  const dirAt = runner.prefix.indexOf(null);
  const appDir = dirAt >= 0 ? tokens[dirAt] : null;
  if (appDir !== null && !APP_DIR_RE.test(appDir)) {
    problems.push(`--dir must name an app directory (apps/<app>), got ${appDir}`);
  }
  const raw = tokens.slice(runner.prefix.length);
  if (raw.length === 0) problems.push("names no test path");
  const paths = [];
  for (const p of raw) {
    if (p.startsWith("-")) problems.push(`passes a flag (${p}); only test paths may follow the runner`);
    else if (!isPlainRelative(p)) problems.push(`path ${p} is not a plain relative path (forward slashes, no leading ./ or /, no ..)`);
    else if (appDir !== null && p.startsWith(`${appDir}/`)) {
      problems.push(
        `path ${p} is repo-relative, but vitest under --dir ${appDir} resolves paths from ${appDir}, so it matches no test file (use ${p.slice(appDir.length + 1)})`,
      );
    } else if (!TEST_FILE_RE.test(p)) problems.push(`path ${p} is not a test file (*.test.* or *.spec.*)`);
    else paths.push(appDir === null ? p : `${appDir}/${p}`);
  }
  return { runner: runner.name, appDir, paths, problems };
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const short = (sha) => (typeof sha === "string" ? sha.slice(0, 12) : String(sha));

/** null when `appDir` declares vitest at `sha`; otherwise why `pnpm --dir appDir exec vitest` cannot run. */
function vitestProblem(git, sha, appDir) {
  const manifest = `${appDir}/package.json`;
  const blob = git.blobId(sha, manifest);
  if (blob === null) return `${manifest} does not exist at source_commit ${short(sha)}, so "pnpm --dir ${appDir}" has no package to run vitest in`;
  const text = git.blobText(blob);
  if (text === null) return `could not read ${manifest} at source_commit ${short(sha)}; whether vitest runs there was not verified`;
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return `${manifest} at source_commit ${short(sha)} is not valid JSON; whether vitest runs there was not verified`;
  }
  const declared = ["dependencies", "devDependencies"].some((k) => isPlainObject(pkg?.[k]) && "vitest" in pkg[k]);
  return declared
    ? null
    : `${appDir} does not declare vitest at source_commit ${short(sha)} (no vitest in its package.json dependencies), so "corepack pnpm --dir ${appDir} exec vitest" finds no vitest`;
}

/**
 * Validate the text of a cases file.
 * Returns { errors, warnings, cases }:
 *   errors / warnings: [{ line, id, message }]  (line is 1-based; id may be null)
 *   cases: [{ line, id, difficulty, tests: [{ path, runner, appDir, status }] }] for every line that
 *          parsed; path is repo-relative; status is "added" | "changed" | "identical" | "missing" | "unchecked".
 */
export function validateCasesText(text, { git } = {}) {
  if (!git) throw new Error("validateCasesText needs { git } (see makeGit)");
  const errors = [];
  const warnings = [];
  const cases = [];
  const firstLineOfId = new Map();
  let body = String(text);
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1); // a BOM is not part of line 1's JSON
  const lines = body.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) errors.push({ line: 0, id: null, message: "the file has no cases" });

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const err = (id, message) => errors.push({ line, id, message });
    const warn = (id, message) => warnings.push({ line, id, message });

    if (raw.trim() === "") return err(null, "blank line (JSONL needs one case per line)");
    let c;
    try {
      c = JSON.parse(raw);
    } catch (e) {
      return err(null, `not valid JSON (${e.message})`);
    }
    if (!isPlainObject(c)) return err(null, "is not a JSON object");

    const id = nonEmptyString(c.id) ? c.id : null;
    for (const f of REQUIRED_FIELDS) if (!(f in c)) err(id, `missing required field "${f}"`);
    for (const k of Object.keys(c)) if (!REQUIRED_FIELDS.includes(k)) err(id, `unknown field "${k}" (schema is ${REQUIRED_FIELDS.join(", ")})`);

    if ("id" in c) {
      if (typeof c.id !== "string" || !ID_RE.test(c.id)) err(id, `id must be a lowercase kebab-case string, got ${JSON.stringify(c.id)}`);
      else if (firstLineOfId.has(c.id)) err(id, `duplicate id "${c.id}" (first used on line ${firstLineOfId.get(c.id)})`);
      else firstLineOfId.set(c.id, line);
    }
    if ("difficulty" in c && !DIFFICULTIES.includes(c.difficulty)) {
      err(id, `difficulty must be one of ${DIFFICULTIES.join("|")}, got ${JSON.stringify(c.difficulty)}`);
    }
    for (const f of ["base_commit", "source_commit"]) {
      if (f in c && (typeof c[f] !== "string" || !SHA40.test(c[f]))) {
        err(id, `${f} must be a full 40-hex lowercase SHA, got ${JSON.stringify(c[f])}`);
      }
    }
    if ("task" in c && !nonEmptyString(c.task)) err(id, "task must be a non-empty string");
    if ("acceptance" in c) {
      const a = c.acceptance;
      if (!Array.isArray(a) || a.length < 1 || a.length > MAX_ACCEPTANCE || !a.every(nonEmptyString)) {
        err(id, `acceptance must be a list of 1-${MAX_ACCEPTANCE} non-empty strings`);
      }
    }

    /** @type {{path: string, runner: string, appDir: string|null}[]} */
    const tests = [];
    if ("verify" in c) {
      if (!Array.isArray(c.verify) || c.verify.length === 0) err(id, "verify must be a non-empty list of commands");
      else {
        c.verify.forEach((cmd, i) => {
          const parsed = parseVerifyCommand(cmd);
          for (const p of parsed.problems) err(id, `verify[${i}] ${p}`);
          if (parsed.problems.length === 0) for (const p of parsed.paths) tests.push({ path: p, runner: parsed.runner, appDir: parsed.appDir });
        });
      }
    }

    // --- git: commits, first parent, test paths -------------------------------------------
    const summary = { line, id, difficulty: c.difficulty, tests: tests.map((t) => ({ ...t, status: "unchecked" })) };
    cases.push(summary);
    const base = typeof c.base_commit === "string" && SHA40.test(c.base_commit) ? c.base_commit : null;
    const source = typeof c.source_commit === "string" && SHA40.test(c.source_commit) ? c.source_commit : null;
    const baseOk = base !== null && git.commitExists(base);
    const sourceOk = source !== null && git.commitExists(source);
    if (base !== null && !baseOk) err(id, `base_commit ${short(base)} is not a commit in this repository`);
    if (source !== null && !sourceOk) err(id, `source_commit ${short(source)} is not a commit in this repository`);
    if (baseOk && sourceOk) {
      const parent = git.firstParent(source);
      if (parent !== base) {
        const dist = base === source ? null : git.firstParentDistance(base, source);
        const hint =
          base === source
            ? "base_commit equals source_commit"
            : dist === null
              ? "base_commit is not on source_commit's first-parent line (a merge's second parent, or another branch)"
              : `base_commit is ${dist} first-parent commits back`;
        err(id, `base_commit ${short(base)} is not the first parent of source_commit ${short(source)} (first parent is ${short(parent ?? "none")}; ${hint})`);
      }
    }
    if (!sourceOk) return;
    const appsChecked = new Set();
    for (const t of summary.tests) {
      if (t.appDir !== null && !appsChecked.has(t.appDir)) {
        appsChecked.add(t.appDir);
        const problem = vitestProblem(git, source, t.appDir);
        if (problem) err(id, problem);
      }
      if (!git.pathExists(source, t.path)) {
        t.status = "missing";
        err(id, `verify test path ${t.path} does not exist at source_commit ${short(source)}`);
        continue;
      }
      const srcBlob = git.blobId(source, t.path);
      if (srcBlob === null) {
        t.status = "missing";
        err(id, `verify test path ${t.path} is not a file at source_commit ${short(source)}`);
        continue;
      }
      const baseBlob = baseOk ? git.blobId(base, t.path) : null;
      t.status = !baseOk ? "unchecked" : baseBlob === null ? "added" : baseBlob === srcBlob ? "identical" : "changed";
      if (t.status === "identical") {
        warn(id, `verify test path ${t.path} is identical at base_commit and source_commit; the fix did not touch it, so it likely passes before any work`);
      }
      const testBody = git.blobText(srcBlob);
      if (testBody === null) {
        err(id, `could not read verify test ${t.path} at source_commit ${short(source)}; its test framework was not checked against the runner`);
        continue;
      }
      if (t.runner === "vitest" && IMPORTS_NODE_TEST.test(testBody) && !IMPORTS_VITEST.test(testBody)) {
        err(id, `verify runs ${t.path} under vitest, but the file imports node:test (use "node --test ${t.path}")`);
      }
      // node --test must be PROVEN to fit: the file has to import node:test. "Does not import vitest"
      // is not enough, because an app with vitest `globals: true` (statenour) has test files that use
      // describe/it/expect with no vitest import at all; node --test cannot run those.
      if (t.runner === "node-test" && IMPORTS_VITEST.test(testBody)) {
        err(id, `verify runs ${t.path} under node --test, but the file imports vitest (use "${RUNNERS[0].form}")`);
      } else if (t.runner === "node-test" && !IMPORTS_NODE_TEST.test(testBody)) {
        err(
          id,
          `verify runs ${t.path} under node --test, but the file does not import node:test (a vitest-globals file has no imports; use "${RUNNERS[0].form}" if it is a vitest test)`,
        );
      }
    }
  });

  return { errors, warnings, cases };
}

/** Human-readable report for a validateCasesText result. ASCII only. */
export function formatReport(result, label) {
  const out = [`NOUR-Bench case validator: ${label}`];
  const byLine = (list, line) => list.filter((e) => e.line === line);
  for (const c of result.cases) {
    const errs = byLine(result.errors, c.line);
    const warns = byLine(result.warnings, c.line);
    const tag = errs.length ? "FAIL" : warns.length ? "WARN" : "ok  ";
    const tests = c.tests.map((t) => `${t.path} (${t.status})`).join(", ") || "no tests";
    out.push(`  ${tag} L${c.line} ${c.id ?? "<no id>"} [${c.difficulty ?? "?"}] ${tests}`);
    for (const e of errs) out.push(`       error: ${e.message}`);
    for (const w of warns) out.push(`       warn:  ${w.message}`);
  }
  const caseLines = new Set(result.cases.map((c) => c.line));
  for (const e of result.errors.filter((x) => !caseLines.has(x.line))) out.push(`  FAIL L${e.line} error: ${e.message}`);

  const count = (key) => {
    const m = new Map();
    for (const c of result.cases) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => `${k} ${v}`).join(", ");
  };
  const statuses = count((c) => c.tests.map((t) => t.status).join("+") || "none");
  out.push(
    `${result.cases.length} cases | difficulty: ${count((c) => c.difficulty ?? "?")} | id prefix: ${count((c) => (c.id ?? "?").split("-")[0])} | test status per case: ${statuses} | ${result.errors.length} errors, ${result.warnings.length} warnings`,
  );
  return out.join("\n");
}

// --- self-test --------------------------------------------------------------------------------

const vitestCmd = (appDir, ...paths) => `corepack pnpm --dir ${appDir} exec vitest run ${paths.join(" ")}`;

/**
 * A real case the self-test builds every plant from: #2647 on main (the statenour-embed-log-001
 * seed). Hard-coded so the self-test does not depend on what cases.jsonl currently holds.
 * Its test is CHANGED between base and source.
 */
export const SELF_TEST_CONTROL = Object.freeze({
  id: "selftest-control-001",
  difficulty: "easy",
  base_commit: "57107f91ca9debbc883811aecead793218603fd1",
  source_commit: "c56da70c189523666fc90dcf245034c719712917",
  task: "Make embedding backfill logs report how many rows were embedded.",
  acceptance: Object.freeze(["bounded backfill log includes embedded row count"]),
  verify: Object.freeze([vitestCmd("apps/statenour", "tests/cron/embed-backfill-bounded.test.ts")]),
});
/** A real case (#2558) whose test is ADDED at source_commit, as most new-feature cases are. */
export const SELF_TEST_ADDED = Object.freeze({
  id: "selftest-added-001",
  difficulty: "medium",
  base_commit: "7d9f4de0077ab02ea15fc718a787c534f6d60d53",
  source_commit: "4531bee53b96869a11e91e0e09c4b8727c1f5706",
  task: "Charge the recall token budget for the characters the recall block renders.",
  acceptance: Object.freeze(["recall trims by rendered characters"]),
  verify: Object.freeze([vitestCmd("apps/statenour", "tests/brain/recall-budget-rendered-chars.test.ts")]),
});
/** A real node:test case (#2776), run with node --test. */
export const SELF_TEST_NODE = Object.freeze({
  id: "selftest-node-001",
  difficulty: "medium",
  base_commit: "b3fbd5628332cdae373d8dc5d153156e5eb79366",
  source_commit: "62e6d0ea0695ba108d89275c73aeb85812e483d7",
  task: "Make the lease-check recovery exception reject a node flag whose value ends in agent-finish.mjs.",
  acceptance: Object.freeze(["a flag-valued agent-finish.mjs path is refused"]),
  verify: Object.freeze(["node --test scripts/agent-os/lease-check.test.mjs"]),
});
/** A vitest file present, unchanged, at both control commits (app-relative to apps/statenour). */
const UNTOUCHED_TEST = "tests/cron/cron-healer.test.ts";
/**
 * A statenour vitest file with NO vitest import (it relies on `globals: true`), present at the
 * control source commit. Under node --test it fails with ERR_MODULE_NOT_FOUND (@/lib); measured
 * 2026-10-09. Repo-relative, for node --test.
 */
const GLOBALS_ONLY_TEST_REPO = "apps/statenour/tests/lib/datetime.test.ts";
const CONTROL_TEST = "tests/cron/embed-backfill-bounded.test.ts";
const CONTROL_TEST_REPO = `apps/statenour/${CONTROL_TEST}`;
/** A merge on main's first-parent line (#1193) and its SECOND parent. */
const MERGE_COMMIT = "c2d3f42eb9d3db7d6c57cf7d8b7b5eda9f0c8beb";
const MERGE_SECOND_PARENT = "51bcfa0fa104db8a2d9d2b09b0b387943452b058";

/**
 * The planted defects. Each `text` is a cases file whose defect is on its LAST line (most follow a
 * valid control line, which also proves later lines are checked); `expect` must match one error.
 * `gitFor`, when present, wraps the real git to simulate a failure history cannot produce.
 */
export function plantedDefects(git) {
  const ctl = { ...SELF_TEST_CONTROL, acceptance: [...SELF_TEST_CONTROL.acceptance], verify: [...SELF_TEST_CONTROL.verify] };
  const L = (o) => JSON.stringify(o);
  const bad = (patch) => {
    const o = { ...ctl, id: "selftest-defect-001", ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete o[k];
    return `${L(ctl)}\n${L(o)}\n`;
  };
  const grandparent = git.firstParent(git.firstParent(ctl.source_commit) ?? "") ?? "f".repeat(40);
  return [
    { name: "bad JSON", text: `${L(ctl)}\n${L(ctl).slice(0, -2)}\n`, expect: /not valid JSON/ },
    { name: "duplicate id (adjacent lines)", text: `${L(ctl)}\n${L(ctl)}\n`, expect: /duplicate id/ },
    {
      name: "duplicate id (lines 1 and 3)",
      text: `${L(ctl)}\n${L({ ...ctl, id: "selftest-other-001" })}\n${L(ctl)}\n`,
      expect: /duplicate id "selftest-control-001" \(first used on line 1\)/,
    },
    { name: "unknown base commit", text: bad({ base_commit: "deadbeef".repeat(5) }), expect: /base_commit \w+ is not a commit/ },
    { name: "unknown source commit", text: bad({ source_commit: "feedface".repeat(5) }), expect: /source_commit \w+ is not a commit/ },
    { name: "wrong parent (base is the grandparent)", text: bad({ base_commit: grandparent }), expect: /not the first parent.*2 first-parent commits back/ },
    { name: "wrong parent (base equals source)", text: bad({ base_commit: ctl.source_commit }), expect: /not the first parent.*equals source_commit/ },
    {
      name: "wrong parent (base is a merge's second parent)",
      text: bad({ base_commit: MERGE_SECOND_PARENT, source_commit: MERGE_COMMIT }),
      expect: /not the first parent.*not on source_commit's first-parent line/,
    },
    {
      name: "missing test path",
      text: bad({ verify: [vitestCmd("apps/statenour", "tests/cron/does-not-exist.test.ts")] }),
      expect: /does not exist at source_commit/,
    },
    { name: "short SHA", text: bad({ base_commit: ctl.base_commit.slice(0, 10) }), expect: /full 40-hex/ },
    { name: "missing field", text: bad({ task: undefined }), expect: /missing required field "task"/ },
    { name: "unknown field", text: bad({ notes: "x" }), expect: /unknown field "notes"/ },
    { name: "bad difficulty", text: bad({ difficulty: "trivial" }), expect: /difficulty must be one of/ },
    { name: "acceptance not a list", text: bad({ acceptance: "x" }), expect: /acceptance must be a list/ },
    { name: "too many acceptance bullets", text: bad({ acceptance: ["a", "b", "c", "d"] }), expect: /acceptance must be a list/ },
    { name: "empty verify", text: bad({ verify: [] }), expect: /verify must be a non-empty list/ },
    { name: "unknown runner", text: bad({ verify: [`pnpm test ${CONTROL_TEST_REPO}`] }), expect: /unrecognised runner/ },
    {
      name: "vitest from the repo root (the seed form)",
      text: bad({ verify: [`corepack pnpm exec vitest run ${CONTROL_TEST_REPO}`] }),
      expect: /runs vitest from the repo root/,
    },
    { name: "--dir that is not an app", text: bad({ verify: [vitestCmd("scripts", "agent-os/x.test.ts")] }), expect: /--dir must name an app directory/ },
    {
      name: "--dir app that has no vitest",
      text: bad({ verify: [vitestCmd("apps/worker", "src/scheduler.test.ts")] }),
      expect: /apps\/worker does not declare vitest/,
    },
    {
      name: "repo-relative path under --dir",
      text: bad({ verify: [vitestCmd("apps/statenour", CONTROL_TEST_REPO)] }),
      expect: /is repo-relative, but vitest under --dir apps\/statenour/,
    },
    {
      name: "runner flag",
      text: bad({ verify: [`corepack pnpm --dir apps/statenour exec vitest run --reporter=dot ${CONTROL_TEST}`] }),
      expect: /passes a flag/,
    },
    { name: "runner/test mismatch (vitest file under node --test)", text: bad({ verify: [`node --test ${CONTROL_TEST_REPO}`] }), expect: /imports vitest/ },
    {
      name: "runner/test mismatch (vitest-globals file, no imports of either, under node --test)",
      text: bad({ verify: [`node --test ${GLOBALS_ONLY_TEST_REPO}`] }),
      expect: /does not import node:test/,
    },
    {
      // No app holds a node:test file in history, so the planted git serves one for the control test.
      name: "runner/test mismatch (node:test file under vitest)",
      text: `${L(ctl)}\n`,
      gitFor: (g) => {
        const target = g.blobId(ctl.source_commit, CONTROL_TEST_REPO);
        return { ...g, blobText: (b) => (b === target ? 'import test from "node:test";\n' : g.blobText(b)) };
      },
      expect: /imports node:test/,
    },
    {
      name: "test blob that cannot be read (empty-vs-error)",
      text: `${L(ctl)}\n`,
      gitFor: (g) => ({ ...g, blobText: () => null }),
      expect: /could not read verify test .* at source_commit/,
    },
    { name: "path escapes the repo", text: bad({ verify: ["node --test ../outside/x.test.mjs"] }), expect: /not a plain relative path/ },
    {
      name: "not a test file",
      text: bad({ verify: [vitestCmd("apps/statenour", "app/api/cron/embed-backfill/route.ts")] }),
      expect: /is not a test file/,
    },
  ];
}

/**
 * Plant every defect and require each to be rejected FOR ITS PLANTED REASON; first prove the
 * instrument can pass (a validator that rejects everything would catch every plant).
 * Returns { ok, lines }.
 */
export function runSelfTest({ git }) {
  const lines = ["NOUR-Bench validator self-test"];
  let ok = true;
  const one = (o) => `${JSON.stringify(o)}\n`;

  const controls = [
    { name: "a real case whose test is CHANGED validates clean", text: one(SELF_TEST_CONTROL), status: ["changed"] },
    { name: "a real case whose test is ADDED at source validates clean", text: one(SELF_TEST_ADDED), status: ["added"] },
    { name: "a real node --test case validates clean", text: one(SELF_TEST_NODE), status: ["added", "changed"] },
    {
      name: "a BOM-prefixed CRLF file validates clean",
      text: `${String.fromCharCode(0xfeff)}${JSON.stringify(SELF_TEST_CONTROL)}\r\n`,
      status: ["changed"],
    },
  ];
  for (const ctl of controls) {
    const r = validateCasesText(ctl.text, { git });
    const status = r.cases[0]?.tests[0]?.status;
    if (r.errors.length || r.warnings.length || !ctl.status.includes(status)) {
      ok = false;
      lines.push(
        `  CONTROL FAILED  ${ctl.name}: errors: ${r.errors.map((e) => e.message).join(" | ") || "none"}; warnings: ${r.warnings.length}; test status: ${status}`,
      );
    } else lines.push(`  CONTROL ok      ${ctl.name} (test ${status})`);
  }

  const ident = validateCasesText(one({ ...SELF_TEST_CONTROL, verify: [vitestCmd("apps/statenour", UNTOUCHED_TEST)] }), { git });
  if (ident.errors.length || !ident.warnings.some((w) => /identical at base_commit and source_commit/.test(w.message))) {
    ok = false;
    lines.push(`  CONTROL FAILED  an untouched test path was not reported as identical (errors: ${ident.errors.length}, warnings: ${ident.warnings.length})`);
  } else lines.push(`  CONTROL ok      an untouched test path warns "identical" and is not an error`);

  const plants = plantedDefects(git);
  let rejected = 0;
  for (const plant of plants) {
    const r = validateCasesText(plant.text, { git: plant.gitFor ? plant.gitFor(git) : git });
    const hit = r.errors.find((e) => plant.expect.test(e.message));
    if (hit) {
      rejected++;
      lines.push(`  REJECTED        ${plant.name} -> ${hit.message}`);
    } else {
      ok = false;
      const seen = r.errors.map((e) => e.message).join(" | ") || "no errors at all";
      lines.push(`  ACCEPTED (BUG)  ${plant.name}: expected an error matching ${plant.expect}; saw: ${seen}`);
    }
  }
  lines.push(
    ok
      ? `self-test passed: ${controls.length + 1} controls ok; ${rejected} of ${plants.length} planted defects rejected, each for its planted reason`
      : `self-test FAILED: ${rejected} of ${plants.length} planted defects rejected for their planted reason`,
  );
  return { ok, lines };
}

// --- CLI --------------------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const usage = "usage: node tools/nour-bench/validate-cases.mjs [--cases <file>] [--self-test]";
  let casesPath = path.join(HERE, "cases.jsonl");
  let selfTest = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--self-test") selfTest = true;
    else if (args[i] === "--cases" && args[i + 1]) casesPath = path.resolve(args[++i]);
    else if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(`${usage}\n`);
      return 0;
    } else {
      process.stderr.write(`unknown argument: ${args[i]}\n${usage}\n`);
      return 2;
    }
  }
  const root = repoRoot();
  const git = makeGit(root);
  if (selfTest) {
    const r = runSelfTest({ git });
    process.stdout.write(`${r.lines.join("\n")}\n`);
    return r.ok ? 0 : 1;
  }
  let text;
  try {
    text = readFileSync(casesPath, "utf8");
  } catch (e) {
    process.stderr.write(`cannot read ${casesPath}: ${e.message}\n`);
    return 2;
  }
  const result = validateCasesText(text, { git });
  const label = path.relative(root, casesPath).split(path.sep).join("/") || casesPath;
  process.stdout.write(`${formatReport(result, label)}\n`);
  return result.errors.length ? 1 : 0;
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
})();
if (invokedDirectly) process.exitCode = main(process.argv);
