// Canary for the subagent brief template (v3) and the six lane agent files.
// Checks are pure functions over file text so each one is also run against a planted mutant
// (field removed, skill removed, tier dropped, step order swapped, non-ASCII byte) and must report it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..", "..");
const TEMPLATE = join(ROOT, ".agents", "core", "templates", "subagent-brief.md");
const AGENTS_DIR = join(ROOT, ".claude", "agents");
const REPO_SKILLS = join(ROOT, ".claude", "skills");
const HOME_SKILLS = join(homedir(), ".claude", "skills");

const LANES = ["statenour", "nickstire-client", "nickstire-server", "worker", "platform", "research"];

const ALWAYS_ON_SKILLS = [
  "karpathy-guidelines",
  "ponytail",
  "verification-before-completion",
  "positive-control-first",
  "assert-the-consumer",
  "prior-art-grep",
  "harness-worktree-setup",
];
// The read-only lane never runs setup: it creates node_modules junctions, which is a write.
const RESEARCH_SKILLS = ALWAYS_ON_SKILLS.filter((s) => s !== "harness-worktree-setup");
const RESEARCH_FORBIDDEN_SKILLS = ["harness-worktree-setup"];

// Matched as line starts inside the fenced block, so a field that survives only in the intro prose still fails.
const FENCE_FIELDS = [
  "LANE:", "MODEL / EFFORT:", "GOAL:", "ACCEPTANCE:", "WHY:", "KNOWN:", "RULED OUT:", "DESIGN:", "FIXTURES:",
  "PITFALLS:", "YOU MAY EDIT:", "PATH EXCEPTIONS:", "YOU MAY NOT:", "DATA:", "BUDGET:", "MODEL TRAILER:", "CHECKPOINTS:",
  "COST:", "RESUME:", "ANTISLOP MODE:", "CODEMOD RULE:", "CONTROLS RULE:", "FIRST:", "SKILLS TO INVOKE FIRST:",
  "VERIFY WITH:", "SELF-AUDIT (before you return):", "RETURN (exactly):",
];
const FENCE_INLINE_FIELDS = ["JOB ID:", "BASE SHA:", "CONTRACT:"];
const RETURN_ITEMS = 7;
const TEMPLATE_PHRASES = [
  "Subagent brief v3", "2026-10-15", "## Picking model and effort", "Token and tool-call count",
  "<noreply@anthropic.com>", "tier A", "tier B", "tier C",
  // Skill recall for lane briefs (2026-10-16): the real command, not a shorthand that resolves nowhere.
  "plus the `node scripts/agent-os/skill-recall.mjs --file <brief>` output",
];
const MANAGER_SKILL = join(ROOT, ".claude", "skills", "monorepo-manager", "SKILL.md");
const MANAGER_RECALL_SENTENCE = "Run `node scripts/agent-os/skill-recall.mjs --file <brief>` and put its matches in SKILLS TO INVOKE FIRST.";
const TEMPLATE_MAX_LINES = 90;

const LANE_SECTIONS = ["## First 5 minutes", "## Checkpoint commits", "## Budget", "## Verify", "## Return"];
const POLICY_READ = /^\d+\. Read the policy before any write:/m;
const RED_TEST = /^\d+\. Write the red test/m;

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

/** The first ``` fenced block, without its fence lines. */
function fence(text) {
  const m = /^```\r?\n([\s\S]*?)\r?\n```/m.exec(text);
  return m ? m[1] : null;
}

/** Where a skill name resolves: "repo", "home" (machine-local only) or null. */
export function resolveSkill(name) {
  if (existsSync(join(REPO_SKILLS, name, "SKILL.md"))) return "repo";
  if (existsSync(join(HOME_SKILLS, name, "SKILL.md"))) return "home";
  return null;
}

