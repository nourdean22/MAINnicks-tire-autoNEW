/**
 * Canary for .claude/skills/skill-forge/scripts/forge.mjs (2026-10-15).
 *
 * forge.mjs holds the repo gates around the official skill-creator. Each gate is proven on throwaway skill trees
 * first (a finished skill reads clean, each single defect is named by its own message), then the real skill-forge
 * is held to the same bar. mine() runs on synthetic transcripts that hold a real-shaped prompt with an email, a
 * phone number and a path, and the test asserts none of them reaches the output: the repo is public.
 *
 * Base rate, measured 2026-10-15: 57 of 57 repo skills have name equal to directory, 10 of 57 descriptions start
 * "Use when". So name == directory is a library-wide gate below; "Use when" is enforced on forged skills only.
 *
 * Run: node --test scripts/agent-os/skillForge.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSkill, claudeCommand, descriptionHash, heldOut, mine, originId, parseFrontmatter, parseInvocation, redact, score, skillCalls } from "../../.claude/skills/skill-forge/scripts/forge.mjs";

import { isVendoredSkill } from "./vendoredSkill.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FORGE = join(REPO, ".claude", "skills", "skill-forge", "scripts", "forge.mjs");
const base = mkdtempSync(join(tmpdir(), "forge-"));
after(() => rmSync(base, { recursive: true, force: true }));
let seq = 0;

const baselineText = [
  "# Baseline: x",
  "recorded: 2026-10-15",
  "",
  "## Tasks run without the skill",
  "| task | what happened | evidence |",
  "|---|---|---|",
  "| T1: a run without the skill | it produced the wrong thing entirely | transcript and file listing |",
  "| T2: a second run without it | it failed in the same way again | the same command output |",
  "",
  "## Failure shape",
  "The task fails in a repeatable way when the skill is absent: the agent skips the check and nothing notices, so the defect ships. The first step of the skill must prevent exactly that.",
  "",
].join("\n");
const DESC = "Use when forging a skill for this repo and checking its evidence. Not for running a skill or auditing which skills fire (skill-fire-audit).";
const skepticText = ["# Skeptic", "", "## Findings", "- the trigger was too broad: fixed", "- an alias was missing: rejected: it exists under another name", ""].join("\n");

function queries() {
  const out = [];
  for (let i = 0; i < 40; i++) {
    const query = `please help me with request number ${i} about forging a repo skill properly`;
    const origin = originId(query);
    out.push({ query, should_trigger: i % 2 === 0, heldOut: heldOut(query, origin), origin });
  }
  return out;
}

/** A finished skill at <tmp>/.claude/skills/<name>, with every gate satisfied. `over` maps relative file -> text, or null to omit. */
function skill(name = "good-skill", over = {}) {
  const root = join(base, String(seq++));
  const dir = join(root, ".claude", "skills", name);
  for (const d of ["references", "scripts", "evals"]) mkdirSync(join(dir, d), { recursive: true });
  const files = {
    "SKILL.md": `---\nname: ${name}\ndescription: ${DESC}\n---\n\n# x\n\nSee [gates](references/gates.md) and [tool](scripts/tool.mjs).\n`,
    "references/gates.md": "gates\n",
    "scripts/tool.mjs": "// tool\n",
    "evals/baseline.md": baselineText,
    "evals/trigger-queries.json": JSON.stringify(queries()),
    "evals/skeptic.md": skepticText,
    "evals/invocation.json": JSON.stringify({ skill: name, toolUse: true, loaded: true, claude: "2.1.296 (Claude Code)", descriptionSha256: descriptionHash(DESC) }),
    ...over,
  };
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, ...rel.split("/"))), { recursive: true });
    writeFileSync(join(dir, ...rel.split("/")), text);
  }
  return { root, dir };
}
const errs = (s, opts) => checkSkill(s.dir, opts);
const md = (name, desc, body = "[a](references/gates.md) [b](scripts/tool.mjs)\n") => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
const mutateQueries = (fn) => JSON.stringify(fn(queries()));

test("control: a finished skill reads clean", () => {
  assert.deepEqual(errs(skill()), []);
});

test("control: a triggers: line is a known key (skill-recall.mjs scores it), so it raises no frontmatter-key problem", () => {
  const s = skill("good-skill", { "SKILL.md": "---\nname: good-skill\ndescription: Use when x.\ntriggers: reel hook, hook ideas\n---\n[a](references/gates.md) [b](scripts/tool.mjs)\n" });
  assert.deepEqual(errs(s).filter((e) => /frontmatter key/.test(e)), []);
});

