// Canary for skill-recall.mjs, the UserPromptSubmit hook that names the skills a prompt should invoke.
// Every control goes through the REAL script as a child process with the stdin JSON the harness sends
// (guard-red-team rule 5), never through an imported function. Mutants are planted by copying the script
// to the OS temp dir with one constant changed and running that copy against the same controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "skill-recall.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const HOME_SKILLS = join(homedir(), ".claude", "skills");
const TEMPLATE = join(ROOT, ".agents", "core", "templates", "subagent-brief.md");
const SCRATCH = mkdtempSync(join(tmpdir(), "skill-recall-test-"));

// Exactly the names other hooks and the lane frontmatter force every turn (review round 3b).
const ALWAYS_ON = [
  "using-superpowers", "ponytail", "karpathy-guidelines", "i-have-adhd", "verification-before-completion",
  "antislop", "monorepo-manager", "nour-command", "find-skill",
];

// prompt -> at least one of these names must be printed. Options: `first` (must be the FIRST line), `maxNonRepo`
// (cap on entries from ~/.claude/skills), `repoFirst` (no non-repo entry above a repo entry), `absent` (names that
// must NOT print). Scores quoted in comments were measured 2026-10-16 on the operator machine (83 indexed names).
const CONTROLS = [
  ["fix the Prisma migration for statenour", ["statenour-migration"], { first: true }],
  ["the reel pipeline is stuck on Instagram", ["nickstire-reel-operator", "nickstire-verifier-reel-pipeline"], { first: true }],
  ["write a deny-list regex for the pretool hook", ["guard-red-team"], { first: true }],
  // "merge" and "ledger" are each one trigger word of a different skill, so nothing prints (round 3). The form with
  // "release the lease" (B) carries the expectation: session-authority first, at most one non-repo entry.
  ["merge the three ledger rows", [], { absent: ["stranded-branch-rescue", "ponytail-debt", "ponytail-audit"] }],
  ["merge the three ledger rows and release the lease", ["session-authority"], { first: true, maxNonRepo: 1 }],
  // Probe A: its generic words (brief, deck, sheet, open, approve, home) each hit one library description or one
  // trigger phrase and nothing else, so nothing may print. antislop-ui has no word of this prompt in its body.
  ["open the W2 brief for Home deck and Missions, approve in place, detent sheet", [], { maxNonRepo: 0, absent: ["nickstire-ios-pwa-primitives"] }],
  // The non-repo bar witness: two body hits put receiving-code-review (user root) at 10.5, under 1.5x the floor, so
  // the bar drops it; the NONREPO_BAR mutant (0) prints it. This is a true match the bar costs; recorded on purpose.
  ["the feedback is unclear", [], { maxNonRepo: 0, absent: ["receiving-code-review"] }],
  // Round 3: one generic word inside a trigger phrase must not print a repo skill on its own (home screen, page,
  // empty labels, loading). The MIN_HITS mutant sets the minimum to 1 and this control fails.
  ["the home page shows no active missions while the board is loading; fix the empty state", ["empty-vs-error"],
    { first: true, absent: ["nickstire-ios-pwa-primitives", "defuddle", "antislop-code", "ponytail-review"] }],
  // Round 3b: ALWAYS_ON hid skills nothing forces; harness-worktree-setup is the FIRST action CLAUDE.md names.
  ["tsc is not recognized in this worktree", ["harness-worktree-setup"], { first: true }],
  // Round 3b P1-3: wrong or missing top match, fixed with stop words and triggers.
  ["fix the failing vitest for the booking page", ["test-driven-development", "systematic-debugging"], { first: true }],
  ["the nickstire SMS reminder cron is failing in prod", ["systematic-debugging", "prod-db-guard"], { first: true }],
  // skill-forge is 4th here (31.9 behind reel-hook-mechanism 59.2, two real name hits with a high idf); stop words and
  // triggers alone cannot flip it, so this pins the top 5, not the top line. Reported in the round-3b return.
  ["write a new skill for the reel hooks", ["skill-forge"]],
  ["why is the admin page slow on my phone", ["antislop-layoutmobile", "nickstire-ios-pwa-primitives"], { first: true }],
  ["audit the hook and find what is broken", ["guard-red-team"], { first: true }],
  // Fire-audit "live skill with no routing trigger" repo skills, prompted with their own body words.
  ["review the contrast of this button text", ["antislop-human"], { first: true }],
  ["remove the generic comments from this file", ["antislop-code"], { first: true }],
  ["which skills actually fire", ["skill-fire-audit"], { first: true }],
  ["the subagents are using the same skills over and over", ["skill-fire-audit"]],
];
const NONSENSE = "zxqv florp wibble quux";
// Two body-only hits on one skill (nickstire-reel-operator 5.3): above zero, under the floor, so the none line.
// The FLOOR mutant (0.5) prints it.
const NOISE = "reads on his iphone mid-task";

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
const NONE_LINE = /^\[skill-recall\] none beyond the always-on set$/m;