export function templateProblems(text) {
  const problems = [];
  const block = fence(text);
  if (block === null) return ["no fenced block"];
  const lineStart = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "m").test(block);
  for (const f of FENCE_FIELDS) if (!lineStart(f)) problems.push(`missing field ${f} at a line start inside the fence`);
  for (const f of FENCE_INLINE_FIELDS) if (!/^LANE:.*$/m.exec(block)?.[0].includes(f)) problems.push(`missing ${f} on the LANE line`);
  for (let n = 1; n <= RETURN_ITEMS; n++) if (!new RegExp(`^  ${n}\\. `, "m").test(block)) problems.push(`missing RETURN item ${n}`);
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
  const required = lane === "research" ? RESEARCH_SKILLS : ALWAYS_ON_SKILLS;
  for (const s of required) if (!skills.includes(s)) problems.push(`${lane}: always-on skill ${s} missing from skills:`);
  for (const s of skills) {
    if (!resolveSkill(s)) problems.push(`${lane}: skill ${s} resolves nowhere (.claude/skills or ~/.claude/skills)`);
  }
  const first5 = section(text, "## First 5 minutes") ?? "";
  if (lane === "research") {
    for (const s of RESEARCH_FORBIDDEN_SKILLS) {
      if (skills.includes(s) || first5.includes(s)) problems.push(`research: lists ${s}, which writes junctions`);
    }
    if (!has(/^tools: /)) problems.push("research: tools: list missing");
    if (!has(/^ownedPaths: \[\]$/)) problems.push("research: ownedPaths: [] missing");
    if (!has(/^model: sonnet$/)) problems.push("research: model: sonnet missing");
  } else {
    if (!has(/^disallowedTools: Agent$/)) problems.push(`${lane}: disallowedTools: Agent missing`);
    if (!has(/^isolation: worktree$/)) problems.push(`${lane}: isolation: worktree missing`);
    if (!(listKey(fm, "ownedPaths") ?? []).length) problems.push(`${lane}: ownedPaths: block list missing`);
    if (has(/^model:/)) problems.push(`${lane}: writer lane must not pin model:`);
    const read = first5.search(POLICY_READ);
    const red = first5.search(RED_TEST);
    if (read < 0) problems.push(`${lane}: First 5 minutes has no policy-read step`);
    if (red < 0) problems.push(`${lane}: First 5 minutes has no red-test step`);
    if (read >= 0 && red >= 0 && read > red) problems.push(`${lane}: red test is written before the policy read`);
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

test("template: v3 with every required field inside the fence, routing section, under 90 lines, ASCII", () => {
  assert.deepEqual(templateProblems(readFileSync(TEMPLATE, "utf8")), []);
});

for (const lane of LANES) {
  test(`lane-${lane}: always-on skills resolve, required sections, step order and frontmatter shape present`, () => {
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

test("monorepo-manager step 5 tells the manager to run skill-recall on the brief", () => {
  assert.ok(readFileSync(MANAGER_SKILL, "utf8").includes(MANAGER_RECALL_SENTENCE), "the skill-recall sentence is missing from monorepo-manager/SKILL.md");
});

test("this canary is itself ASCII-only", () => {
  assert.equal(nonAscii(readFileSync(SELF, "utf8")), null);
});

test("POSITIVE CONTROL: planted template mutants are reported", () => {
  const good = readFileSync(TEMPLATE, "utf8");
  assert.deepEqual(templateProblems(good), []);
  const hit = (mutant, needle) => assert.ok(templateProblems(mutant).some((p) => p.includes(needle)), needle);
  hit(good.replace("MODEL / EFFORT:", "MODEL EFFORT:"), "MODEL / EFFORT:");
  hit(good.replace("## Picking model and effort", "## Picking"), "Picking");
  hit(good.replace("CHECKPOINTS:", "CHECKPOINT:"), "CHECKPOINTS:");
  // Field deleted from the fence while the intro prose still says "SELF-AUDIT": a whole-file includes() would stay green.
  const selfAuditField = /^SELF-AUDIT \(before you return\):[\s\S]*?(?=^RETURN)/m;
  assert.match(good, selfAuditField);
  assert.ok(good.replace(selfAuditField, "").includes("SELF-AUDIT"));
  hit(good.replace(selfAuditField, ""), "SELF-AUDIT (before you return):");
  hit(good.replace("  7. Token", "  Token"), "RETURN item 7");
  hit(good + "\n".repeat(TEMPLATE_MAX_LINES), "cap is under");
  hit(good.replace("GOAL:", "GOAL" + String.fromCharCode(0x2014)), "U+2014");
});

test("POSITIVE CONTROL: planted lane mutants are reported", () => {
  const good = laneText("platform");
  assert.deepEqual(laneProblems("platform", good), []);
  const hit = (lane, mutant, needle) => assert.ok(laneProblems(lane, mutant).some((p) => p.includes(needle)), needle);
  hit("platform", good.replace("  - ponytail\n", ""), "ponytail missing");
  hit("platform", good.replace("  - guard-red-team\n", "  - no-such-skill-xyz\n"), "resolves nowhere");
  hit("platform", good.replace("## Budget", "## Budgets"), '"## Budget" missing');
  hit("platform", good.replace(/tier [ABC]/gi, "tier Z"), "no default tier");
  hit("platform", good.replace("isolation: worktree", "isolation: none"), "isolation");
  hit("platform", good.replace("---\n", "---\nmodel: opus\n"), "must not pin model");
  // Policy read and red test swapped.
  const read = POLICY_READ.exec(good)[0];
  const red = RED_TEST.exec(good)[0];
  hit("platform", good.replace(read, "9. TMP").replace(red, read).replace("9. TMP", red), "before the policy read");
  hit("platform", good.replace(read, "2. Read the brief"), "no policy-read step");
  const research = laneText("research");
  assert.deepEqual(laneProblems("research", research), []);
  hit("research", research.replace("model: sonnet\n", ""), "model: sonnet missing");
  hit("research", research.replace("  - find-skill\n", "  - harness-worktree-setup\n  - find-skill\n"), "writes junctions");
});
