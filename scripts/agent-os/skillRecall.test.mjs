// Canary for skill-recall.mjs, the UserPromptSubmit hook that names the skills a prompt should invoke.
// Every control goes through the REAL script as a child process with the stdin JSON the harness sends
// (guard-red-team rule 5), never through an imported function. Mutants are planted by copying the script
// to the OS temp dir with one constant changed and running that copy against the same controls.
// The routing controls run against a FIXTURE home (two user skills shaped like receiving-code-review and pptx, plus
// an unloadable nested SKILL.md), so the suite reads the same on every machine; one test looks at the real user root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isVendoredSkill } from "./vendoredSkill.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "skill-recall.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const REAL_HOME_SKILLS = join(homedir(), ".claude", "skills");
const TEMPLATE = join(ROOT, ".agents", "core", "templates", "subagent-brief.md");
const SCRATCH = mkdtempSync(join(tmpdir(), "skill-recall-test-"));

// Exactly the names other hooks and the lane frontmatter force every turn (review round 5: the scoped ones score).
const ALWAYS_ON = [
  "using-superpowers", "ponytail", "karpathy-guidelines", "i-have-adhd", "verification-before-completion",
  "nour-command", "find-skill",
];

const skillFile = (name, description, triggers) => `---\nname: ${name}\ndescription: ${description}\n${triggers ? `triggers: ${triggers}\n` : ""}---\n# ${name}\n`;

/** A fixture home: ~/.claude/skills with two user skills, an unloadable nested SKILL.md, and optionally N synthetic skills. */
function makeHome(label, synthetic = 0) {
  const home = join(SCRATCH, label);
  const skills = join(home, ".claude", "skills");
  mkdirSync(join(skills, "receiving-code-review"), { recursive: true });
  writeFileSync(join(skills, "receiving-code-review", "SKILL.md"), skillFile("receiving-code-review",
    "Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires technical rigor and verification, not performative agreement or blind implementation"));
  mkdirSync(join(skills, "pptx"), { recursive: true });
  writeFileSync(join(skills, "pptx", "SKILL.md"), skillFile("pptx",
    "Use when creating, editing or reading PowerPoint slide decks: slides, layouts, speaker notes, templates and exports to pdf or images"));
  // Not loadable by Claude Code: a SKILL.md two levels down (a draft under references). It must never be indexed.
  mkdirSync(join(skills, "nested-host", "references", "draft"), { recursive: true });
  writeFileSync(join(skills, "nested-host", "SKILL.md"), skillFile("nested-host", "Use when hosting nested fixtures for this canary."));
  writeFileSync(join(skills, "nested-host", "references", "draft", "SKILL.md"), skillFile("nested-draft-skill", "A draft that is not a skill.", "zorblatt, quxxle"));
  // Synthetic user skills of average length that share no word with any control prompt (round 5: idf stability).
  for (let i = 0; i < synthetic; i++) {
    const words = Array.from({ length: 25 }, (_, j) => `syn${i}w${j}`).join(" ");
    mkdirSync(join(skills, `synthetic-${i}`), { recursive: true });
    writeFileSync(join(skills, `synthetic-${i}`, "SKILL.md"), skillFile(`synthetic-${i}`, `Use when ${words}.`));
  }
  return home;
}

const HOME_SMALL = makeHome("home-small");
const HOME_BIG = makeHome("home-big", 500);

