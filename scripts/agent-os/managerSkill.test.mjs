/**
 * Canary for the monorepo-manager skill (2026-10-15; extended 2026-10-22).
 *
 * The skill is a router: SKILL.md stays short and pushes detail into references/. Two things go wrong silently:
 * a reference that SKILL.md names but that does not exist (the model loads nothing), and a reference that exists
 * but nothing links (it is never read). The replay file maps every defect of the 2026-10-15 guard job to the step
 * that would have caught it; if a step is renamed or removed, the replay row points at nothing and this goes red.
 * The twelve upgrades (a-l in the job brief) must each catch at least one witnessed defect, so none is decoration.
 *
 * 2026-10-22 (job manager-skill-best): a second replay (references/replay-2026-10-22.md, the relay day, mistakes a-f)
 * must resolve the same way, and each of its "Check" cells must say "written only" or name a check script AND its
 * canary that both exist; the skill map (references/skill-map.md) may name only real steps, and every skill it marks
 * "repo" must exist in .claude/skills (a fresh clone and CI have no ~/.claude/skills, so "machine" rows carry a fallback).
 *
 * Shape (positive-control-first): check(root) is the whole gate. It is proven on throwaway skill trees first (a clean
 * tree reads clean, each single defect is named by its own message), then pointed at this repo.
 *
 * Run: node --test scripts/agent-os/managerSkill.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SKILL = ".claude/skills/monorepo-manager";
const REPLAY = "references/replay-2026-10-15.md";
const REPLAY2 = "references/replay-2026-10-22.md";
const SKILL_MAP = "references/skill-map.md";
const MAX_LINES = 120;
const UPGRADES = [..."abcdefghijkl"];
const MISTAKES = [..."abcdef"];
const CHECK_CELL = /^`(scripts\/agent-os\/[\w.-]+\.mjs)` \(canary: `(scripts\/agent-os\/[\w.-]+\.test\.mjs)`\)$/;

const lines = (text) => text.split(/\r?\n/);

/** Every way the skill tree under <root> is wrong, one string each. homeSkills: the machine's ~/.claude/skills, if any. */
function check(root, { homeSkills = join(homedir(), ".claude", "skills") } = {}) {
  const problems = [];
  const dir = join(root, SKILL);
  let skill;
  try {
    skill = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    return ["SKILL.md is missing"];
  }
  const n = lines(skill).length - (skill.endsWith("\n") ? 1 : 0);
  if (n > MAX_LINES) problems.push(`SKILL.md is ${n} lines; it is a router, so detail goes in references/ (cap ${MAX_LINES})`);
  if (!/^name: monorepo-manager\s*$/m.test(skill)) problems.push("frontmatter name must equal the directory name, monorepo-manager");

  // Links by exact path, both directions. Only a markdown link counts: a path named in prose is never read (skeptic 2026-10-22).
  const named = new Set([...skill.matchAll(/\]\((references\/[A-Za-z0-9._-]+\.md)\)/g)].map((m) => m[1]));
  for (const m of skill.matchAll(/(?<!\]\()\b(references\/[A-Za-z0-9._-]+\.md)\b(?!\))/g)) {
    if (!named.has(m[1])) problems.push(`SKILL.md names ${m[1]} in prose only; link it as [text](${m[1]}) or it is never read`);
  }
  let onDisk = [];
  try {
    onDisk = readdirSync(join(dir, "references")).map((f) => `references/${f}`);
  } catch {
    /* no references dir: every named path is reported missing below */
  }
  for (const p of named) if (!onDisk.includes(p)) problems.push(`SKILL.md names ${p}, which does not exist`);
  for (const p of onDisk) if (!named.has(p)) problems.push(`${p} exists but SKILL.md does not link it by exact path, so nothing will read it`);

  const steps = new Map([...skill.matchAll(/^(\d+)\. \*\*([^*]+?)\.\*\*/gm)].map((m) => [Number(m[1]), m[2]]));
  problems.push(...replayProblems(root, dir, REPLAY, UPGRADES, steps));
  problems.push(...replayProblems(root, dir, REPLAY2, MISTAKES, steps, { checkCell: true }));
  problems.push(...skillMapProblems(root, dir, steps, homeSkills));
  return problems;
}