for (const [label, make, want] of [
  ["a name that differs from the directory", () => skill("good-skill", { "SKILL.md": "---\nname: other-name\ndescription: Use when x.\n---\n" }), /name "other-name" must equal the directory name "good-skill"/],
  ["a description that does not start with Use when", () => skill("good-skill", { "SKILL.md": "---\nname: good-skill\ndescription: A forge for skills.\n---\n" }), /must start with "Use when"/],
  ["a description over 1024 characters", () => skill("good-skill", { "SKILL.md": `---\nname: good-skill\ndescription: Use when ${"x".repeat(1100)}\n---\n` }), /description is \d+ characters/],
  ["angle brackets in the description", () => skill("good-skill", { "SKILL.md": "---\nname: good-skill\ndescription: Use when <x> happens.\n---\n" }), /angle brackets/],
  ["an unknown frontmatter key", () => skill("good-skill", { "SKILL.md": "---\nname: good-skill\ndescription: Use when x.\ntags: y\n---\n" }), /frontmatter key "tags"/],
  ["a link to a file that does not exist", () => skill("good-skill", { "SKILL.md": "---\nname: good-skill\ndescription: Use when x.\n---\n[a](references/gates.md) [b](scripts/tool.mjs) [c](references/missing.md)\n" }), /links references\/missing\.md, which does not exist/],
  ["a reference no link reaches (a prose-only reference)", () => skill("good-skill", { "references/orphan.md": "x\n" }), /references\/orphan\.md exists but SKILL\.md does not link it/],
  ["a script no link reaches", () => skill("good-skill", { "scripts/orphan.mjs": "x\n" }), /scripts\/orphan\.mjs exists but SKILL\.md does not link it/],
  ["a skill-creator workspace beside the skill", () => { const s = skill(); mkdirSync(join(s.dir, "..", "good-skill-workspace")); return s; }, /good-skill-workspace sits in \.claude\/skills\//],
  ["a leftover run_eval.py command file", () => { const s = skill(); mkdirSync(join(s.root, ".claude", "commands")); writeFileSync(join(s.root, ".claude", "commands", "good-skill-skill-0a1b2c3d.md"), "x"); return s; }, /leftover of run_eval\.py/],
  ["a missing baseline", () => skill("good-skill", { "evals/baseline.md": null }), /evals\/baseline\.md is missing/],
  ["a baseline with no failure shape", () => skill("good-skill", { "evals/baseline.md": baselineText.replace("## Failure shape", "## Notes") }), /needs "## Tasks run without the skill" and "## Failure shape"/],
  ["a baseline with no table rows", () => skill("good-skill", { "evals/baseline.md": baselineText.replace(/^\|.*$/gm, "") }), /at least two task rows of three filled cells/],
  ["missing trigger queries", () => skill("good-skill", { "evals/trigger-queries.json": null }), /trigger-queries\.json is missing/],
  ["too few trigger queries", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => q.slice(0, 5)) }), /has 5 queries; at least 12/],
  ["an email in a query", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[0].query = "please email jane.doe@example.com about forging a skill"; q[0].heldOut = heldOut(q[0].query, q[0].origin); return q; }) }), /contains a email/],
  ["a phone number in a query", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[0].query = "call 216-555-0147 and ask about forging a skill today"; q[0].heldOut = heldOut(q[0].query, q[0].origin); return q; }) }), /contains a phone number/],
  ["a path in a query", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[0].query = "open C:\\Users\\someone\\notes.txt and forge a skill from it"; q[0].heldOut = heldOut(q[0].query, q[0].origin); return q; }) }), /contains a absolute path/],
  ["a held-out flag that was hand-edited", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[3].heldOut = !q[3].heldOut; return q; }) }), /trigger-queries\[3\]: heldOut is .* but the hash rule says/],
  ["a held-out set with no should-not queries", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => q.map((e) => (e.heldOut ? { ...e, should_trigger: true } : e))) }), /the held-out set has \d+ should-trigger and 0 should-not/],
  ["queries that were all invented", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => q.map((e) => ({ ...e, origin: "written" }))) }), /only 0 of 40 queries come from real transcripts/],
  ["a query with no declared origin", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { delete q[2].origin; return q; }) }), /trigger-queries\[2\]: origin must be/],
  ["a duplicate query", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[1] = { ...q[0] }; return q; }) }), /duplicate query/],
  ["a missing skeptic record", () => skill("good-skill", { "evals/skeptic.md": null }), /skeptic\.md is missing/],
  ["a skeptic record with no dispositions", () => skill("good-skill", { "evals/skeptic.md": "# Skeptic\n\n## Findings\nit was fine\n" }), /needs a "## Findings" section/],
  ["a missing invocation proof", () => skill("good-skill", { "evals/invocation.json": null }), /invocation\.json is missing/],
  ["an invocation proof for a different skill", () => skill("good-skill", { "evals/invocation.json": JSON.stringify({ skill: "someone-else", toolUse: true, loaded: true }) }), /does not show the Skill tool loading "good-skill"/],
  ["an invocation proof that never loaded", () => skill("good-skill", { "evals/invocation.json": JSON.stringify({ skill: "good-skill", toolUse: true, loaded: false }) }), /loaded=false/],
  ["a description under 80 characters", () => skill("good-skill", { "SKILL.md": md("good-skill", "Use when x. Not for y.") }), /description is \d+ characters; a routing description needs at least 80/],
  ["a description with no Not-for clause", () => skill("good-skill", { "SKILL.md": md("good-skill", "Use when forging a skill for this repo and checking that its evidence is all there.") }), /must say what the skill is "Not for"/],
  ["a plain description containing a colon and a space (YAML rejects it)", () => skill("good-skill", { "SKILL.md": md("good-skill", "Use when forging a skill: for this repo and checking its evidence. Not for running skills at all.") }), /unquoted YAML scalar/],
  ["a duplicated frontmatter key", () => skill("good-skill", { "SKILL.md": `---\nname: good-skill\ndescription: ${DESC}\ndescription: ${DESC}\n---\n[a](references/gates.md) [b](scripts/tool.mjs)\n` }), /"description" appears twice/],
  ["a link that exists only inside an HTML comment", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md) <!-- [b](scripts/tool.mjs) -->\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside a code fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n```\n[b](scripts/tool.mjs)\n```\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a nested reference file reached only through its directory", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md) [b](scripts/tool.mjs) [c](references/sub)\n"), "references/sub/deep.md": "x\n" }), /references\/sub\/deep\.md exists but SKILL\.md does not link it/],
  ["an unlinked file in assets", () => skill("good-skill", { "assets/logo.txt": "x\n" }), /assets\/logo\.txt exists but SKILL\.md does not link it/],
  ["a baseline with an impossible date", () => skill("good-skill", { "evals/baseline.md": baselineText.replace("2026-10-15", "0000-00-00") }), /real, past date/],
  ["a SKILL.md over 500 lines", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md) [b](scripts/tool.mjs)\n" + "filler\n".repeat(500)) }), /over 500 lines/],
  ["a baseline dated before 2025", () => skill("good-skill", { "evals/baseline.md": baselineText.replace("2026-10-15", "1999-01-01") }), /real, past date/],
  ["an invocation proof whose Skill tool was never called", () => skill("good-skill", { "evals/invocation.json": JSON.stringify({ skill: "good-skill", toolUse: false, loaded: true, claude: "2.1", descriptionSha256: descriptionHash(DESC) }) }), /toolUse=false/],
  ["a baseline dated in the future", () => skill("good-skill", { "evals/baseline.md": baselineText.replace("2026-10-15", "2999-01-01") }), /real, past date/],
  ["a hollow baseline (rows of bars, an empty failure shape)", () => skill("good-skill", { "evals/baseline.md": ["# B", "recorded: 2026-10-15", "## Tasks run without the skill", "| a | b | c |", "|---|---|---|", "| | | |", "| | | |", "## Failure shape", "x", ""].join("\n") }), /at least two task rows of three filled cells/],
  ["a baseline with a thin failure shape", () => skill("good-skill", { "evals/baseline.md": baselineText.replace(/The task fails[^\n]*/, "It failed.") }), /failure shape is under 100 characters/],
  ["a skeptic finding that says 'not fixed'", () => skill("good-skill", { "evals/skeptic.md": "## Findings\n- the whole thing is broken and this is not fixed\n" }), /finding has no disposition/],
  ["a skeptic finding with an empty rejection", () => skill("good-skill", { "evals/skeptic.md": "## Findings\n- an alias was missing: rejected:\n" }), /finding has no disposition/],
  ["an invocation proof recorded for an older description", () => skill("good-skill", { "evals/invocation.json": JSON.stringify({ skill: "good-skill", toolUse: true, loaded: true, claude: "2.1", descriptionSha256: "0".repeat(64) }) }), /recorded for a different description/],
  ["an invocation proof with no claude version (typed by hand)", () => skill("good-skill", { "evals/invocation.json": JSON.stringify({ skill: "good-skill", toolUse: true, loaded: true, descriptionSha256: descriptionHash(DESC) }) }), /no claude version/],
  ["private-looking text the first PII list missed", () => skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[0].query = "order for 4400 Euclid Ave needs a skill that notes it for later"; return q; }) }), /contains a street address/],
  ["a link that exists only inside a tilde fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n~~~\n[b](scripts/tool.mjs)\n~~~\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside a four-backtick fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n````\n[b](scripts/tool.mjs)\n````\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside an inline code span", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md) `[b](scripts/tool.mjs)`\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside a blockquoted fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n> ```\n> [b](scripts/tool.mjs)\n> ```\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside a bulleted fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n- ```\n  [b](scripts/tool.mjs)\n  ```\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside a numbered-list fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n1. ```\n   [b](scripts/tool.mjs)\n   ```\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a link that exists only inside a blockquoted tilde fence", () => skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](references/gates.md)\n> ~~~md\n> [b](scripts/tool.mjs)\n> ~~~\n") }), /scripts\/tool\.mjs exists but SKILL\.md does not link it/],
  ["a skeptic finding that says 'not yet fixed'", () => skill("good-skill", { "evals/skeptic.md": "## Findings\n- the gate lets this through and it is not yet fixed\n" }), /finding has no disposition/],
  ["a skeptic finding that says 'not actually fixed'", () => skill("good-skill", { "evals/skeptic.md": "## Findings\n- the gate lets this through; not actually fixed\n" }), /finding has no disposition/],
  ["a skeptic finding that says 'unfixed'", () => skill("good-skill", { "evals/skeptic.md": "## Findings\n- the gate lets this through and it stays unfixed\n" }), /finding has no disposition/],
  ["a compiled package that fails validate.mjs", () => { const s = skill(); mkdirSync(join(s.dir, "provenance")); writeFileSync(join(s.dir, "provenance", "source.json"), "{}"); return s; }, /compiled from a source: validate\.mjs exited 1/],
]) {
  test(`names ${label}`, () => {
    const problems = errs(make());
    assert.ok(problems.some((p) => want.test(p)), `wanted ${want}; got ${JSON.stringify(problems)}`);
  });
}