// prompt -> at least one of these names must be printed. Options: `first` (must be the FIRST line), `maxNonRepo`
// (cap on entries from the user root), `repoFirst` (no user entry above a repo entry), `absent` (names that must NOT
// print). Scores quoted in comments were measured 2026-10-16 on the operator machine.
const CONTROLS = [
  ["fix the Prisma migration for statenour", ["statenour-migration"], { first: true }],
  ["the reel pipeline is stuck on Instagram", ["nickstire-reel-operator", "nickstire-verifier-reel-pipeline"], { first: true }],
  ["write a deny-list regex for the pretool hook", ["guard-red-team"], { first: true }],
  // "merge" and "ledger" are each one trigger word of a different skill, so nothing prints (round 3). The form with
  // "release the lease" (B) carries the expectation: session-authority first, at most one user-root entry.
  ["merge the three ledger rows", [], { absent: ["stranded-branch-rescue", "ponytail-debt", "ponytail-audit"] }],
  ["merge the three ledger rows and release the lease", ["session-authority"], { first: true, maxNonRepo: 1 }],
  // Probe A: its generic words (brief, deck, sheet, open, approve, home) each hit one description or one trigger
  // phrase and nothing else, so nothing may print. antislop-ui has no word of this prompt in its body.
  ["open the W2 brief for Home deck and Missions, approve in place, detent sheet", [], { maxNonRepo: 0, absent: ["nickstire-ios-pwa-primitives"] }],
  // Round 4: the user root scores on the same rule as the repo; these two are true matches a 1.5x bar had dropped.
  ["the feedback is unclear", ["receiving-code-review"], { first: true }],
  ["slides for the deck", ["pptx"], { first: true }],
  // Round 3: one generic word inside a trigger phrase must not print a repo skill on its own (home screen, page,
  // empty labels, loading). The MIN_HITS mutant sets the minimum to 1 and this control fails.
  ["the home page shows no active missions while the board is loading; fix the empty state", ["empty-vs-error"],
    { first: true, absent: ["nickstire-ios-pwa-primitives", "defuddle", "antislop-code", "ponytail-review"] }],
  // Round 3b: ALWAYS_ON hid skills nothing forces; harness-worktree-setup is the FIRST action CLAUDE.md names.
  ["tsc is not recognized in this worktree", ["harness-worktree-setup"], { first: true }],
  // Round 5: monorepo-manager and antislop are scoped, not forced every turn, so they must score.
  ["manage the repo, dispatch two lanes and run the backlog", ["monorepo-manager"], { first: true }],
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
  // Round 5: the query cap keeps both ends, so a request after a long paste still routes.
  [Array.from({ length: 2100 }, (_, i) => `filler${i}`).join(" ") + " fix the Prisma migration for statenour", ["statenour-migration"], { first: true, label: "2100 filler tokens then the Prisma prompt" }],
  // Round 5: a SKILL.md nested under a skill's references is not loadable and must not be indexed.
  ["zorblatt quxxle", [], { absent: ["nested-draft-skill"] }],
];
const NONSENSE = "zxqv florp wibble quux";
// Two body-only hits on one skill (nickstire-reel-operator 5.3): above zero, under the floor, so the none line.
// The FLOOR mutant (0.5) prints it.
const NOISE = "reads on his iphone mid-task";
const label = (prompt, opt) => opt.label || prompt;

function countSkillFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countSkillFiles(join(dir, e.name));
    else if (e.name === "SKILL.md") n += 1;
  }
  return n;
}

/** Run a script the way the hook runs: cwd = project, CLAUDE_PROJECT_DIR set, no GIT_* env, JSON on stdin, fixture home. */
function run(args, input, script = SCRIPT, extraEnv = {}, home = HOME_SMALL) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  env.SKILL_RECALL_CACHE_DIR = join(SCRATCH, "cache-" + (home === HOME_BIG ? "big" : home === HOME_SMALL ? "small" : "real"));
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  Object.assign(env, extraEnv);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8", cwd: ROOT, env, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: performance.now() - t0 };
}

