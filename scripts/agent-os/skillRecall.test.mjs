// Canary for skill-recall.mjs, the UserPromptSubmit hook that names the skills a prompt should invoke.
// Every control goes through the REAL script as a child process with the stdin JSON the harness sends
// (guard-red-team rule 5), never through an imported function. Mutants are planted by copying the script
// to the OS temp dir with one constant changed and running that copy against the same controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "skill-recall.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const HOME_SKILLS = join(homedir(), ".claude", "skills");
const HOME_PLUGINS = join(homedir(), ".claude", "plugins");
const SCRATCH = mkdtempSync(join(tmpdir(), "skill-recall-test-"));

const ALWAYS_ON = [
  "karpathy-guidelines", "ponytail", "verification-before-completion", "i-have-adhd", "using-superpowers",
  "antislop", "find-skill", "nour-command", "monorepo-manager", "harness-worktree-setup",
  "positive-control-first", "assert-the-consumer", "prior-art-grep",
];

// prompt -> at least one of these names must be printed; `first` means it must be the FIRST line.
// The last control is the name-boost witness: "brainstorming" is a name hit, every other word is a body hit on
// empty-vs-error, which outranks it the moment the boost is gone (measured 2026-10-16: 29.6 vs 12.0 flips).
const CONTROLS = [
  ["fix the Prisma migration for statenour", ["statenour-migration"]],
  ["the reel pipeline is stuck on Instagram", ["nickstire-reel-operator", "nickstire-verifier-reel-pipeline"]],
  ["write a deny-list regex for the pretool hook", ["guard-red-team"]],
  ["merge the three ledger rows", ["session-authority", "stranded-branch-rescue", "statenour-wave-reconcile", "nickstire-shared-main-push"]],
  ["brainstorming report the errors in the code review", ["brainstorming"], { first: true }],
];
const NONSENSE = "zxqv florp wibble quux";

function countSkillFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countSkillFiles(join(dir, e.name));
    else if (e.name === "SKILL.md") n += 1;
  }
  return n;
}

/** Run a script the way the hook runs: cwd = project, CLAUDE_PROJECT_DIR set, no GIT_* env, JSON on stdin. */
function run(args, input, script = SCRIPT, extraEnv = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  env.SKILL_RECALL_CACHE_DIR = join(SCRATCH, "cache");
  Object.assign(env, extraEnv);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: performance.now() - t0 };
}

const hookInput = (prompt) => JSON.stringify({ session_id: "t", cwd: ROOT, hook_event_name: "UserPromptSubmit", prompt });
const hook = (prompt, script, extraEnv) => run([], hookInput(prompt), script, extraEnv);
const named = (out) => [...out.matchAll(/^\[skill-recall\] invoke: (\S+)/gm)].map((m) => m[1]);

function configuredRecall() {
  return (SETTINGS.hooks?.UserPromptSubmit ?? [])
    .flatMap((g) => g.hooks ?? [])
    .find((h) => h.type === "command" && h.command.includes("skill-recall.mjs"));
}

/** The whole contract for one script: every control names an expected skill, nonsense prints the none line, always-on never appears. */
function controlProblems(script = SCRIPT) {
  const problems = [];
  for (const [prompt, expected, opt = {}] of CONTROLS) {
    const r = hook(prompt, script);
    if (r.code !== 0) problems.push(`exit ${r.code} for "${prompt}": ${r.err}`);
    const got = named(r.out);
    const pool = opt.first ? got.slice(0, 1) : got;
    if (!expected.some((e) => pool.includes(e))) problems.push(`"${prompt}" named [${got.join(", ")}], expected one of [${expected.join(", ")}]${opt.first ? " first" : ""}`);
    for (const g of got) if (ALWAYS_ON.includes(g.split(":").pop())) problems.push(`always-on skill ${g} printed for "${prompt}"`);
    if (got.length > 5) problems.push(`${got.length} lines for "${prompt}", cap is 5`);
  }
  const none = hook(NONSENSE, script);
  if (none.code !== 0) problems.push(`exit ${none.code} for nonsense`);
  if (!/^\[skill-recall\] none beyond the always-on set$/m.test(none.out)) problems.push(`nonsense printed: ${JSON.stringify(none.out)}`);
  if (named(none.out).length) problems.push(`nonsense named ${named(none.out).join(", ")}`);
  return problems;
}

test("registered on UserPromptSubmit after the skills-first reminder, forward slashes, project dir variable", () => {
  const hooks = (SETTINGS.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).map((h) => h.command);
  const reminder = hooks.findIndex((c) => c.includes("skills-first-reminder.mjs"));
  const recall = hooks.findIndex((c) => c.includes("skill-recall.mjs"));
  assert.ok(recall >= 0, "skill-recall.mjs is not registered on UserPromptSubmit");
  assert.ok(reminder >= 0 && reminder < recall, "skill-recall must run after skills-first-reminder");
  const cmd = configuredRecall().command;
  assert.doesNotMatch(cmd, /\\/, "a backslash path does not resolve on Linux");
  assert.match(cmd, /"\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/skill-recall\.mjs"/);
});