test("a link after a fenced example still counts, and a prefixed fence does not swallow the text below it", () => {
  const s = skill("good-skill", { "SKILL.md": md("good-skill", DESC, "> ```\n> an example\n> ```\n\n[a](references/gates.md) [b](scripts/tool.mjs)\n") });
  assert.deepEqual(errs(s), []);
});

test("the skeptic error names the real grammar, not the old 'End each with fixed' wording", () => {
  const s = skill("good-skill", { "evals/skeptic.md": "## Findings\n- the whole thing is broken\n" });
  const msg = errs(s).find((p) => /finding has no disposition/.test(p));
  assert.ok(msg, "no disposition error");
  assert.doesNotMatch(msg, /End each with "fixed"/);
  assert.match(msg, /\. fixed.*; rejected: <why>.*; none found after trying: <what>/);
});

test("a link written ./references/x.md counts as linking references/x.md", () => {
  const s = skill("good-skill", { "SKILL.md": md("good-skill", DESC, "[a](./references/gates.md) [b](./scripts/tool.mjs)\n") });
  assert.deepEqual(errs(s), []);
});

test("prove stops with exit 2 when SKILL.md does not exist, instead of recording a proof for nothing", () => {
  const s = skill("good-skill", { "SKILL.md": null });
  const r = spawnSync(process.execPath, [FORGE, "prove", s.dir], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /does not exist: there is nothing to prove/);
  assert.equal(existsSync(join(s.dir, "evals", "invocation.json")), true, "the fixture's own proof is untouched");
});

test("--existing waives only the \"Use when\" start: a routing trigger anywhere is enough, and every other gate still applies", () => {
  const desc = "Run the thing. Use whenever you forge a skill for this repo. Not for running skills or auditing which ones fire.";
  const s = skill("good-skill", { "SKILL.md": md("good-skill", desc) });
  assert.ok(errs(s).some((p) => /must start with "Use when"/.test(p)));
  assert.ok(!errs(s, { existing: true }).some((p) => /Use when|routing trigger/.test(p)));
  const none = skill("good-skill", { "SKILL.md": md("good-skill", "A forge for skills that checks their evidence every time. Not for running skills at all today.") });
  assert.ok(errs(none, { existing: true }).some((p) => /no routing trigger/.test(p)));
  const noBaseline = skill("good-skill", { "SKILL.md": md("good-skill", desc), "evals/baseline.md": null });
  assert.ok(errs(noBaseline, { existing: true }).some((p) => /baseline\.md is missing/.test(p)));
});