/** One replay: every row's "New step" names a real numbered step, every letter is covered, the In order list matches. */
function replayProblems(root, dir, file, letters, steps, { checkCell = false } = {}) {
  let replay = "";
  try {
    replay = readFileSync(join(dir, file), "utf8");
  } catch {
    return [`${file} is missing: the upgrades have no witnessed defect behind them`];
  }
  const problems = [];
  const covered = new Set();
  const rows = lines(replay).filter((l) => /^\|\s*[a-l]\s*\|/.test(l));
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    const [letter, , , , ref, checkText] = cells.slice(1);
    if (checkCell) {
      const c = CHECK_CELL.exec(checkText ?? "");
      if (checkText !== "written only" && !c) problems.push(`${file} row ${letter}: the Check cell must be "written only" or a script with its canary, got "${checkText}"`);
      for (const p of c ? [c[1], c[2]] : []) if (!existsSync(join(root, p))) problems.push(`${file} row ${letter}: the Check cell names ${p}, which does not exist`);
      // The canary must be about that script: an unrelated existing test file proves nothing (skeptic 2026-10-22).
      if (c && existsSync(join(root, c[2])) && !readFileSync(join(root, c[2]), "utf8").includes(basename(c[1]))) {
        problems.push(`${file} row ${letter}: the canary ${c[2]} never names ${basename(c[1])}, so it is not that check's canary`);
      }
    }
    const m = /^(\d+) (.+)$/.exec(ref ?? "");
    if (!m) {
      problems.push(`replay row ${letter}: "New step" cell "${ref}" must read "<number> <step name>"`);
      continue;
    }
    if (steps.get(Number(m[1])) !== m[2]) problems.push(`replay row ${letter}: SKILL.md has no step "${m[1]}. **${m[2]}.**" (step ${m[1]} is "${steps.get(Number(m[1])) ?? "absent"}")`);
    else covered.add(letter);
  }
  for (const u of letters) if (!covered.has(u)) problems.push(`upgrade ${u} has no replay row that resolves to a real step (${file})`);

  // The "In order" list: each line starts with a step number and the name SKILL.md gives it, and the numbers ascend.
  const order = /^## In order[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(replay)?.[1];
  if (order === undefined) problems.push(`the replay has no '## In order' section (${file})`);
  else {
    const items = lines(order).filter((l) => l.startsWith("- "));
    if (!items.length) problems.push(`the replay's 'In order' list has no '- <number> <step name>:' lines (${file})`);
    let last = 0;
    for (const l of items) {
      const m = /^- (\d+) ([^:]+):/.exec(l);
      if (!m) {
        problems.push(`replay 'In order' line must start "- <number> <step name>:": ${l.slice(0, 50)}`);
        continue;
      }
      const n = Number(m[1]);
      if (steps.get(n) !== m[2]) problems.push(`replay 'In order' says step ${n} is "${m[2]}"; SKILL.md says "${steps.get(n) ?? "absent"}"`);
      if (n <= last) problems.push(`replay 'In order' is not ascending at step ${n}`);
      last = n;
    }
  }
  return problems;
}