test("index covers every repo SKILL.md, and the user and plugin roots when they exist", () => {
  const r = run(["--json", "--text", "probe"]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  const repoCount = countSkillFiles(join(ROOT, ".claude", "skills"));
  assert.ok(repoCount >= 50, `repo has ${repoCount} SKILL.md files, expected at least 50`);
  assert.ok(j.index.repo >= repoCount, `indexed ${j.index.repo} repo skills, on disk ${repoCount}`);
  if (existsSync(HOME_SKILLS) && existsSync(HOME_PLUGINS)) {
    assert.ok(j.index.total >= 300, `indexed ${j.index.total} skills with user and plugin roots present, expected >= 300`);
    assert.ok(j.index.user > 0 && j.index.plugin > 0, `user ${j.index.user}, plugin ${j.index.plugin}`);
  }
  assert.ok(j.index.total >= j.index.repo);
});

test("positive controls through the real hook: expected skills named, nonsense gets the none line, always-on filtered", () => {
  assert.deepEqual(controlProblems(), []);
});

test("a prompt that names the always-on skills never prints them", () => {
  const r = hook("run ponytail, karpathy-guidelines, find-skill, nour-command and monorepo-manager with antislop and i-have-adhd");
  assert.equal(r.code, 0, r.err);
  for (const n of named(r.out)) assert.ok(!ALWAYS_ON.includes(n.split(":").pop()), `always-on ${n} printed`);
});

test("--file mode scores a brief and --text matches the hook output", () => {
  const brief = join(SCRATCH, "brief.md");
  writeFileSync(brief, "GOAL: change the statenour Prisma schema and write the migration by hand\n");
  const f = run(["--file", brief]);
  assert.equal(f.code, 0, f.err);
  assert.ok(named(f.out).includes("statenour-migration"), f.out);
  const t = run(["--text", "fix the Prisma migration for statenour"]);
  assert.deepEqual(named(t.out), named(hook("fix the Prisma migration for statenour").out));
});

test("fail OPEN: malformed stdin, a corrupted cache and an unwritable cache dir all exit 0", () => {
  const bad = run([], "{not json");
  assert.equal(bad.code, 0, bad.err);
  assert.match(bad.out, /^\[skill-recall\] off: /m, bad.out);
  // Corrupted cache: the index is rebuilt and the controls still work.
  const cacheDir = join(SCRATCH, "cache");
  for (const f of existsSync(cacheDir) ? readdirSync(cacheDir) : []) writeFileSync(join(cacheDir, f), "{corrupt");
  const r = hook("fix the Prisma migration for statenour");
  assert.equal(r.code, 0, r.err);
  assert.ok(named(r.out).includes("statenour-migration"), r.out);
  // Unwritable cache location: a file where the dir should be.
  const notDir = join(SCRATCH, "not-a-dir");
  writeFileSync(notDir, "x");
  const u = hook("fix the Prisma migration for statenour", SCRIPT, { SKILL_RECALL_CACHE_DIR: notDir });
  assert.equal(u.code, 0, u.err);
  assert.ok(/invoke: statenour-migration|\[skill-recall\] off: /.test(u.out), u.out);
});

test("latency: a warm-cache hook run stays under 2 s (local target 300 ms, recorded in the PR)", () => {
  hook("warm the cache");
  const r = hook("fix the Prisma migration for statenour");
  assert.equal(r.code, 0);
  assert.ok(r.ms < 2000, `${r.ms.toFixed(0)} ms`);
  process.stdout.write(`# skill-recall warm hook run: ${r.ms.toFixed(0)} ms\n`);
});

test("runtime writes nothing inside the repo: git status is identical before and after three hook runs on the DEFAULT cache dir", () => {
  const status = () => spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "";
  const before = status();
  const defaults = { SKILL_RECALL_CACHE_DIR: undefined };
  for (const p of ["fix the Prisma migration for statenour", NONSENSE, "warm"]) assert.equal(hook(p, SCRIPT, defaults).code, 0);
  assert.equal(status(), before);
});

test("MUTANTS: no scorer output, no name boost and no always-on filter are each caught by the controls", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const plant = (label, from, to) => {
    assert.ok(src.includes(from), `anchor "${from}" missing from skill-recall.mjs`);
    const p = join(SCRATCH, `mutant-${label}.mjs`);
    writeFileSync(p, src.replace(from, to));
    return p;
  };
  assert.deepEqual(controlProblems(), [], "the unmutated script must pass first");
  const noScore = plant("floor", "const FLOOR = ", "const FLOOR = 1e9; const FLOOR_ORIGINAL = ");
  assert.ok(controlProblems(noScore).some((p) => /expected one of/.test(p)), "a scorer that returns nothing must fail the controls");
  const noBoost = plant("name", "const NAME_BOOST = 3;", "const NAME_BOOST = 1;");
  assert.ok(controlProblems(noBoost).length > 0, "removing the name boost must fail at least one control");
  const noFilter = plant("filter", "const ALWAYS_ON = new Set([", "const ALWAYS_ON = new Set([]); const ALWAYS_ON_ORIGINAL = new Set([");
  const r = hook("run ponytail and verification-before-completion and karpathy-guidelines before writing code", noFilter);
  assert.ok(named(r.out).some((n) => ALWAYS_ON.includes(n.split(":").pop())), `without the filter an always-on skill must appear: ${r.out}`);
});