test("a skill outside .claude/skills/<slug>/ is named, since it would validate and never load", () => {
  const root = join(base, String(seq++));
  const dir = join(root, "elsewhere", "good-skill");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: good-skill\ndescription: Use when x.\n---\n");
  assert.ok(checkSkill(dir).some((p) => /must be \.claude\/skills\/<slug>\//.test(p)));
});

const run = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SystemRoot: process.env.SystemRoot, GIT_CONFIG_NOSYSTEM: "1" } });
const commit = (cwd, paths, msg) => {
  run(cwd, ["add", "--", ...paths]);
  assert.equal(run(cwd, ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-m", msg]).status, 0);
};

test("--git: the baseline must be committed before SKILL.md, in an earlier commit", () => {
  const fresh = () => {
    const s = skill();
    assert.equal(run(s.root, ["init", "-q"]).status, 0);
    return s;
  };
  const rest = [".claude/skills/good-skill/references", ".claude/skills/good-skill/scripts", ".claude/skills/good-skill/evals/trigger-queries.json", ".claude/skills/good-skill/evals/skeptic.md", ".claude/skills/good-skill/evals/invocation.json"];
  const B = ".claude/skills/good-skill/evals/baseline.md";
  const S = ".claude/skills/good-skill/SKILL.md";

  let s = fresh(); // baseline first, then the skill: clean
  commit(s.root, [B], "baseline");
  commit(s.root, [S, ...rest], "skill");
  assert.deepEqual(errs(s, { git: true }), []);

  s = fresh(); // same commit
  commit(s.root, [B, S, ...rest], "both");
  assert.ok(errs(s, { git: true }).some((p) => /same commit/.test(p)));

  s = fresh(); // skill first
  commit(s.root, [S, ...rest], "skill");
  commit(s.root, [B], "baseline");
  assert.ok(errs(s, { git: true }).some((p) => /baseline commit is not an ancestor of the SKILL\.md commit/.test(p)));

  s = fresh(); // baseline rewritten after the skill existed
  commit(s.root, [B], "baseline");
  commit(s.root, [S, ...rest], "skill");
  writeFileSync(join(s.root, B), baselineText + "\nrewritten after the fact\n");
  commit(s.root, [B], "baseline rewritten");
  assert.ok(errs(s, { git: true }).some((p) => /baseline\.md was edited in [0-9a-f]{9}, after SKILL\.md was added/.test(p)));

  s = fresh(); // baseline edited BEFORE the skill is fine
  commit(s.root, [B], "baseline");
  writeFileSync(join(s.root, B), baselineText + "\nclarified\n");
  commit(s.root, [B], "baseline clarified");
  commit(s.root, [S, ...rest], "skill");
  assert.deepEqual(errs(s, { git: true }), []);

  s = fresh(); // baseline edited in the very commit that adds the skill
  commit(s.root, [B], "baseline");
  writeFileSync(join(s.root, B), baselineText + "\nrewritten once the skill was visible\n");
  commit(s.root, [B, S, ...rest], "skill and a baseline rewrite together");
  assert.ok(errs(s, { git: true }).some((p) => /baseline\.md was edited in [0-9a-f]{9}, after SKILL\.md was added/.test(p)));

  s = fresh(); // baseline never committed
  commit(s.root, [S, ...rest], "skill only");
  assert.ok(errs(s, { git: true }).some((p) => /baseline\.md is not committed yet/.test(p)));
});

test("--existing --git: tuning a skill that predates the tool is judged on this branch's commits, not on the commit that created SKILL.md", () => {
  const S = ".claude/skills/good-skill/SKILL.md";
  const B = ".claude/skills/good-skill/evals/baseline.md";
  const REST = [".claude/skills/good-skill/references", ".claude/skills/good-skill/scripts", ".claude/skills/good-skill/evals/trigger-queries.json", ".claude/skills/good-skill/evals/skeptic.md", ".claude/skills/good-skill/evals/invocation.json"];
  const touch = (s) => writeFileSync(join(s.dir, "SKILL.md"), readFileSync(join(s.dir, "SKILL.md"), "utf8") + "\nA tuning edit.\n");
  // main already holds the skill (no baseline: it predates the tool); the work happens on a branch.
  const onMain = ({ withBaseline = false } = {}) => {
    const s = skill();
    assert.equal(run(s.root, ["init", "-q", "-b", "main"]).status, 0);
    if (withBaseline) commit(s.root, [B], "baseline already on main");
    commit(s.root, [S, ...REST], "the skill, long before this tool");
    assert.equal(run(s.root, ["checkout", "-q", "-b", "tune"]).status, 0);
    return s;
  };
  const opts = { git: true, existing: true };

  let s = onMain(); // baseline first on the branch, then the SKILL.md edit: clean
  commit(s.root, [B], "baseline");
  touch(s);
  commit(s.root, [S], "tune the description");
  assert.deepEqual(errs(s, opts), []);

  s = onMain(); // the SKILL.md edit first, baseline after: the old order, caught
  touch(s);
  commit(s.root, [S], "tune the description");
  commit(s.root, [B], "baseline after the fact");
  assert.ok(errs(s, opts).some((p) => /baseline commit is not an ancestor of the SKILL\.md commit/.test(p)), JSON.stringify(errs(s, opts)));

  s = onMain(); // both in one commit
  touch(s);
  commit(s.root, [B, S], "tune and baseline together");
  assert.ok(errs(s, opts).some((p) => /same commit/.test(p)), JSON.stringify(errs(s, opts)));

  s = onMain(); // baseline rewritten after the SKILL.md edit
  commit(s.root, [B], "baseline");
  touch(s);
  commit(s.root, [S], "tune the description");
  writeFileSync(join(s.dir, "evals", "baseline.md"), baselineText + "\nrewritten after the fact\n");
  commit(s.root, [B], "baseline rewritten");
  assert.ok(errs(s, opts).some((p) => /baseline\.md was edited in [0-9a-f]{9}, after SKILL\.md was first changed on this branch/.test(p)), JSON.stringify(errs(s, opts)));

  s = onMain(); // SKILL.md untouched on the branch: nothing to order, and no false failure
  commit(s.root, [B], "baseline only");
  assert.deepEqual(errs(s, opts), []);

  s = onMain({ withBaseline: true }); // the baseline was already on main: a branch edit of SKILL.md after it is fine
  touch(s);
  commit(s.root, [S], "tune the description");
  assert.deepEqual(errs(s, opts), []);

  s = onMain({ withBaseline: true }); // ...but editing that baseline on the branch after the SKILL.md edit is not
  touch(s);
  commit(s.root, [S], "tune the description");
  writeFileSync(join(s.dir, "evals", "baseline.md"), baselineText + "\nrewritten after the fact\n");
  commit(s.root, [B], "baseline rewritten");
  assert.ok(errs(s, opts).some((p) => /baseline\.md was edited in/.test(p)), JSON.stringify(errs(s, opts)));

  // Without --existing the same history is judged by the commit that ADDED SKILL.md (long before the baseline): the strict rule still fails it.
  s = onMain();
  commit(s.root, [B], "baseline");
  touch(s);
  commit(s.root, [S], "tune the description");
  assert.ok(errs(s, { git: true }).some((p) => /not an ancestor/.test(p)), "the strict rule is unchanged for a new skill");
});

test("--existing --git with no main or origin/main to compare against says so instead of passing", () => {
  const s = skill();
  assert.equal(run(s.root, ["init", "-q", "-b", "side"]).status, 0);
  commit(s.root, [".claude/skills/good-skill/SKILL.md"], "skill");
  assert.ok(errs(s, { git: true, existing: true }).some((p) => /no origin\/main or main/.test(p)), JSON.stringify(errs(s, { git: true, existing: true })));
});

test("redact removes emails, phone numbers, urls, paths and tokens, and keeps ordinary text and long skill names", () => {
  const out = redact("mail jane.doe@example.com or call (216) 555-0147, see https://example.com/x?id=1, open C:\\Users\\jane\\a.txt and ~/notes, key sk-abcdefghijklmnop and ab12cd34ef56ab12cd34ef56ab12cd34ef56");
  for (const leak of ["jane.doe", "555-0147", "example.com", "C:\\Users", "~/notes", "sk-abcdefghij", "ab12cd34ef56ab12"]) assert.ok(!out.includes(leak), `${leak} survived: ${out}`);
  assert.equal(redact("run the nickstire-verifier-reel-pipeline skill on this"), "run the nickstire-verifier-reel-pipeline skill on this");
  assert.ok(redact("x".repeat(500)).length <= 300);
});

test("redact and the PII list catch the shapes a first draft missed", () => {
  const cases = {
    "call 2165550147 today": "2165550147",
    "call (216)555-0147 today": "555-0147",
    "open C:/Users/someone/Documents/notes.txt now": "someone",
    "open /c/Users/someone/x.txt now": "someone",
    "mail jane dot doe at gmail dot com please": "jane dot doe",
    "VIN 1HGCM82633A004352 on the invoice": "1HGCM82633A004352",
    "Maria Gonzalez at 4400 Euclid Ave called": "4400 Euclid Ave",
    "the box is 192.168.1.45 on the shop network": "192.168.1.45",
    "see nickstire.org/admin/customers/1042 for it": "customers/1042",
    "ssn 123-45-6789 is on the form": "123-45-6789",
    "open /workspace/MAINnicks-tire-autoNEW/customer/acme.txt now": "acme.txt",
    "see /opt/private/project/file.md for it": "file.md",
    "open `/opt/private/project/file.md` now": "file.md",
    "set path=/opt/private/project/file.md for it": "file.md",
    "see [/opt/private/project/file.md] for it": "file.md",
    "files /opt/private/a/one.md,/opt/private/b/two.md both": "one.md",
    "it lives at file:/opt/private/project/file.md today": "file.md",
    "it lives at file:///opt/private/project/file.md today": "file.md",
    "open //fileserver/share/clients/acme.txt now": "acme.txt", // a forward-slash UNC path: its second slash follows a slash
    'the value is "/opt/private/project/file.md" in it': "file.md",
    [`key ${["sk", "live", "abc123def456"].join("_")} leaked`]: "abc123def456", // built at run time so no secret scanner sees a key-shaped literal in the file
  };
  for (const [text, leak] of Object.entries(cases)) {
    assert.ok(!redact(text).includes(leak), `redact kept "${leak}": ${redact(text)}`);
    const s = skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => { q[0].query = `please ${text} and forge a skill`; return q; }) });
    assert.ok(errs(s).some((p) => /trigger-queries\[0\]: contains a /.test(p)), `check let through: ${text}`);
  }
  for (const fine of ["the monorepo skill got long, split it into references", "fix #3040 and the 2026-10-15 ledger row", "node 24 and claude 2.1.296 on windows", "src/calc.js and SKILL.md and forge.mjs", "add a /health page and read src/calc.js again", "a and/or b, 3/4 done, w/o the flag", "the 2026/10/15 ledger and a/b/c testing, read/write/exec bits", "an and/or/maybe split of input/output/error streams", "run ./scripts/agent-os/ledger-check.mjs and ../docs/agent-os/ledger.md again"]) {
    assert.equal(redact(fine), fine, `redact changed ordinary text: ${redact(fine)}`);
  }
});

