/**
 * Canary for test.yml's `changes` job (2026-09-23): the path filter that decides
 * whether the `node` test job runs at all.
 *
 * With a token, dorny/paths-filter lists a PR's files through the GitHub API; when
 * the repo's per-hour budget ran out, `changes` 403'd and `node` was SKIPPED, so no
 * PR showed a test result. The fix has two inputs, and either one breaking is silent:
 *   - `token: ''`   — without it v4 goes back to the API (src/main.ts, pinned SHA);
 *   - `base: <sha>` — the PR merge commit's FIRST parent. The default (the payload's
 *     base.sha) can lag main, and HEAD^2 is the PR head, not the base: both select
 *     the wrong files, which can skip `node` on a PR that needed it.
 *
 * This runs the workflow's OWN base-resolution script (extracted verbatim from
 * test.yml) against a fixture shaped like GitHub's refs/pull/N/merge, then diffs
 * exactly as paths-filter does. Every MUTATION arm breaks one input in a copy of the
 * real YAML and asserts the checker names it. The CI log for #2627 shows the real
 * action on this wiring: "GitHub token is not available - changes will be detected
 * using git diff" and "Detected 10 changed files" (= that PR's diff).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEST_YML = resolve(HERE, "..", "..", ".github", "workflows", "test.yml");
const REAL = readFileSync(TEST_YML, "utf8");

/** Lines of the step (a `- ` list item) containing line index `i`. */
function stepAround(lines, i) {
  let start = i;
  while (start > 0 && !/^\s*- /.test(lines[start])) start--;
  const indent = lines[start].match(/^(\s*)-/)[1].length;
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (l.trim() && l.match(/^(\s*)/)[1].length <= indent) break;
    end++;
  }
  return lines.slice(start, end);
}

/** `key: value` inside a step, unquoted of one layer of '' or "". */
function field(step, key) {
  const line = step.find((l) => new RegExp(`^\\s*${key}:`).test(l));
  if (!line) return undefined;
  return line.replace(new RegExp(`^\\s*${key}:\\s?`), "").trim();
}

/** The body of a `run: |` block scalar in a step. */
function runBlock(step) {
  const i = step.findIndex((l) => /^\s*run:\s*\|/.test(l));
  if (i < 0) return null;
  const keyIndent = step[i].match(/^(\s*)/)[1].length;
  const body = [];
  for (const l of step.slice(i + 1)) {
    if (l.trim() && l.match(/^(\s*)/)[1].length <= keyIndent) break;
    body.push(l);
  }
  const bodyIndent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)[1].length));
  return body.map((l) => l.slice(bodyIndent)).join("\n");
}

function cleanEnv() {
  // Hooks inherit GIT_DIR/GIT_INDEX_FILE; a fixture git under them hits the real .git.
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}

/** Fixture shaped like refs/pull/N/merge: first parent = main's tip AFTER main moved
 * on past the PR's fork point; second parent = the PR head. */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "path-filter-git-"));
  const git = (c) => execSync(`git ${c}`, { cwd: dir, encoding: "utf8", env: cleanEnv() }).trim();
  git("init -q -b main");
  git('config user.email "t@x.com"');
  git('config user.name "t"');
  writeFileSync(join(dir, "base.txt"), "0");
  git("add -A");
  git("commit -q -m fork-point");
  const forkPoint = git("rev-parse HEAD"); // what a stale payload base.sha points at
  git("checkout -q -b pr");
  writeFileSync(join(dir, "pr-change.txt"), "pr");
  git("add -A");
  git("commit -q -m pr");
  git("checkout -q main");
  writeFileSync(join(dir, "main-moved-on.txt"), "main");
  git("add -A");
  git("commit -q -m main-advanced");
  git("merge -q --no-ff --no-edit pr");
  return { dir, git, forkPoint };
}

