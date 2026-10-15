/**
 * Canary for the monorepo-manager skill (2026-10-15).
 *
 * The skill is a router: SKILL.md stays short and pushes detail into references/. Two things go wrong silently:
 * a reference that SKILL.md names but that does not exist (the model loads nothing), and a reference that exists
 * but nothing links (it is never read). The replay file maps every defect of the 2026-10-15 guard job to the step
 * that would have caught it; if a step is renamed or removed, the replay row points at nothing and this goes red.
 * The twelve upgrades (a-l in the job brief) must each catch at least one witnessed defect, so none is decoration.
 *
 * Shape (positive-control-first): check(root) is the whole gate. It is proven on throwaway skill trees first (a clean
 * tree reads clean, each single defect is named by its own message), then pointed at this repo.
 *
 * Run: node --test scripts/agent-os/managerSkill.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SKILL = ".claude/skills/monorepo-manager";
const REPLAY = "references/replay-2026-10-15.md";
const MAX_LINES = 120;
const UPGRADES = [..."abcdefghijkl"];

const lines = (text) => text.split(/\r?\n/);

/** Every way the skill tree under <root> is wrong, one string each. */
function check(root) {
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

  // Links by exact path, both directions.
  const named = new Set([...skill.matchAll(/\(?(references\/[A-Za-z0-9._-]+\.md)\)?/g)].map((m) => m[1]));
  let onDisk = [];
  try {
    onDisk = readdirSync(join(dir, "references")).map((f) => `references/${f}`);
  } catch {
    /* no references dir: every named path is reported missing below */
  }
  for (const p of named) if (!onDisk.includes(p)) problems.push(`SKILL.md names ${p}, which does not exist`);
  for (const p of onDisk) if (!named.has(p)) problems.push(`${p} exists but SKILL.md does not link it by exact path, so nothing will read it`);

  // The replay: every row's "New step" cell must name a real numbered step, and every upgrade must appear.
  let replay = "";
  try {
    replay = readFileSync(join(dir, REPLAY), "utf8");
  } catch {
    problems.push(`${REPLAY} is missing: the upgrades have no witnessed defect behind them`);
    return problems;
  }
  const steps = new Map([...skill.matchAll(/^(\d+)\. \*\*([^*]+?)\.\*\*/gm)].map((m) => [Number(m[1]), m[2]]));
  const covered = new Set();
  const rows = lines(replay).filter((l) => /^\|\s*[a-l]\s*\|/.test(l));
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    const [letter, , , , ref] = cells.slice(1);
    const m = /^(\d+) (.+)$/.exec(ref ?? "");
    if (!m) {
      problems.push(`replay row ${letter}: "New step" cell "${ref}" must read "<number> <step name>"`);
      continue;
    }
    if (steps.get(Number(m[1])) !== m[2]) problems.push(`replay row ${letter}: SKILL.md has no step "${m[1]}. **${m[2]}.**" (step ${m[1]} is "${steps.get(Number(m[1])) ?? "absent"}")`);
    else covered.add(letter);
  }
  for (const u of UPGRADES) if (!covered.has(u)) problems.push(`upgrade ${u} has no replay row that resolves to a real step`);

  // The "In order" list: each line starts with a step number and the name SKILL.md gives it, and the numbers ascend.
  const order = /^## In order[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(replay)?.[1];
  if (order === undefined) problems.push("the replay has no '## In order' section");
  else {
    const items = lines(order).filter((l) => l.startsWith("- "));
    if (!items.length) problems.push("the replay's 'In order' list has no '- <number> <step name>:' lines");
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

const base = mkdtempSync(join(tmpdir(), "mgrskill-"));
after(() => rmSync(base, { recursive: true, force: true }));
let seq = 0;

const STEP_NAMES = ["Recover state", "Probe it yourself", "Check the names"];
const goodSkill = () =>
  ["---", "name: monorepo-manager", "description: x", "---", "", ...STEP_NAMES.map((s, i) => `${i + 1}. **${s}.** text; see (references/a.md)`), `Replay: [r](${REPLAY})`, ""].join("\n");
const goodReplay = () =>
  [
    "| Upgrade | Defect | Evidence | Old skill | New step |",
    "|---|---|---|---|---|",
    ...UPGRADES.map((u, i) => `| ${u} | d | e | o | ${(i % 3) + 1} ${STEP_NAMES[i % 3]} |`),
    "",
    "## In order: where each step fires",
    "",
    ...STEP_NAMES.map((s, i) => `- ${i + 1} ${s}: where it fires`),
    "",
  ].join("\n");

function tree(over = {}) {
  const root = join(base, String(seq++));
  const dir = join(root, SKILL);
  mkdirSync(join(dir, "references"), { recursive: true });
  const files = { "SKILL.md": goodSkill(), "references/a.md": "a\n", [REPLAY]: goodReplay(), ...over };
  for (const [rel, text] of Object.entries(files)) if (text !== null) writeFileSync(join(dir, rel), text);
  return root;
}

test("control: a clean skill tree reads clean", () => {
  assert.deepEqual(check(tree()), []);
});

for (const [label, over, want] of [
  ["a SKILL.md over the router cap", { "SKILL.md": goodSkill() + "filler\n".repeat(MAX_LINES) }, /lines; it is a router/],
  ["a reference SKILL.md names that does not exist", { "SKILL.md": goodSkill() + "see references/missing.md\n" }, /names references\/missing\.md, which does not exist/],
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
]) {
  test(`names ${label}`, () => {
    const problems = check(tree(over));
    assert.ok(problems.some((p) => want.test(p)), `wanted ${want}; got ${JSON.stringify(problems)}`);
  });
}

test("the real monorepo-manager skill is a router with live links and a replay that resolves", () => {
  const problems = check(REPO);
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});