test("heldOut: a mined row is assigned by its origin id (re-wording cannot move it), a written row by its text", () => {
  assert.equal(heldOut("one wording of a real prompt that is long enough", "tx:0123abcd"), heldOut("a different wording of the same real prompt entirely", "tx:0123abcd"));
  const flips = Array.from({ length: 40 }, (_, i) => heldOut(`variant ${i} of a written query about forging`, "written"));
  assert.ok(flips.includes(true) && flips.includes(false), "a written row is assigned by its text, so edits re-roll it (the reviewer sees origin written)");
});

test("heldOut ignores case and spacing, and holds out about 40% of arbitrary queries", () => {
  assert.equal(heldOut("Forge a skill for me"), heldOut("  forge a skill for me "));
  let n = 0;
  for (let i = 0; i < 2000; i++) if (heldOut(`query number ${i} for a skill`)) n++;
  assert.ok(n > 700 && n < 900, `held out ${n} of 2000`);
});

test("parseFrontmatter reads folded and quoted values", () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: "Use when x"\n---\n'), { name: "a", description: "Use when x" });
  assert.equal(parseFrontmatter("---\nname: a\ndescription: >\n  Use when x\n  and y\n---\n").description, "Use when x and y");
  assert.equal(parseFrontmatter("no frontmatter"), null);
});

// -- mine -------------------------------------------------------------------
const line = (o) => JSON.stringify(o) + "\n";
const human = (text, extra = {}) => line({ type: "user", origin: { kind: "human" }, message: { role: "user", content: text }, ...extra });
const fires = (skill, extra = {}) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill } }] }, ...extra });

test("mine returns sibling-fired and keyword prompts, redacted, and skips tool results, sidechains, slash commands and old files", async () => {
  const root = join(base, `mine-${seq++}`);
  mkdirSync(root, { recursive: true });
  const fresh = join(root, "a.jsonl");
  writeFileSync(
    fresh,
    [
      human("please run the whole backlog for jane.doe@example.com, call 216-555-0147 first"),
      fires("monorepo-manager"),
      human("how do I write a new skill for the reel pipeline without breaking triggers?"),
      human("what is the weather like at the shop today, nothing to do with tooling here"),
      line({ type: "user", origin: { kind: "human" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "a skill result" }] } }),
      human("a skill question from a subagent that must not count at all", { isSidechain: true }),
      fires("monorepo-manager", { isSidechain: true }),
      human("a harness reminder, ordinary words, about writing a new skill", { isMeta: true }),
      line({ type: "user", origin: { kind: "human" }, message: { role: "user", content: [{ type: "text", text: "text beside a tool result about a new skill" }, { type: "tool_result", tool_use_id: "t2", content: "x" }] } }),
      human("which skills have actually fired in the last month, and which are dead weight?"),
      fires("skill-fire-audit"),
      human("Base directory for this skill: somewhere. A skill body the harness injected about a new skill", { isMeta: true }),
      human("Base directory for this skill: somewhere. The same body without the meta flag, about a new skill"),
      human("This session is being continued from a previous conversation. The skill summary below is the model's, not the operator's"),
      human("/skill-forge make me a skill from this"),
      human("<command-message>skill</command-message> make a skill"),
      // Headless `claude -p` runs (this tool's own score runs, a sibling's test) write user lines too: turnOrigin "sdk", and NO origin field.
      line({ type: "user", turnOrigin: "sdk", entrypoint: "claude-desktop", message: { role: "user", content: "a prompt that a headless run was given, about writing a new skill for the sdk" } }),
      line({ type: "user", entrypoint: "sdk-cli", message: { role: "user", content: "a prompt from the cli print mode, about writing a new skill for the cli" } }),
      line({ type: "user", origin: { kind: "task-notification" }, turnOrigin: "human", message: { role: "user", content: "a notification payload that mentions writing a new skill" } }),
      // An older transcript line carries neither field (10,278 such user lines in 60 days here, mostly tool results): no field is not a reason to refuse it.
      line({ type: "user", message: { role: "user", content: "an older transcript line with neither field, about writing a skill from a runbook" } }),
      // The real shape of an operator turn today: origin human, turnOrigin human.
      line({ type: "user", origin: { kind: "human" }, turnOrigin: "human", entrypoint: "claude-desktop", message: { role: "user", content: "can you turn this runbook into a skill that loads by its exact name?" } }),
    ].join(""),
  );
  const old = join(root, "old.jsonl");
  writeFileSync(old, human("an ancient prompt about writing a skill that is far too old to use"));
  const longAgo = new Date(Date.now() - 400 * 86_400_000);
  utimesSync(old, longAgo, longAgo);

  const out = await mine({ root, keywords: ["skill"], skills: ["monorepo-manager"], adjacent: ["skill-fire-audit"], days: 60, limit: 10 });
  const sib = out.filter((e) => e.source === "sibling");
  const kw = out.filter((e) => e.source === "keyword");
  assert.equal(sib.length, 1);
  assert.deepEqual(sib[0].fired, ["monorepo-manager"]);
  assert.ok(!/jane\.doe|555-0147/.test(sib[0].query), sib[0].query);
  assert.match(sib[0].query, /\[email\]/);
  assert.deepEqual(kw.map((e) => e.query).sort(), ["an older transcript line with neither field, about writing a skill from a runbook", "can you turn this runbook into a skill that loads by its exact name?", "how do I write a new skill for the reel pipeline without breaking triggers?"].sort());
  const adj = out.filter((e) => e.source === "adjacent");
  assert.deepEqual(adj.map((e) => [e.query, e.fired]), [["which skills have actually fired in the last month, and which are dead weight?", ["skill-fire-audit"]]]);
  assert.ok(out.every((e) => /^tx:[0-9a-f]{8}$/.test(e.origin)));
  assert.ok(!out.some((e) => /ancient|subagent|weather|tool_result|make me a skill|Base directory|being continued|harness reminder|beside a tool result|headless|print mode|notification payload/.test(e.query)), JSON.stringify(out));
});