/** The skill map: each row's step is "every turn" or a real "<n> <name>"; each backticked skill on a "repo" row exists. */
function skillMapProblems(root, dir, steps, homeSkills) {
  let text;
  try {
    text = readFileSync(join(dir, SKILL_MAP), "utf8");
  } catch {
    return [`${SKILL_MAP} is missing: the narrower skills have no map`];
  }
  const problems = [];
  const rows = lines(text).filter((l) => l.startsWith("|") && !/^\|\s*(?:Step\b|-)/.test(l));
  if (!rows.length) problems.push(`${SKILL_MAP} has no rows`);
  for (const row of rows) {
    const [step, names = "", , where = ""] = row.split("|").map((c) => c.trim()).slice(1);
    const m = /^(\d+) (.+)$/.exec(step ?? "");
    if (step !== "every turn" && (!m || steps.get(Number(m[1])) !== m[2])) problems.push(`skill map: step "${step}" is not a step in SKILL.md`);
    const skills = [...names.matchAll(/`([a-z0-9-]+(?::[a-z0-9-]+)?)`/g)].map((x) => x[1]);
    if (!skills.length) problems.push(`skill map: the row for "${step}" names no skill in backticks`);
    if (/^plugin\b/.test(where)) {
      // A plugin row (2026-10-26) names `plugin:skill`, and its plugin is on the required list, so the [health] machine
      // line tells a session on an account without it how to enable it.
      let required = [];
      try { required = JSON.parse(readFileSync(join(root, "config", "agent-os", "required-plugins.json"), "utf8")).required.map((p) => p.name); } catch { /* reported below */ }
      for (const s of skills) {
        if (!s.includes(":")) problems.push(`skill map: ${s} is marked plugin but is not named plugin:skill`);
        else if (!required.includes(s.split(":")[0])) problems.push(`skill map: plugin ${s.split(":")[0]} is not in config/agent-os/required-plugins.json`);
      }
    } else if (where === "repo") {
      for (const s of skills) if (!existsSync(join(root, ".claude", "skills", s, "SKILL.md"))) problems.push(`skill map: ${s} is marked repo but .claude/skills/${s}/SKILL.md does not exist`);
    } else if (!/^machine\b/.test(where)) problems.push(`skill map: where "${where}" must be "repo" or start with "machine" or "plugin"`);
    // On a machine that has a user skills dir (NattyNour, not CI), a machine row's name must resolve there too.
    else if (existsSync(homeSkills)) {
      for (const s of skills) if (!existsSync(join(homeSkills, s, "SKILL.md"))) problems.push(`skill map: ${s} is marked machine but ${homeSkills}/${s}/SKILL.md does not exist`);
    }
  }
  return problems;
}

const base = mkdtempSync(join(tmpdir(), "mgrskill-"));
after(() => rmSync(base, { recursive: true, force: true }));
let seq = 0;

const STEP_NAMES = ["Recover state", "Probe it yourself", "Check the names"];
const goodSkill = () =>
  [
    "---",
    "name: monorepo-manager",
    "description: x",
    "---",
    "",
    ...STEP_NAMES.map((s, i) => `${i + 1}. **${s}.** text; see [a](references/a.md)`),
    `Replay: [r](${REPLAY}) and [r2](${REPLAY2}); map: [m](${SKILL_MAP})`,
    "",
  ].join("\n");
const replayOf = (letters, extraCell = () => "") =>
  [
    `| Upgrade | Defect | Evidence | Old skill | New step |${extraCell(-1) ? " Check |" : ""}`,
    "|---|---|---|---|---|",
    ...letters.map((u, i) => `| ${u} | d | e | o | ${(i % 3) + 1} ${STEP_NAMES[i % 3]} |${extraCell(i) ? ` ${extraCell(i)} |` : ""}`),
    "",
    "## In order: where each step fires",
    "",
    ...STEP_NAMES.map((s, i) => `- ${i + 1} ${s}: where it fires`),
    "",
  ].join("\n");
const goodReplay = () => replayOf(UPGRADES);
const goodReplay2 = () => replayOf(MISTAKES, (i) => (i < 0 ? "Check" : i === 0 ? "`scripts/agent-os/x.mjs` (canary: `scripts/agent-os/x.test.mjs`)" : "written only"));
const goodMap = () =>
  ["| Step | Skill | When | Where |", "|---|---|---|---|", "| every turn | `monorepo-manager` | always | repo |", "| 2 Probe it yourself | `guard-x` | guards | machine (fallback: y) |", ""].join("\n");