function configuredRecall() {
  return (SETTINGS.hooks?.UserPromptSubmit ?? [])
    .flatMap((g) => g.hooks ?? [])
    .find((h) => h.type === "command" && h.command.includes("skill-recall.mjs"));
}

/** Run a configured hook command verbatim through a shell, the way the harness does. */
function runConfigured(command, prompt) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  env.SKILL_RECALL_CACHE_DIR = join(SCRATCH, "cache");
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: hookInput(prompt), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** The whole contract for one script: every control holds, nonsense and noise print the none line, always-on never appears. */
function controlProblems(script = SCRIPT) {
  const problems = [];
  for (const [prompt, expected, opt = {}] of CONTROLS) {
    const r = hook(prompt, script);
    if (r.code !== 0) problems.push(`exit ${r.code} for "${prompt}": ${r.err}`);
    const got = named(r.out);
    const pool = opt.first ? got.slice(0, 1) : got;
    if (expected.length && !expected.some((e) => pool.includes(e))) problems.push(`"${prompt}" named [${got.join(", ")}], expected one of [${expected.join(", ")}]${opt.first ? " first" : ""}`);
    for (const a of opt.absent ?? []) if (got.includes(a)) problems.push(`"${prompt}" printed ${a}, which must stay absent`);
    for (const g of got) if (ALWAYS_ON.includes(g)) problems.push(`always-on skill ${g} printed for "${prompt}"`);
    if (got.length > 5) problems.push(`${got.length} lines for "${prompt}", cap is 5`);
    if (opt.maxNonRepo !== undefined || opt.repoFirst) {
      // The hook line carries no root, so the same scorer's --json output supplies the kinds for the same prompt.
      const picked = JSON.parse(run(["--json", "--text", prompt], undefined, script).out).picked;
      const nonRepo = picked.filter((p) => p.kind !== "repo").map((p) => p.name);
      if (opt.maxNonRepo !== undefined && nonRepo.length > opt.maxNonRepo) problems.push(`"${prompt}" printed ${nonRepo.length} non-repo entries [${nonRepo.join(", ")}], cap ${opt.maxNonRepo}`);
      const lastRepo = picked.map((p) => p.kind).lastIndexOf("repo");
      const firstNonRepo = picked.findIndex((p) => p.kind !== "repo");
      if (opt.repoFirst && firstNonRepo >= 0 && firstNonRepo < lastRepo) problems.push(`"${prompt}" ranks non-repo ${picked[firstNonRepo].name} above a repo entry`);
    }
  }
  for (const p of [NONSENSE, NOISE]) {
    const r = hook(p, script);
    if (r.code !== 0) problems.push(`exit ${r.code} for "${p}"`);
    if (!NONE_LINE.test(r.out)) problems.push(`"${p}" printed: ${JSON.stringify(r.out)}`);
  }
  return problems;
}