test("mine on a root with no transcripts returns nothing instead of throwing", async () => {
  assert.deepEqual(await mine({ root: join(base, "does-not-exist"), keywords: ["x"] }), []);
});

// -- prove ------------------------------------------------------------------
const stream = (...events) => events.map((e) => JSON.stringify(e)).join("\n");
const useEvt = (skill, id = "u1") => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] } });
const resultEvt = (id = "u1", is_error = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content: "Launching skill" }] } });

test("parseInvocation: loaded, plugin-prefixed, wrong skill, errored, never called", () => {
  assert.deepEqual(parseInvocation(stream(useEvt("skill-forge"), resultEvt()), "skill-forge"), { toolUse: true, loaded: true });
  assert.deepEqual(parseInvocation(stream(useEvt("repo:skill-forge"), resultEvt()), "skill-forge"), { toolUse: true, loaded: true });
  assert.deepEqual(parseInvocation(stream(useEvt("other"), resultEvt()), "skill-forge"), { toolUse: false, loaded: false });
  assert.deepEqual(parseInvocation(stream(useEvt("skill-forge"), resultEvt("u1", true)), "skill-forge"), { toolUse: true, loaded: false });
  assert.deepEqual(parseInvocation(stream(useEvt("skill-forge")), "skill-forge"), { toolUse: true, loaded: false });
  assert.deepEqual(parseInvocation("not json\n", "skill-forge"), { toolUse: false, loaded: false });
});

// -- score: the trigger instrument, run against a fake claude ---------------
const callEvt = (skill) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Skill", input: { skill } }] } });

test("skillCalls lists Skill tool calls in order and ignores other tools and user events", () => {
  const text = stream({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "x" } }] } }, callEvt("a"), { type: "user", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "no" } }] } }, callEvt("repo:b"));
  assert.deepEqual(skillCalls(text), ["a", "repo:b"]);
  assert.deepEqual(skillCalls("garbage\n"), []);
});

test("claudeCommand: CLAUDE_BIN wins, non-Windows is plain claude, Windows finds claude.exe on PATH or beside the npm shim", () => {
  assert.equal(claudeCommand({ CLAUDE_BIN: "/x/claude" }, "win32"), "/x/claude");
  assert.equal(claudeCommand({ PATH: "/usr/bin" }, "linux"), "claude");
  const direct = join(base, `bin-${seq++}`);
  mkdirSync(direct, { recursive: true });
  writeFileSync(join(direct, "claude.exe"), "");
  assert.equal(claudeCommand({ PATH: `C:\\nowhere;${direct}` }, "win32"), join(direct, "claude.exe"));
  const npm = join(base, `npm-${seq++}`);
  mkdirSync(join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin"), { recursive: true });
  writeFileSync(join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"), "");
  writeFileSync(join(npm, "claude.cmd"), "");
  assert.equal(claudeCommand({ PATH: npm }, "win32"), join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  assert.equal(claudeCommand({ PATH: "C:\\nowhere" }, "win32"), "claude");
});

/** A fake claude: reads the prompt after -p. Control prompt and queries containing TRIGGER call the Skill tool; CRASH exits 1 with nothing. */
function fakeClaude({ controlLoads = true } = {}) {
  const file = join(base, `fake-${seq++}.mjs`);
  writeFileSync(
    file,
    `const a = process.argv.slice(2); const p = a[a.indexOf("-p") + 1];
const call = (s) => console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Skill", input: { skill: s } }] } }));
const text = () => console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }));
if (p.startsWith("Use the Skill tool")) { ${controlLoads ? 'call(p.match(/named exactly (\\S+)\\./)[1])' : "text()"}; }
else if (p.includes("CRASH")) process.exit(1);
else if (p.includes("TRIGGER")) call("score-skill");
else text();`,
  );
  return { CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: JSON.stringify([file]) };
}
async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}
const scoreSkill = (queries) => {
  const s = skill("score-skill", { "evals/trigger-queries.json": JSON.stringify(queries.map(([query, should_trigger]) => ({ query, should_trigger, heldOut: false, origin: "written" }))) });
  return s.dir;
};

test("score: triggers are counted, a crashed run is VOID and never a quiet 'did not trigger', and the control runs first", async () => {
  const dir = scoreSkill([["please TRIGGER the skill on this request", true], ["a request that should stay quiet at all", false], ["a request that should trigger but does not", true], ["a negative query where the process CRASH es", false]]);
  const r = await withEnv(fakeClaude(), () => score({ dir, set: "all", runs: 1, workers: 2, cwd: dir }));
  assert.equal(r.void, false);
  const get = (prefix) => r.results.find((x) => x.query.startsWith(prefix));
  assert.equal(get("please TRIGGER").pass, true);
  assert.equal(get("a request that should stay quiet").pass, true);
  assert.equal(get("a request that should trigger").pass, false);
  const crashed = r.results.find((x) => x.query.includes("CRASH"));
  assert.equal(crashed.voided, 1);
  assert.equal(crashed.pass, false, "a crash on a should-NOT-trigger query must not pass: that is the official harness's silent-zero");
  assert.equal(r.voided, 1);
  assert.equal(r.correct, 2);
});

test("score: if the positive control does not load the skill, the instrument is dead and no score is returned", async () => {
  const dir = scoreSkill([["please TRIGGER the skill on this request", true]]);
  const r = await withEnv(fakeClaude({ controlLoads: false }), () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.void, true);
  assert.match(r.reason, /positive control failed/);
  assert.deepEqual(r.results, []);
});

test("score: a claude binary that cannot be started voids the control with the OS error", async () => {
  const dir = scoreSkill([["please TRIGGER the skill on this request", true]]);
  const r = await withEnv({ CLAUDE_BIN: join(base, "no-such-binary.exe"), CLAUDE_BIN_ARGS: "" }, () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.void, true);
  assert.match(r.reason, /process failed \(exit null\): .*ENOENT/);
});

test("score: a set other than heldout, train or all is an error, not a silent train run", async () => {
  const dir = scoreSkill([["please TRIGGER the skill on this request", true]]);
  await assert.rejects(() => score({ dir, set: "held-out", cwd: dir }), /--set must be heldout, train or all/);
  const r = spawnSync(process.execPath, [FORGE, "score", dir, "--set", "Held-Out"], { encoding: "utf8" });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /--set must be heldout, train or all/);
});

test("score: a run that hit the turn cap is counted as a miss but reported as capped", async () => {
  const file = join(base, `cap-${seq++}.mjs`);
  writeFileSync(file, `const a = process.argv.slice(2); const p = a[a.indexOf("-p") + 1];
const call = (s) => console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Skill", input: { skill: s } }] } }));
if (p.startsWith("Use the Skill tool")) call(p.match(/named exactly (\\S+)\\./)[1]);
else { console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } })); console.log(JSON.stringify({ type: "result", subtype: "error_max_turns" })); process.exit(1); }`);
  const dir = scoreSkill([["please TRIGGER the skill on this request", true]]);
  const r = await withEnv({ CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: JSON.stringify([file]) }, () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.results[0].pass, false);
  assert.equal(r.results[0].capped, 1);
  assert.equal(r.capped, 1);
});

const PRELUDE = `const a = process.argv.slice(2); const p = a[a.indexOf("-p") + 1];
const call = (s) => console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Skill", input: { skill: s } }] } }));
const text = () => console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }));
const control = p.startsWith("Use the Skill tool"); const name = control ? p.match(/named exactly (\\S+)\\./)[1] : "";
`;
const fakeBody = (body) => {
  const f = join(base, `fk-${seq++}.mjs`);
  writeFileSync(f, PRELUDE + body);
  return { CLAUDE_BIN: process.execPath, CLAUDE_BIN_ARGS: JSON.stringify([f]) };
};

test("score: a claude that exits nonzero after answering the control voids the run (an exit code is evidence)", async () => {
  const dir = scoreSkill([["please TRIGGER the skill on this request", true]]);
  const r = await withEnv(fakeBody("if (control) { call(name); process.exit(1); } else text();"), () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.void, true);
  assert.match(r.reason, /positive control failed.*process failed \(exit 1\)/);
});

test("score: a query run that exits nonzero after answering is VOID, not a quiet miss", async () => {
  const dir = scoreSkill([["a request that should stay quiet at all", false]]);
  const r = await withEnv(fakeBody("if (control) call(name); else { text(); process.exit(1); }"), () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.void, false);
  assert.equal(r.results[0].voided, 1);
  assert.equal(r.results[0].pass, false, "a crashed run on a should-NOT-trigger query must not pass");
  assert.equal(r.voided, 1);
});

test("score: a run killed or unable to start has no exit code and is VOID even if it printed an assistant line", async () => {
  const dir = scoreSkill([["a request that should stay quiet at all", false]]);
  const r = await withEnv(fakeBody("if (control) call(name); else { text(); process.kill(process.pid, 'SIGKILL'); }"), () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.results[0].voided, 1);
});

test("score: a service refusal mid-run (a rate_limit_event and a synthetic assistant message, even with exit 0) is VOID, not a quiet miss", async () => {
  const refusal = 'console.log(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "seven_day" } })); console.log(JSON.stringify({ type: "assistant", message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "You have hit your weekly limit" }] } }));';
  for (const exit of [0, 1]) {
    // the control loads the skill, then every query is refused: without the rule each negative would pass and each positive would fail silently
    const dir = scoreSkill([["a request that should stay quiet at all", false]]);
    const r = await withEnv(fakeBody("if (control) call(name); else { " + refusal + " process.exit(" + exit + "); }"), () => score({ dir, set: "all", cwd: dir }));
    assert.equal(r.void, false, "exit " + exit);
    assert.equal(r.results[0].voided, 1, "exit " + exit + ": the refusal must void the run");
    assert.equal(r.results[0].pass, false, "a refused run on a should-NOT-trigger query must not pass");
  }
  // and a refused control voids the whole score
  const dir = scoreSkill([["a request that should stay quiet at all", false]]);
  const r = await withEnv(fakeBody(refusal + " process.exit(0);"), () => score({ dir, set: "all", cwd: dir }));
  assert.equal(r.void, true);
});

test("prove: a run that fails leaves the existing proof untouched and exits 1; a run that works records loaded and the hash", () => {
  const run = (env, s) => spawnSync(process.execPath, [FORGE, "prove", s.dir], { encoding: "utf8", env: { ...process.env, ...env } });
  const failing = fakeBody("if (control) { call(name); process.exit(1); } else text();");
  const s = skill("good-skill");
  const before = readFileSync(join(s.dir, "evals", "invocation.json"), "utf8");
  const bad = run(failing, s);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.equal(readFileSync(join(s.dir, "evals", "invocation.json"), "utf8"), before, "a failed run must not overwrite a good proof");
  assert.match(bad.stderr, /prove FAILED/);
  const good = run(fakeBody("if (control) { call(name); console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } })); } else text();"), s);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const written = JSON.parse(readFileSync(join(s.dir, "evals", "invocation.json"), "utf8"));
  assert.equal(written.loaded, true);
  assert.equal(written.toolUse, true);
  assert.equal(written.descriptionSha256, descriptionHash(DESC));
});

test("every claude -p run this tool starts is told not to persist its session (score and prove runs must not become 'real prompts' in the transcripts)", async () => {
  const log = join(base, `argv-${seq++}.log`);
  const dir = scoreSkill([["a request that should stay quiet at all", false]]);
  const body = 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.ARGV_LOG, JSON.stringify(a) + "\\n"); if (control) call(name); else text();';
  await withEnv({ ...fakeBody(body), ARGV_LOG: log }, () => score({ dir, set: "all", cwd: dir }));
  const runs = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(runs.length, 2, "one control run and one query run");
  for (const a of runs) assert.ok(a.includes("--no-session-persistence"), `argv without the flag: ${JSON.stringify(a)}`);
});