const hookInput = (prompt) => JSON.stringify({ session_id: "t", cwd: ROOT, hook_event_name: "UserPromptSubmit", prompt });
const hook = (prompt, script, extraEnv, home) => run([], hookInput(prompt), script, extraEnv, home);
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
  env.SKILL_RECALL_CACHE_DIR = join(SCRATCH, "cache-small");
  env.HOME = HOME_SMALL;
  env.USERPROFILE = HOME_SMALL;
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: hookInput(prompt), encoding: "utf8", cwd: ROOT, env, timeout: 30000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** The whole contract for one script: every control holds, nonsense and noise print the none line, always-on never appears. */
function controlProblems(script = SCRIPT, home = HOME_SMALL) {
  const problems = [];
  for (const [prompt, expected, opt = {}] of CONTROLS) {
    const r = hook(prompt, script, {}, home);
    const name = label(prompt, opt);
    if (r.code !== 0) problems.push(`exit ${r.code} for "${name}": ${r.err}`);
    const got = named(r.out);
    const pool = opt.first ? got.slice(0, 1) : got;
    if (expected.length && !expected.some((e) => pool.includes(e))) problems.push(`"${name}" named [${got.join(", ")}], expected one of [${expected.join(", ")}]${opt.first ? " first" : ""}`);
    for (const a of opt.absent ?? []) if (got.includes(a)) problems.push(`"${name}" printed ${a}, which must stay absent`);
    for (const g of got) if (ALWAYS_ON.includes(g)) problems.push(`always-on skill ${g} printed for "${name}"`);
    if (got.length > 5) problems.push(`${got.length} lines for "${name}", cap is 5`);
    if (opt.maxNonRepo !== undefined || opt.repoFirst) {
      // The hook line carries no root, so the same scorer's --json output supplies the kinds for the same prompt.
      const picked = JSON.parse(run(["--json", "--text", prompt], undefined, script, {}, home).out).picked;
      const nonRepo = picked.filter((p) => p.kind !== "repo").map((p) => p.name);
      if (opt.maxNonRepo !== undefined && nonRepo.length > opt.maxNonRepo) problems.push(`"${name}" printed ${nonRepo.length} non-repo entries [${nonRepo.join(", ")}], cap ${opt.maxNonRepo}`);
      const lastRepo = picked.map((p) => p.kind).lastIndexOf("repo");
      const firstNonRepo = picked.findIndex((p) => p.kind !== "repo");
      if (opt.repoFirst && firstNonRepo >= 0 && firstNonRepo < lastRepo) problems.push(`"${name}" ranks non-repo ${picked[firstNonRepo].name} above a repo entry`);
    }
  }
  for (const p of [NONSENSE, NOISE]) {
    const r = hook(p, script, {}, home);
    if (r.code !== 0) problems.push(`exit ${r.code} for "${p}"`);
    if (!NONE_LINE.test(r.out)) problems.push(`"${p}" printed: ${JSON.stringify(r.out)}`);
  }
  return problems;
}