/** Every repo skill carries a non-empty ASCII `triggers:` frontmatter line (inline list, or a YAML block list). */
export function triggerProblems(skills) {
  const problems = [];
  for (const { rel, text } of skills) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
    if (!fm) { problems.push(`${rel}: no frontmatter`); continue; }
    const m = /^triggers:[ \t]*(.*)$((?:\r?\n[ \t]+-[ \t]*\S.*)*)/m.exec(fm);
    if (!m) { problems.push(`${rel}: no triggers: line`); continue; }
    const terms = m[1].trim() ? m[1].split(",").map((t) => t.trim()).filter(Boolean) : m[2].split(/\r?\n/).filter((l) => l.trim());
    if (terms.length < 3) problems.push(`${rel}: triggers: has ${terms.length} terms, want at least 3`);
    if (/[^\x00-\x7F]/.test(m[0])) problems.push(`${rel}: triggers: is not ASCII`);
  }
  return problems;
}

function repoSkills() {
  const out = [];
  for (const e of readdirSync(join(ROOT, ".claude", "skills"), { withFileTypes: true })) {
    const file = join(ROOT, ".claude", "skills", e.name, "SKILL.md");
    if (e.isDirectory() && existsSync(file)) out.push({ rel: `.claude/skills/${e.name}`, text: readFileSync(file, "utf8") });
  }
  return out;
}

test("every repo SKILL.md has a non-empty triggers: line, and a planted removal is reported", () => {
  const skills = repoSkills();
  assert.ok(skills.length >= 50, `found ${skills.length} repo skills`);
  assert.deepEqual(triggerProblems(skills), []);
  const victim = skills.find((s) => s.rel.endsWith("/antislop-ui"));
  const mutant = { rel: victim.rel, text: victim.text.replace(/^triggers:.*\r?\n/m, "") };
  assert.notEqual(mutant.text, victim.text);
  assert.deepEqual(triggerProblems([mutant]), [`${victim.rel}: no triggers: line`]);
  const thin = { rel: victim.rel, text: victim.text.replace(/^triggers:.*$/m, "triggers: one, two") };
  assert.match(triggerProblems([thin])[0], /want at least 3/);
});

test("registered on UserPromptSubmit after the skills-first reminder; the configured command runs verbatim and prints recall lines", () => {
  const hooks = (SETTINGS.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []);
  const reminder = hooks.findIndex((h) => h.command.includes("skills-first-reminder.mjs"));
  const recall = hooks.findIndex((h) => h.command.includes("skill-recall.mjs"));
  assert.ok(recall >= 0, "skill-recall.mjs is not registered on UserPromptSubmit");
  assert.ok(reminder >= 0 && reminder < recall, "skill-recall must run after skills-first-reminder");
  const cfg = configuredRecall();
  assert.doesNotMatch(cfg.command, /\\/, "a backslash path does not resolve on Linux");
  assert.match(cfg.command, /"\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/skill-recall\.mjs"$/, "the registered command must end at the script: no --json, no extra flags");
  assert.ok((cfg.timeout ?? 60) >= 5, `hook timeout ${cfg.timeout} s is too tight for a cold index build`);
  const r = runConfigured(cfg.command, "fix the Prisma migration for statenour");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\[skill-recall\] invoke: statenour-migration/m, `the configured command did not print recall lines:\n${r.out}`);
});

