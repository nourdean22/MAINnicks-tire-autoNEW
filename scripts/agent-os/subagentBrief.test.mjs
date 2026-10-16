// Canary for the subagent brief template (v3) and the six lane agent files.
// Checks are pure functions over file text so each one is also run against a planted mutant
// (field removed, skill removed, tier dropped, non-ASCII byte) and must report it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE = join(ROOT, ".agents", "core", "templates", "subagent-brief.md");
const AGENTS_DIR = join(ROOT, ".claude", "agents");
const REPO_SKILLS = join(ROOT, ".claude", "skills");
const HOME_SKILLS = join(homedir(), ".claude", "skills");

const LANES = ["statenour", "nickstire-client", "nickstire-server", "worker", "platform", "research"];
const WRITER_LANES = LANES.filter((l) => l !== "research");

const ALWAYS_ON_SKILLS = [
  "karpathy-guidelines",
  "ponytail",
  "verification-before-completion",
  "positive-control-first",
  "assert-the-consumer",
  "prior-art-grep",
  "harness-worktree-setup",
];

const TEMPLATE_FIELDS = [
  "LANE:", "JOB ID:", "BASE SHA:", "CONTRACT:", "MODEL / EFFORT:", "GOAL:", "ACCEPTANCE:", "WHY:", "KNOWN:",
  "RULED OUT:", "DESIGN:", "FIXTURES:", "PITFALLS:", "YOU MAY EDIT:", "PATH EXCEPTIONS:", "YOU MAY NOT:", "DATA:",
  "BUDGET:", "MODEL TRAILER:", "CHECKPOINTS:", "COST:", "RESUME:", "ANTISLOP MODE:", "CODEMOD RULE:", "CONTROLS RULE:",
  "FIRST:", "SKILLS TO INVOKE FIRST:", "VERIFY WITH:", "SELF-AUDIT", "RETURN (exactly):",
];
const TEMPLATE_PHRASES = [
  "Subagent brief v3", "2026-10-15", "## Picking model and effort", "7. Token and tool-call count",
  "<noreply@anthropic.com>", "tier A", "tier B", "tier C",
];
const TEMPLATE_MAX_LINES = 90;

const LANE_SECTIONS = ["## First 5 minutes", "## Checkpoint commits", "## Budget", "## Verify", "## Return"];

function nonAscii(text) {
  const m = /[^\x00-\x7F]/.exec(text);
  return m ? `non-ASCII byte U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} at offset ${m.index}` : null;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1].split(/\r?\n/) : null;
}

/** Block-list value of a frontmatter key: the indented `- name` lines right after `key:`. */
function listKey(lines, key) {
  const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (i < 0) return null;
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(l);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}

function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return null;
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Where a skill name resolves: "repo", "home" (machine-local only) or null. */
export function resolveSkill(name) {
  if (existsSync(join(REPO_SKILLS, name, "SKILL.md"))) return "repo";
  if (existsSync(join(HOME_SKILLS, name, "SKILL.md"))) return "home";
  return null;
}

export function templateProblems(text) {
  const problems = [];
  for (const f of TEMPLATE_FIELDS) if (!text.includes(f)) problems.push(`missing field ${f}`);
  for (const p of TEMPLATE_PHRASES) if (!text.includes(p)) problems.push(`missing phrase "${p}"`);
  const lines = text.split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
  if (lines >= TEMPLATE_MAX_LINES) problems.push(`${lines} lines, cap is under ${TEMPLATE_MAX_LINES}`);
  const na = nonAscii(text);
  if (na) problems.push(na);
  return problems;
}