/** Returns a list of problems with the workflow's git-based detection; [] = healthy. */
function checkPathFilter(yml, fixture) {
  const problems = [];
  const lines = yml.split("\n");
  const pfAt = lines.findIndex((l) => /uses:\s*dorny\/paths-filter@/.test(l));
  if (pfAt < 0) return ["no dorny/paths-filter step found in test.yml"];
  const pf = stepAround(lines, pfAt);

  const token = field(pf, "token");
  if (token !== "''" && token !== '""') {
    problems.push(`paths-filter token is ${token === undefined ? "unset (defaults to github.token)" : token} — it will list PR files through the API`);
  }

  const base = field(pf, "base");
  const baseStepId = base?.match(/^\$\{\{\s*steps\.([\w-]+)\.outputs\.sha\s*\}\}$/)?.[1];
  if (!baseStepId) {
    problems.push(`paths-filter base is ${base ?? "unset"} — expected \${{ steps.<id>.outputs.sha }} from the merge-commit step; the default (payload base.sha) can lag main`);
    return problems;
  }
  const idAt = lines.findIndex((l) => new RegExp(`^\\s*id:\\s*${baseStepId}\\s*$`).test(l));
  if (idAt < 0) return [...problems, `no step has id ${baseStepId}`];
  const baseStep = stepAround(lines, idAt);
  if (idAt > pfAt) problems.push(`step ${baseStepId} runs AFTER paths-filter, so its output is empty`);
  const script = runBlock(baseStep);
  if (!script) return [...problems, `step ${baseStepId} has no run: | block`];

  const out = join(fixture.dir, ".gh-output");
  const runScript = (ref) => {
    fixture.git(`checkout -q --detach ${ref}`);
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", script], { cwd: fixture.dir, encoding: "utf8", env: { ...cleanEnv(), GITHUB_OUTPUT: out } });
    const sha = readFileSync(out, "utf8").match(/^sha=(\S+)$/m)?.[1];
    return { status: r.status, sha };
  };

  // Healthy: at the merge commit, the resolved base must select EXACTLY the PR's files.
  const merged = runScript("main");
  if (merged.status !== 0 || !merged.sha) {
    problems.push(`step ${baseStepId} did not output sha= at a PR merge commit (exit ${merged.status})`);
  } else {
    const files = fixture.git(`diff --name-only ${merged.sha} HEAD`).split("\n").filter(Boolean);
    if (JSON.stringify(files) !== JSON.stringify(["pr-change.txt"])) {
      problems.push(`the resolved base selects ${JSON.stringify(files)}, not exactly the PR's ["pr-change.txt"]`);
    }
  }
  // Not a merge commit: must refuse loudly, never diff against a wrong parent.
  const plain = runScript("pr");
  if (plain.status === 0) problems.push(`step ${baseStepId} accepted a non-merge HEAD (output ${plain.sha ?? "nothing"}) instead of failing`);
  return problems;
}

test("bash is available — this canary must not silently self-disable", () => {
  assert.equal(spawnSync("bash", ["-c", "true"]).status, 0);
});

test("fixture control: a stale payload base.sha (the paths-filter default) WOULD sweep in main's newer files", (t) => {
  const f = makeFixture();
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  const files = f.git(`diff --name-only ${f.forkPoint} main`).split("\n").filter(Boolean);
  assert.deepEqual(files, ["main-moved-on.txt", "pr-change.txt"], "the fixture must be able to tell a wrong base from the right one");
});

test("HEALTHY: the real test.yml detects a PR's files with git (no token) against the merge commit's first parent", (t) => {
  const f = makeFixture();
  t.after(() => rmSync(f.dir, { recursive: true, force: true }));
  assert.deepEqual(checkPathFilter(REAL, f), []);
});

const MUTATIONS = [
  ["token line removed -> back to the API", (y) => y.replace(/^\s*token: ''\n/m, ""), /token is unset/],
  ["token restored to github.token", (y) => y.replace(/^(\s*)token: ''$/m, "$1token: $${{ github.token }}"), /token is \$\{\{ github\.token \}\}/],
  ["base input removed -> stale payload base.sha", (y) => y.replace(/^\s*base: \$\{\{ steps\.prbase\.outputs\.sha \}\}\n/m, ""), /base is unset/],
  ["first parent swapped for the PR head", (y) => y.replace('echo "sha=$(git rev-parse HEAD^1)"', 'echo "sha=$(git rev-parse HEAD^2)"'), /selects \["main-moved-on\.txt"\]/],
  ["merge-commit guard removed", (y) => y.replace(/^.*git rev-parse --verify -q HEAD\^2.*\n/m, ""), /accepted a non-merge HEAD/],
];

for (const [label, mutate, expected] of MUTATIONS) {
  test(`MUTATION · ${label} is caught`, (t) => {
    const mutated = mutate(REAL);
    assert.notEqual(mutated, REAL, "the mutation did not apply — the real YAML changed shape; update this arm");
    const f = makeFixture();
    t.after(() => rmSync(f.dir, { recursive: true, force: true }));
    const problems = checkPathFilter(mutated, f);
    assert.ok(problems.some((p) => expected.test(p)), `expected a problem matching ${expected}, got ${JSON.stringify(problems)}`);
  });
}