function tree(over = {}) {
  const root = join(base, String(seq++));
  const dir = join(root, SKILL);
  mkdirSync(join(dir, "references"), { recursive: true });
  mkdirSync(join(root, "scripts", "agent-os"), { recursive: true });
  writeFileSync(join(root, "scripts", "agent-os", "x.mjs"), "// fixture\n");
  writeFileSync(join(root, "scripts", "agent-os", "y.mjs"), "// another check\n");
  writeFileSync(join(root, "scripts", "agent-os", "x.test.mjs"), "// canary for x.mjs\n");
  mkdirSync(join(root, "home-skills", "guard-x"), { recursive: true });
  writeFileSync(join(root, "home-skills", "guard-x", "SKILL.md"), "x\n");
  mkdirSync(join(root, ".claude", "skills", "monorepo-manager"), { recursive: true });
  const files = { "SKILL.md": goodSkill(), "references/a.md": "a\n", [REPLAY]: goodReplay(), [REPLAY2]: goodReplay2(), [SKILL_MAP]: goodMap(), ...over };
  for (const [rel, text] of Object.entries(files)) if (text !== null) writeFileSync(join(dir, rel), text);
  return root;
}

const checkTree = (root) => check(root, { homeSkills: join(root, "home-skills") });

test("control: a clean skill tree reads clean", () => {
  assert.deepEqual(checkTree(tree()), []);
});