test("index covers every .claude/skills SKILL.md and the user root when it exists, and nothing from plugins", () => {
  const r = run(["--json", "--text", "probe"]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  const repoCount = countSkillFiles(join(ROOT, ".claude", "skills"));
  assert.ok(repoCount >= 50, `repo has ${repoCount} SKILL.md files, expected at least 50`);
  assert.ok(j.index.repo >= repoCount, `indexed ${j.index.repo} repo skills, on disk ${repoCount}`);
  if (existsSync(HOME_SKILLS)) assert.ok(j.index.user > 0, `user root exists but indexed ${j.index.user}`);
  assert.equal(j.index.total, j.index.repo + j.index.user);
  assert.equal(j.index.plugin, undefined, "plugin trees must not be indexed: the Skill tool cannot load them by those names");
});

test("positive controls through the real hook: expected skills, none line for nonsense and noise, always-on filtered", () => {
  assert.deepEqual(controlProblems(), []);
});

test("a prompt that names the always-on skills never prints them, and a skill nothing forces is not hidden", () => {
  const r = hook("run ponytail, karpathy-guidelines, find-skill, nour-command and monorepo-manager with antislop and i-have-adhd");
  assert.equal(r.code, 0, r.err);
  for (const n of named(r.out)) assert.ok(!ALWAYS_ON.includes(n), `always-on ${n} printed`);
  assert.ok(named(hook("prior art before the new table").out).includes("prior-art-grep"), "prior-art-grep must be able to score");
});

test("--file mode drops the brief template's boilerplate and scores what the brief is about", () => {
  const brief = join(SCRATCH, "brief.md");
  writeFileSync(brief, "GOAL: change the statenour Prisma schema and write the migration by hand\n");
  const f = run(["--file", brief]);
  assert.equal(f.code, 0, f.err);
  assert.ok(named(f.out).includes("statenour-migration"), f.out);
  const t = run(["--text", "fix the Prisma migration for statenour"]);
  assert.deepEqual(named(t.out), named(hook("fix the Prisma migration for statenour").out));
  // A templated brief: the whole template verbatim plus one real GOAL line. Without the drop, the template's own
  // words (guard, hook, prod, push, branch...) outrank the subject; with it the subject is first.
  const templated = join(SCRATCH, "brief-templated.md");
  writeFileSync(templated, readFileSync(TEMPLATE, "utf8") + "\nGOAL: change the statenour Prisma schema and apply the migration by hand\n");
  const g = run(["--file", templated]);
  assert.equal(g.code, 0, g.err);
  assert.equal(named(g.out)[0], "statenour-migration", g.out);
});

test("fail OPEN: malformed stdin exits 0 with the off line; a corrupted cache rebuilds; an unwritable cache dir still answers", () => {
  const bad = run([], "{not json");
  assert.equal(bad.code, 0, bad.err);
  assert.match(bad.out, /^\[skill-recall\] off: /m, bad.out);
  const healthy = hook("fix the Prisma migration for statenour");
  assert.doesNotMatch(healthy.out, /\[skill-recall\] off:/, `a healthy run must never print the off line: ${healthy.out}`);
  const cacheDir = join(SCRATCH, "cache");
  for (const f of existsSync(cacheDir) ? readdirSync(cacheDir) : []) writeFileSync(join(cacheDir, f), "{corrupt");
  const r = hook("fix the Prisma migration for statenour");
  assert.equal(r.code, 0, r.err);
  assert.ok(named(r.out).includes("statenour-migration"), r.out);
  const notDir = join(SCRATCH, "not-a-dir");
  writeFileSync(notDir, "x");
  const u = hook("fix the Prisma migration for statenour", SCRIPT, { SKILL_RECALL_CACHE_DIR: notDir });
  assert.equal(u.code, 0, u.err);
  assert.match(u.out, /invoke: statenour-migration/, `a cache write that fails must not turn the hook off: ${u.out}`);
});

test("--scope global: silent in a project whose settings already run the script, normal elsewhere", () => {
  const withHook = join(SCRATCH, "proj-with-hook");
  const without = join(SCRATCH, "proj-without-hook");
  for (const d of [withHook, without]) mkdirSync(join(d, ".claude", "skills"), { recursive: true });
  writeFileSync(join(withHook, ".claude", "settings.json"), JSON.stringify({
    hooks: { UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/scripts/agent-os/skill-recall.mjs"' }] }] },
  }));
  writeFileSync(join(without, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: "node other.mjs" }] }] } }));
  const silent = run(["--scope", "global"], hookInput("fix the Prisma migration for statenour"), SCRIPT, { CLAUDE_PROJECT_DIR: withHook });
  assert.equal(silent.code, 0, silent.err);
  assert.equal(silent.out, "", `expected no output in a project that already runs the hook, got: ${silent.out}`);
  const loud = run(["--scope", "global"], hookInput("fix the Prisma migration for statenour"), SCRIPT, { CLAUDE_PROJECT_DIR: without });
  assert.equal(loud.code, 0, loud.err);
  assert.match(loud.out, /^\[skill-recall\] /, `expected normal output in a project without the hook, got: ${loud.out}`);
  assert.match(hook("fix the Prisma migration for statenour").out, /invoke: statenour-migration/);
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
  for (const p of ["fix the Prisma migration for statenour", NONSENSE, "warm"]) {
    const r = hook(p, SCRIPT, defaults);
    assert.equal(r.code, 0);
    // The default cache may hold an index written by an older version of the script; it must never turn the hook off.
    assert.doesNotMatch(r.out, /^\[skill-recall\] off: /m, `default cache turned the hook off for "${p}": ${r.out}`);
  }
  assert.match(hook("fix the Prisma migration for statenour", SCRIPT, defaults).out, /invoke: statenour-migration/);
  assert.equal(status(), before);
});