test("score: set selects train or held-out rows only", async () => {
  const s = skill("score-skill", { "evals/trigger-queries.json": JSON.stringify([{ query: "TRIGGER one query for the train side", should_trigger: true, heldOut: false }, { query: "TRIGGER one query for the held out side", should_trigger: true, heldOut: true }]) });
  const held = await withEnv(fakeClaude(), () => score({ dir: s.dir, set: "heldout", cwd: s.dir }));
  assert.deepEqual(held.results.map((x) => x.query), ["TRIGGER one query for the held out side"]);
  const train = await withEnv(fakeClaude(), () => score({ dir: s.dir, set: "train", cwd: s.dir }));
  assert.deepEqual(train.results.map((x) => x.query), ["TRIGGER one query for the train side"]);
});

test("verify-origins: ids that resolve to a real prompt pass, an id found in no transcript fails", () => {
  const root = join(base, `vo-${seq++}`);
  mkdirSync(root, { recursive: true });
  const real = "please tell me how to turn this runbook into a repo skill that loads";
  const sdkOnly = "please add a health page to a small express app that shows uptime and memory";
  writeFileSync(join(root, "a.jsonl"), human(real) + line({ type: "user", turnOrigin: "sdk", message: { role: "user", content: sdkOnly } }));
  const queries = [{ query: "a paraphrase of the runbook prompt about a repo skill", should_trigger: true, heldOut: false, origin: originId(redact(real)) }, { query: "a query claiming a prompt that never existed anywhere", should_trigger: false, heldOut: false, origin: "tx:deadbeef" }, { query: "a health page request that only a headless run ever received", should_trigger: false, heldOut: false, origin: originId(redact(sdkOnly)) }];
  const s = skill("good-skill", { "evals/trigger-queries.json": JSON.stringify(queries) });
  const r = spawnSync(process.execPath, [FORGE, "verify-origins", s.dir, "--root", root], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /tx:deadbeef is in no transcript on this machine/);
  assert.ok(r.stderr.includes(`${originId(redact(sdkOnly))} is in no transcript`), "a prompt that only an SDK run received is not a real operator prompt: " + r.stderr);
  assert.match(r.stdout, /1 of 3 tx: ids resolve/);
  const ok = skill("good-skill", { "evals/trigger-queries.json": JSON.stringify([queries[0]]) });
  assert.equal(spawnSync(process.execPath, [FORGE, "verify-origins", ok.dir, "--root", root], { encoding: "utf8" }).status, 0);
});