export function laneProblems(lane, text) {
  const problems = [];
  const fm = frontmatter(text);
  if (!fm) return [`${lane}: no YAML frontmatter`];
  const has = (re) => fm.some((l) => re.test(l));
  if (!has(new RegExp(`^name: lane-${lane}$`))) problems.push(`${lane}: frontmatter name is not lane-${lane}`);
  const skills = listKey(fm, "skills") ?? [];
  for (const s of ALWAYS_ON_SKILLS) if (!skills.includes(s)) problems.push(`${lane}: always-on skill ${s} missing from skills:`);
  for (const s of skills) {
    const where = resolveSkill(s);
    if (!where) problems.push(`${lane}: skill ${s} resolves nowhere (.claude/skills or ~/.claude/skills)`);
  }
  if (lane === "research") {
    if (!has(/^tools: /)) problems.push("research: tools: list missing");
    if (!has(/^ownedPaths: \[\]$/)) problems.push("research: ownedPaths: [] missing");
    if (!has(/^model: sonnet$/)) problems.push("research: model: sonnet missing");
  } else {
    if (!has(/^disallowedTools: Agent$/)) problems.push(`${lane}: disallowedTools: Agent missing`);
    if (!has(/^isolation: worktree$/)) problems.push(`${lane}: isolation: worktree missing`);
    if (!(listKey(fm, "ownedPaths") ?? []).length) problems.push(`${lane}: ownedPaths: block list missing`);
    if (has(/^model:/)) problems.push(`${lane}: writer lane must not pin model:`);
  }
  for (const h of LANE_SECTIONS) if (section(text, h) === null) problems.push(`${lane}: section "${h}" missing`);
  const budget = section(text, "## Budget") ?? "";
  if (!/\btier [ABC]\b/i.test(budget)) problems.push(`${lane}: Budget section names no default tier`);
  if (!/120 tool calls or 45 minutes/.test(budget)) problems.push(`${lane}: Budget section lacks the default budget`);
  const na = nonAscii(text);
  if (na) problems.push(`${lane}: ${na}`);
  return problems;
}

const laneText = (lane) => readFileSync(join(AGENTS_DIR, `lane-${lane}.md`), "utf8");

test("template: v3 with every required field, routing section, under 90 lines, ASCII", () => {
  const problems = templateProblems(readFileSync(TEMPLATE, "utf8"));
  assert.deepEqual(problems, []);
});

for (const lane of LANES) {
  test(`lane-${lane}: always-on skills resolve, required sections and frontmatter shape present`, () => {
    assert.deepEqual(laneProblems(lane, laneText(lane)), []);
  });
}

test("every lane skill resolves in the repo; machine-local-only names are labelled", () => {
  const homeOnly = [];
  for (const lane of LANES) {
    for (const s of listKey(frontmatter(laneText(lane)), "skills") ?? []) {
      if (resolveSkill(s) === "home") homeOnly.push(`${lane}:${s}`);
    }
  }
  // A fresh clone and CI have no ~/.claude/skills, so a home-only name would be silent there.
  assert.deepEqual(homeOnly, [], `machine-local only (~/.claude/skills), not in .claude/skills: ${homeOnly.join(", ")}`);
});

test("POSITIVE CONTROL: planted template mutants are reported", () => {
  const good = readFileSync(TEMPLATE, "utf8");
  assert.deepEqual(templateProblems(good), []);
  assert.ok(templateProblems(good.replace("MODEL / EFFORT:", "MODEL EFFORT:")).some((p) => p.includes("MODEL / EFFORT:")));
  assert.ok(templateProblems(good.replace("## Picking model and effort", "## Picking")).some((p) => p.includes("Picking")));
  assert.ok(templateProblems(good.replace("CHECKPOINTS:", "CHECKPOINT:")).some((p) => p.includes("CHECKPOINTS:")));
  assert.ok(templateProblems(good + "\n".repeat(TEMPLATE_MAX_LINES)).some((p) => p.includes("cap is under")));
  assert.ok(templateProblems(good.replace("GOAL:", "GOAL" + String.fromCharCode(0x2014))).some((p) => p.includes("U+2014")));
});

test("POSITIVE CONTROL: planted lane mutants are reported", () => {
  const good = laneText("platform");
  assert.deepEqual(laneProblems("platform", good), []);
  assert.ok(laneProblems("platform", good.replace("  - ponytail\n", "")).some((p) => p.includes("ponytail missing")));
  assert.ok(laneProblems("platform", good.replace("  - guard-red-team\n", "  - no-such-skill-xyz\n")).some((p) => p.includes("resolves nowhere")));
  assert.ok(laneProblems("platform", good.replace("## Budget", "## Budgets")).some((p) => p.includes('"## Budget" missing')));
  assert.ok(laneProblems("platform", good.replace(/tier [ABC]/gi, "tier Z")).some((p) => p.includes("no default tier")));
  assert.ok(laneProblems("platform", good.replace("isolation: worktree", "isolation: none")).some((p) => p.includes("isolation")));
  assert.ok(laneProblems("platform", good.replace("---\n", "---\nmodel: opus\n")).some((p) => p.includes("must not pin model")));
  const research = laneText("research");
  assert.deepEqual(laneProblems("research", research), []);
  assert.ok(laneProblems("research", research.replace("model: sonnet\n", "")).some((p) => p.includes("model: sonnet missing")));
});