/** Every repo skill carries a non-empty ASCII `triggers:` frontmatter line (inline list, or a YAML block list); a vendored upstream copy (vendoredSkill.mjs) is kept byte-identical, so it is exempt. */
export function triggerProblems(skills) {
  const problems = [];
  for (const { rel, text, vendored } of skills) {
    if (vendored) continue;
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
    if (e.isDirectory() && existsSync(file)) out.push({ rel: `.claude/skills/${e.name}`, text: readFileSync(file, "utf8"), vendored: isVendoredSkill(join(ROOT, ".claude", "skills", e.name), ROOT) });
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
  assert.deepEqual(triggerProblems([{ ...mutant, vendored: true }]), [], "a vendored copy without triggers: is exempt");
  assert.ok(skills.filter((s) => s.vendored).length >= 21, "the vendored set was not detected");
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

test("index: every flat .claude/skills SKILL.md, the fixture user skills, no nested SKILL.md, nothing from plugins", () => {
  const r = run(["--json", "--text", "probe"]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  const repoCount = countSkillFiles(join(ROOT, ".claude", "skills"));
  assert.ok(repoCount >= 50, `repo has ${repoCount} SKILL.md files, expected at least 50`);
  assert.ok(j.index.repo >= repoCount, `indexed ${j.index.repo} repo skills, on disk ${repoCount}`);
  assert.equal(j.index.user, 3, `fixture home holds receiving-code-review, pptx and nested-host: indexed ${j.index.user}`);
  assert.ok(j.index.names.includes("pptx") && j.index.names.includes("nested-host"));
  assert.ok(!j.index.names.includes("nested-draft-skill"), "a SKILL.md under a skill's references must not be indexed");
  assert.equal(j.index.total, j.index.repo + j.index.user);
  assert.equal(j.index.plugin, undefined, "plugin trees must not be indexed: the Skill tool cannot load them by those names");
});

test("the REAL user root is discovered when it exists (count only, no ranking asserted)", () => {
  const r = run(["--json", "--text", "probe"], undefined, SCRIPT, {}, null);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  if (existsSync(REAL_HOME_SKILLS)) assert.ok(j.index.user > 0, `real user root exists but indexed ${j.index.user}`);
  else assert.equal(j.index.user, 0);
});

test("positive controls through the real hook: expected skills, none line for nonsense and noise, always-on filtered", () => {
  assert.deepEqual(controlProblems(), []);
});

test("500 unrelated user skills change no repo result: same first lines, noise still prints the none line", () => {
  const big = JSON.parse(run(["--json", "--text", "probe"], undefined, SCRIPT, {}, HOME_BIG).out);
  assert.equal(big.index.user, 503, `big fixture home indexed ${big.index.user} user skills`);
  assert.deepEqual(controlProblems(SCRIPT, HOME_BIG), []);
  for (const [prompt, expected, opt = {}] of CONTROLS) {
    if (!expected.length) continue;
    const small = named(hook(prompt, SCRIPT, {}, HOME_SMALL).out)[0];
    const withBig = named(hook(prompt, SCRIPT, {}, HOME_BIG).out)[0];
    assert.equal(withBig, small, `"${label(prompt, opt)}": first line moved from ${small} to ${withBig} after 500 user skills`);
  }
});

test("a prompt that names the always-on skills never prints them, and a skill nothing forces is not hidden", () => {
  const r = hook("run ponytail, karpathy-guidelines, find-skill, nour-command and verification-before-completion with using-superpowers and i-have-adhd");
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
  const cacheDir = join(SCRATCH, "cache-small");
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

test("--scope global outside a repo: no .claude/skills at the root, statistics fall back to the user cohort, recall still prints", () => {
  // The whole point of the global entry: a folder with no repo skills. Round 6 found every user skill scoring under
  // zero there, because the repo-only term table had N = 0. The REPO_ONLY mutant below forces that table back.
  // The user cohort must be of realistic size for the idf to mean anything: the big fixture home (503 skills) stands
  // in for a real ~/.claude/skills; with three skills alone no term clears the floor, which is a limit, not a defect.
  const bare = join(SCRATCH, "proj-bare");
  mkdirSync(bare, { recursive: true });
  const r = run(["--scope", "global"], hookInput("the feedback is unclear"), SCRIPT, { CLAUDE_PROJECT_DIR: bare }, HOME_BIG);
  assert.equal(r.code, 0, r.err);
  assert.equal(named(r.out)[0], "receiving-code-review", `expected receiving-code-review from a bare folder, got: ${r.out}`);
  const j = JSON.parse(run(["--json", "--text", "the feedback is unclear"], undefined, SCRIPT, { CLAUDE_PROJECT_DIR: bare }, HOME_BIG).out);
  assert.equal(j.index.repo, 0);
  assert.ok(j.picked.every((p) => p.score > 0), `scores must stay positive without a repo cohort: ${JSON.stringify(j.picked)}`);
  const src = readFileSync(SCRIPT, "utf8");
  const anchor = 'const cohort = repo.length ? repo : entries.filter((e) => e.kind === "user");';
  assert.ok(src.includes(anchor), `anchor "${anchor}" missing from skill-recall.mjs`);
  const repoOnly = join(SCRATCH, "mutant-repo-only.mjs");
  writeFileSync(repoOnly, src.replace(anchor, "const cohort = repo;"));
  const m = run(["--scope", "global"], hookInput("the feedback is unclear"), repoOnly, { CLAUDE_PROJECT_DIR: bare, SKILL_RECALL_CACHE_DIR: join(SCRATCH, "cache-mutant-repo-only") }, HOME_BIG);
  assert.notEqual(named(m.out)[0], "receiving-code-review", `the repo-only table must fail this control, got: ${m.out}`);
});

test("--scope global from the home directory itself: the user settings file is not a project file, recall still prints", () => {
  // Round 6, found live: `cd ~` made CLAUDE_PROJECT_DIR the home dir, whose .claude/settings.json carries the global
  // entry, so the duplicate guard went silent in the one place that has no repo hook at all.
  // A home of realistic size (the same 503-skill fixture) whose own settings.json carries the global entry.
  const home = makeHome("home-as-project", 500);
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
    hooks: { UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: 'node "C:/x/scripts/agent-os/skill-recall.mjs" --scope global' }] }] },
  }));
  const env = { CLAUDE_PROJECT_DIR: home, HOME: home, USERPROFILE: home, SKILL_RECALL_CACHE_DIR: join(SCRATCH, "cache-home-as-project") };
  const r = run(["--scope", "global"], hookInput("the feedback is unclear"), SCRIPT, env);
  assert.equal(r.code, 0, r.err);
  assert.equal(named(r.out)[0], "receiving-code-review", `expected recall from the home directory, got: ${JSON.stringify(r.out)}`);
  // Round 7: the one directory is the user root only, never counted twice as repo and user (which gave every user
  // skill REPO_BOOST and the kind "repo").
  const j = JSON.parse(run(["--json", "--text", "the feedback is unclear"], undefined, SCRIPT, env).out);
  assert.equal(j.index.repo, 0, `home-as-project must index no repo skills: ${JSON.stringify(j.index)}`);
  assert.equal(j.index.user, 503);
  assert.equal(j.picked[0]?.name, "receiving-code-review");
  assert.equal(j.picked[0]?.kind, "user", `the match must carry kind user: ${JSON.stringify(j.picked[0])}`);
  // Mutant: without the home-directory exemption the guard reads the user file as a project file and goes silent.
  const src = readFileSync(SCRIPT, "utf8");
  const anchor = "if (resolve(root) === resolve(homedir())) return false;";
  assert.ok(src.includes(anchor), `anchor "${anchor}" missing from skill-recall.mjs`);
  const noExempt = join(SCRATCH, "mutant-no-home-exempt.mjs");
  writeFileSync(noExempt, src.replace(anchor, ""));
  const m = run(["--scope", "global"], hookInput("the feedback is unclear"), noExempt, env);
  assert.equal(m.out, "", `without the exemption the hook must go silent (that is the defect): ${m.out}`);
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