test("MUTANTS: no scorer output, a floor of 0.5, no name boost, no non-repo bar, a one-term minimum and no always-on filter are each caught", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const plant = (label, from, to) => {
    assert.ok(src.includes(from), `anchor "${from}" missing from skill-recall.mjs`);
    const p = join(SCRATCH, `mutant-${label}.mjs`);
    writeFileSync(p, src.replace(from, to));
    return p;
  };
  assert.deepEqual(controlProblems(), [], "the unmutated script must pass first");
  const noScore = plant("floor", "const FLOOR = 7.5;", "const FLOOR = 1e9;");
  assert.ok(controlProblems(noScore).some((p) => /expected one of/.test(p)), "a scorer that returns nothing must fail the controls");
  const lowFloor = plant("lowfloor", "const FLOOR = 7.5;", "const FLOOR = 0.5;");
  assert.ok(controlProblems(lowFloor).some((p) => p.startsWith(`"${NOISE}" printed`)), "a floor of 0.5 must print the noise prompt");
  const noBoost = plant("name", "const NAME_BOOST = 3;", "const NAME_BOOST = 1;");
  assert.ok(controlProblems(noBoost).length > 0, "removing the name boost must fail at least one control");
  const noBar = plant("bar", "const NONREPO_BAR = 1.5;", "const NONREPO_BAR = 0;");
  const barProblems = controlProblems(noBar).filter((p) => /non-repo entries|above a repo entry/.test(p));
  assert.ok(barProblems.length >= 1, `removing the non-repo bar must fail a capped control: ${barProblems.join(" | ")}`);
  const oneHit = plant("minhits", "const MIN_HITS = 2;", "const MIN_HITS = 1;");
  const hitProblems = controlProblems(oneHit).filter((p) => /must stay absent/.test(p));
  assert.ok(hitProblems.length >= 1, `a one-term minimum must print a trigger-only repo skill: ${hitProblems.join(" | ")}`);
  const noFilter = plant("filter", "const ALWAYS_ON = new Set([", "const ALWAYS_ON = new Set([]); const ALWAYS_ON_ORIGINAL = new Set([");
  const r = hook("run ponytail and verification-before-completion and karpathy-guidelines before writing code", noFilter);
  assert.ok(named(r.out).some((n) => ALWAYS_ON.includes(n)), `without the filter an always-on skill must appear: ${r.out}`);
});