for (const [label, over, want] of [
  ["a SKILL.md over the router cap", { "SKILL.md": goodSkill() + "filler\n".repeat(MAX_LINES) }, /lines; it is a router/],
  ["a reference SKILL.md names that does not exist", { "SKILL.md": goodSkill() + "see [m](references/missing.md)\n" }, /names references\/missing\.md, which does not exist/],
  ["a reference named only in prose", { "SKILL.md": goodSkill() + "details live in references/b.md too\n", "references/b.md": "b\n" }, /names references\/b\.md in prose only/],
  ["a reference nothing links", { "references/orphan.md": "x\n" }, /references\/orphan\.md exists but SKILL\.md does not link it/],
  ["a replay row pointing at a renamed step", { [REPLAY]: goodReplay().replace("2 Probe it yourself", "2 Probe yourself") }, /no step "2\. \*\*Probe yourself\.\*\*"/],
  ["a replay row pointing at a removed step", { [REPLAY]: goodReplay().replace("3 Check the names", "9 Check the names") }, /step 9 is "absent"/],
  ["a replay row with no step reference", { [REPLAY]: goodReplay().replace("1 Recover state", "recover") }, /must read "<number> <step name>"/],
  ["an upgrade with no replay row", { [REPLAY]: goodReplay().split("\n").filter((l) => !l.startsWith("| k ")).join("\n") }, /upgrade k has no replay row/],
  ["a missing replay file", { [REPLAY]: null }, /replay-2026-10-15\.md is missing/],
  ["an 'In order' line with the wrong step number", { [REPLAY]: goodReplay().replace("- 2 Probe it yourself:", "- 3 Probe it yourself:") }, /'In order' says step 3 is "Probe it yourself"; SKILL\.md says "Check the names"/],
  ["an 'In order' list out of order", { [REPLAY]: goodReplay().replace("- 1 Recover state: where it fires\n- 2 Probe it yourself: where it fires", "- 2 Probe it yourself: where it fires\n- 1 Recover state: where it fires") }, /not ascending at step 1/],
  ["an 'In order' list that repeats a step", { [REPLAY]: goodReplay().replace("- 3 Check the names: where it fires", "- 2 Probe it yourself: again") }, /not ascending at step 2/],
  ["an 'In order' line naming a step that was removed", { [REPLAY]: goodReplay().replace("- 3 Check the names:", "- 9 Check the names:") }, /'In order' says step 9 is "Check the names"; SKILL\.md says "absent"/],
  ["an 'In order' line with no step number", { [REPLAY]: goodReplay().replace("- 2 Probe it yourself:", "- Probe it yourself:") }, /'In order' line must start "- <number> <step name>:"/],
  ["a replay with no 'In order' section", { [REPLAY]: goodReplay().split("## In order")[0] }, /no '## In order' section/],
  ["an empty 'In order' list", { [REPLAY]: goodReplay().split("## In order")[0] + "## In order: where each step fires\n\nnothing here\n" }, /'In order' list has no/],
  ["a renamed skill", { "SKILL.md": goodSkill().replace("name: monorepo-manager", "name: manager") }, /name must equal the directory name/],
  // 2026-10-22 replay
  ["a missing 2026-10-22 replay", { [REPLAY2]: null }, /replay-2026-10-22\.md is missing/],
  ["a 2026-10-22 mistake with no row", { [REPLAY2]: goodReplay2().split("\n").filter((l) => !l.startsWith("| f ")).join("\n") }, /upgrade f has no replay row .*replay-2026-10-22/],
  ["a 2026-10-22 row pointing at a removed step", { [REPLAY2]: goodReplay2().replace("| b | d | e | o | 2 Probe it yourself |", "| b | d | e | o | 7 Relay |") }, /step 7 is "absent"/],
  ["a Check cell that is neither a script nor 'written only'", { [REPLAY2]: goodReplay2().replace("written only", "a hook, probably") }, /Check cell must be "written only" or a script/],
  ["a Check cell naming a script that does not exist", { [REPLAY2]: goodReplay2().replace("scripts/agent-os/x.mjs", "scripts/agent-os/gone.mjs") }, /names scripts\/agent-os\/gone\.mjs, which does not exist/],
  ["a Check cell naming a canary that does not exist", { [REPLAY2]: goodReplay2().replace("x.test.mjs", "gone.test.mjs") }, /names scripts\/agent-os\/gone\.test\.mjs, which does not exist/],
  ["a Check cell whose canary is about another script", { [REPLAY2]: goodReplay2().replace("`scripts/agent-os/x.mjs`", "`scripts/agent-os/y.mjs`") }, /never names y\.mjs/],
  ["a machine skill this machine does not have", { [SKILL_MAP]: goodMap().replace("`guard-x`", "`guard-y`") }, /guard-y is marked machine but/],
  // skill map
  ["a missing skill map", { [SKILL_MAP]: null }, /skill-map\.md is missing/],
  ["a skill map row naming a step that does not exist", { [SKILL_MAP]: goodMap().replace("| 2 Probe it yourself |", "| 4 Relay |") }, /step "4 Relay" is not a step/],
  ["a repo skill that does not exist", { [SKILL_MAP]: goodMap().replace("`monorepo-manager`", "`no-such-skill`") }, /no-such-skill is marked repo/],
  ["a where cell that is neither repo nor machine", { [SKILL_MAP]: goodMap().replace("| machine (fallback: y) |", "| somewhere |") }, /where "somewhere" must be/],
  ["a skill map row with no skill in backticks", { [SKILL_MAP]: goodMap().replace("`guard-x`", "guard-x") }, /names no skill in backticks/],
]) {
  test(`names ${label}`, () => {
    const problems = checkTree(tree(over));
    assert.ok(problems.some((p) => want.test(p)), `wanted ${want}; got ${JSON.stringify(problems)}`);
  });
}

test("skill map plugin rows: a plugin off the required list, or a bare name on a plugin row, is a problem; a listed one passes", () => {
  const dir = mkdtempSync(join(base, "pluginmap-"));
  const row = (name) => `| Step | Skill | When | Where |\n|---|---|---|---|\n| every turn | \`${name}\` | x | plugin (fallback: none) |\n`;
  mkdirSync(dirname(join(dir, SKILL_MAP)), { recursive: true });
  const run = (name) => { writeFileSync(join(dir, SKILL_MAP), row(name)); return skillMapProblems(REPO, dir, new Map(), join(dir, "no-home")); };
  assert.deepEqual(run("agentic-council:brainstorm"), []);
  assert.match(run("zoominfo:account-research").join("\n"), /zoominfo is not in config\/agent-os\/required-plugins\.json/);
  assert.match(run("brainstorm").join("\n"), /marked plugin but is not named plugin:skill/);
});

test("the real monorepo-manager skill is a router with live links, two replays and a skill map that resolve", () => {
  const problems = check(REPO);
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});