test("runtime writes nothing inside the repo: git status is identical before and after three hook runs on the DEFAULT cache dir and the real home", () => {
  const status = () => spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "";
  const before = status();
  const defaults = { SKILL_RECALL_CACHE_DIR: undefined };
  for (const p of ["fix the Prisma migration for statenour", NONSENSE, "warm"]) {
    const r = hook(p, SCRIPT, defaults, null);
    assert.equal(r.code, 0);
    // The default cache may hold an index written by an older version of the script; it must never turn the hook off.
    assert.doesNotMatch(r.out, /^\[skill-recall\] off: /m, `default cache turned the hook off for "${p}": ${r.out}`);
  }
  assert.match(hook("fix the Prisma migration for statenour", SCRIPT, defaults, null).out, /invoke: statenour-migration/);
  assert.equal(status(), before);
});

test("MUTANTS: no scorer output, a floor of 0.5, no name boost, a one-term minimum and no always-on filter are each caught", () => {
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
  const oneHit = plant("minhits", "const MIN_HITS = 2;", "const MIN_HITS = 1;");
  const hitProblems = controlProblems(oneHit).filter((p) => /must stay absent/.test(p));
  assert.ok(hitProblems.length >= 1, `a one-term minimum must print a trigger-only repo skill: ${hitProblems.join(" | ")}`);
  const noFilter = plant("filter", "const ALWAYS_ON = new Set([", "const ALWAYS_ON = new Set([]); const ALWAYS_ON_ORIGINAL = new Set([");
  const r = hook("run ponytail and verification-before-completion and karpathy-guidelines before writing code", noFilter);
  assert.ok(named(r.out).some((n) => ALWAYS_ON.includes(n)), `without the filter an always-on skill must appear: ${r.out}`);
});