// -- CLI and the real library -----------------------------------------------
test("CLI: check exits 1 with the problem on stderr and 0 on a clean skill; split --write repairs the held-out flags", () => {
  const bad = skill("good-skill", { "evals/skeptic.md": null });
  const r = spawnSync(process.execPath, [FORGE, "check", bad.dir], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ERROR  evals\/skeptic\.md is missing/);
  assert.equal(spawnSync(process.execPath, [FORGE, "check", skill().dir], { encoding: "utf8" }).status, 0);

  const s = skill("good-skill", { "evals/trigger-queries.json": mutateQueries((q) => q.map((e) => ({ ...e, heldOut: !e.heldOut }))) });
  assert.ok(errs(s).some((p) => /heldOut is/.test(p)));
  assert.equal(spawnSync(process.execPath, [FORGE, "split", s.dir, "--write"], { encoding: "utf8" }).status, 0);
  assert.deepEqual(errs(s), []);
});

test("forge.mjs launched through a junction still runs (a raw argv comparison made a linked launch exit 0 having done nothing)", () => {
  const real = join(base, `launch-${seq++}`);
  mkdirSync(real);
  copyFileSync(FORGE, join(real, "forge.mjs"));
  const link = join(base, `launch-link-${seq++}`);
  symlinkSync(real, link, "junction");
  try {
    const bad = skill("good-skill", { "evals/skeptic.md": null });
    const r = spawnSync(process.execPath, [join(link, "forge.mjs"), "check", bad.dir], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /ERROR  evals\/skeptic\.md is missing/);
    assert.equal(spawnSync(process.execPath, [join(link, "forge.mjs")], { encoding: "utf8" }).status, 64, "no command prints usage and exits 64");
  } finally {
    try {
      rmdirSync(link); // Windows: a junction is a directory entry
    } catch {
      unlinkSync(link); // POSIX: it is a symlink
    }
  }
});

/** Name equal to the folder plus a description; a vendored upstream copy (see vendoredSkill.mjs) may keep its upstream name. */
function libraryProblems(skillsRoot, repoRoot) {
  const bad = [];
  let n = 0;
  for (const d of readdirSync(skillsRoot)) {
    const f = join(skillsRoot, d, "SKILL.md");
    if (!existsSync(f)) continue;
    n++;
    const fm = parseFrontmatter(readFileSync(f, "utf8"));
    const nameOk = fm?.name === d || isVendoredSkill(join(skillsRoot, d), repoRoot);
    if (!nameOk || !fm?.description) bad.push(`${d}: name=${fm?.name} description=${fm?.description ? "ok" : "missing"}`);
  }
  return { n, bad };
}

test("every skill in the library has name equal to its directory and a description (57 of 57 on 2026-10-15)", () => {
  const { n, bad } = libraryProblems(join(REPO, ".claude", "skills"), REPO);
  assert.ok(n >= 57, `only ${n} skills read`);
  assert.deepEqual(bad, []);
});

test("the name gate still fires on a repo skill, and bends only for a vendored copy the register names", () => {
  const sha = "fedcba9876543210fedcba9876543210fedcba98";
  const root = mkdtempSync(join(tmpdir(), "lib-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "UPSTREAMS.md"), `| up | cap | ADOPTED | \`${sha}\` |\n`);
    const add = (dir, name, source, desc = "d") => {
      mkdirSync(join(root, ".claude", "skills", dir), { recursive: true });
      writeFileSync(join(root, ".claude", "skills", dir, "SKILL.md"), `---\nname: ${name}\n${desc ? `description: ${desc}\n` : ""}---\nbody\n`);
      if (source) writeFileSync(join(root, ".claude", "skills", dir, "SOURCE.md"), source);
    };
    add("ok", "ok", null);
    add("renamed", "other", null);
    add("vend", "upstream-name", `Pinned: ${sha}\n`);
    add("vend-unregistered", "upstream-name", `Pinned: ${"1".repeat(40)}\n`);
    add("vend-nodesc", "upstream-name", `Pinned: ${sha}\n`, "");
    const { bad } = libraryProblems(join(root, ".claude", "skills"), root);
    assert.deepEqual(bad.map((b) => b.split(":")[0]).sort(), ["renamed", "vend-nodesc", "vend-unregistered"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The CLAUDE.md count sentence: total, then repo-specific + always-on (+ vendored when any skill is vendored). */
function skillCountProblems(text, dirs, vendoredDirs) {
  const m = /`\.claude\/skills\/`, (\d+): (\d+) repo-specific \+ (\d+) always-on stance files(?: \+ (\d+) vendored)?/.exec(text);
  if (!m) return ["the skill count sentence in CLAUDE.md was not found: update this test with the sentence, do not delete it"];
  const [total, repo, stance, vendored] = [m[1], m[2], m[3], m[4] ?? 0].map(Number);
  const problems = [];
  if (total !== dirs) problems.push(`CLAUDE.md says ${total} skills, the directory holds ${dirs}`);
  if (repo + stance + vendored !== total) problems.push("the parts must sum to the total");
  if (vendored !== vendoredDirs) problems.push(`CLAUDE.md says ${vendored} vendored, the directory holds ${vendoredDirs}`);
  return problems;
}

test("CLAUDE.md states the skill count and it matches the directories (a count in prose is a cache with no invalidation)", () => {
  const root = join(REPO, ".claude", "skills");
  const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, "SKILL.md")));
  const vendored = dirs.filter((d) => isVendoredSkill(join(root, d), REPO)).length;
  assert.deepEqual(skillCountProblems(readFileSync(join(REPO, "CLAUDE.md"), "utf8"), dirs.length, vendored), []);
});

test("the count gate catches a stale total, a bad sum and a hidden vendored count", () => {
  const s = (a, b, c, v) => `- **Skills** (\`.claude/skills/\`, ${a}: ${b} repo-specific + ${c} always-on stance files${v === undefined ? "" : ` + ${v} vendored`}; invoke`;
  assert.deepEqual(skillCountProblems(s(80, 40, 19, 21), 80, 21), []);
  assert.deepEqual(skillCountProblems(s(59, 40, 19), 59, 0), []);
  assert.match(skillCountProblems(s(80, 40, 19, 21), 81, 21)[0], /directory holds 81/);
  assert.match(skillCountProblems(s(80, 40, 19, 20), 80, 21).join("|"), /sum to the total/);
  assert.match(skillCountProblems(s(80, 40, 19, 21), 80, 20).join("|"), /holds 20/);
  assert.match(skillCountProblems(s(80, 61, 19), 80, 21).join("|"), /holds 21/);
  assert.match(skillCountProblems("no sentence here", 80, 21)[0], /not found/);
});

test("the real skill-forge passes its own gates", () => {
  const dir = join(REPO, ".claude", "skills", "skill-forge");
  const problems = checkSkill(dir);
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});
