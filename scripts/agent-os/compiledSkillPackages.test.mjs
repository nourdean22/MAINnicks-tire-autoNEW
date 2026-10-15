/**
 * Canary for every compiled skill package under .claude/skills (2026-10-15).
 *
 * Nothing in CI ran scripts/skill-compiler/validate.mjs over the packages in this repo, so a package could
 * be invalid, or still a fresh scaffold, and merge anyway. The first compiled skill (PR #3035) also showed
 * that a package can validate and never load, because Claude Code reads only .claude/skills/<name>/SKILL.md.
 * A package is a directory that holds provenance/source.json, the file only scaffold.mjs writes; a skill
 * without it is not a compiler package and is skipped. The scan fails, naming the package, when one:
 *   - fails validate.mjs (V1-V7);
 *   - still has SKILL.draft.md (V8), which is how a fresh scaffold looks;
 *   - sits anywhere but directly under .claude/skills/.
 * validate.mjs --self-test runs here too, because the scan is only as good as the validator it trusts.
 *
 * Shape (guard-red-team, positive-control-first): scan(root) is the whole gate. It is proven on throwaway
 * skill trees first (a clean tree reads clean, each single defect is named by its own message), then
 * pointed at this repo. The controls run in temp dirs, so nothing is scaffolded into this repo.
 *
 * Run: node --test scripts/agent-os/compiledSkillPackages.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCAFFOLD = fileURLToPath(new URL("../skill-compiler/scaffold.mjs", import.meta.url));
const VALIDATE = fileURLToPath(new URL("../skill-compiler/validate.mjs", import.meta.url));
const PROVENANCE = "/provenance/source.json";

/** Run the real validate.mjs over every compiler package under <root>/.claude/skills and name each one that is wrong. */
function scan(root) {
  const packages = readdirSync(join(root, ".claude", "skills"), { recursive: true })
    .map((p) => p.split(sep).join("/"))
    // shortcut: found by provenance/source.json, so a package that lost that file reads as a plain skill; match SKILL.draft.md too if it happens.
    .filter((p) => p.endsWith(PROVENANCE))
    .map((p) => p.slice(0, -PROVENANCE.length))
    .sort();
  const problems = [];
  for (const pkg of packages) {
    if (pkg.includes("/")) {
      problems.push(`${pkg}: a compiler package must sit directly under .claude/skills/, the only place Claude Code loads it from`);
      continue;
    }
    const r = spawnSync(process.execPath, [VALIDATE, `.claude/skills/${pkg}`], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) problems.push(`${pkg}: validate.mjs exited ${r.status}\n${r.stderr.trim()}`);
  }
  return { packages, problems };
}

const base = mkdtempSync(join(tmpdir(), "skillpkgs-"));
after(() => rmSync(base, { recursive: true, force: true }));
let seq = 0;

/** A stand-in repo root with an empty .claude/skills. */
function tree() {
  const root = join(base, String(seq++));
  const skills = join(root, ".claude", "skills");
  mkdirSync(skills, { recursive: true });
  return { root, skills };
}

const entry = (n) =>
  [`## ${n}`, `- claim: rule ${n}`, "- source-section: ch1", '- quote-anchor: "short verbatim anchor"', "- evidence-class: author_evidenced", "- confidence: high", "", ""].join("\n");

/** A finished package that satisfies every validate.mjs check. */
function writePackage(skills, name) {
  const dir = join(skills, name);
  for (const d of ["chapters", "provenance", "evals"]) mkdirSync(join(dir, d), { recursive: true });
  const put = (rel, text) => writeFileSync(join(dir, rel), text);
  put("SKILL.md", `---\nname: ${name}\ndescription: fixture for the compiled-package canary.\n---\n\n# ${name}\n`);
  put("techniques.md", "# Techniques\n\n" + ["one", "two", "three"].map(entry).join(""));
  put("anti-patterns.md", "# Anti-patterns\n\n" + entry("backwards"));
  put("glossary.md", "# Glossary\n");
  put(join("chapters", "map.md"), "# Section map\n- ch1 · The Core Idea · pp. 1-20\n");
  put(join("provenance", "source.json"), JSON.stringify({ sha256: "a".repeat(64), extractedAt: "2026-10-15T00:00:00Z", license: "unknown" }));
  put(
    join("evals", "questions.json"),
    JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ q: `q${i}`, expected: `a${i}`, sourceSection: "ch1", kind: i % 2 ? "recall" : "application" }))),
  );
}

test("control: finished packages read clean, and a skill without provenance is skipped", () => {
  const { root, skills } = tree();
  writePackage(skills, "good-pkg");
  mkdirSync(join(skills, "plain-skill"));
  writeFileSync(join(skills, "plain-skill", "SKILL.md"), "not a compiler package\n");
  assert.deepEqual(scan(root), { packages: ["good-pkg"], problems: [] });
});

for (const [label, name, arrange, want] of [
  ["an invalid package", "bad-pkg", (skills) => rmSync(join(skills, "bad-pkg", "techniques.md")), /V1 missing techniques\.md/],
  ["a leftover SKILL.draft.md", "bad-pkg", (skills) => writeFileSync(join(skills, "bad-pkg", "SKILL.draft.md"), "DRAFT\n"), /V8 SKILL\.draft\.md still exists/],
  [
    "a draft renamed to SKILL.md and never rewritten",
    "bad-pkg",
    (skills) => writeFileSync(join(skills, "bad-pkg", "SKILL.md"), "---\nname: bad-pkg\ndescription: COMPILED SKILL (draft) not rewritten.\n---\n\nDRAFT\n"),
    /V7 SKILL\.md still carries the draft marker/,
  ],
  [
    "a package outside .claude/skills/<slug>/",
    "generated/bad-pkg",
    (skills) => {
      mkdirSync(join(skills, "generated"));
      renameSync(join(skills, "bad-pkg"), join(skills, "generated", "bad-pkg"));
    },
    /must sit directly under \.claude\/skills\//,
  ],
]) {
  test(`scan names ${label}, and only that package`, () => {
    const { root, skills } = tree();
    writePackage(skills, "good-pkg");
    writePackage(skills, "bad-pkg");
    arrange(skills);
    const { problems } = scan(root);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.ok(problems[0].startsWith(`${name}:`), problems[0]);
    assert.match(problems[0], want);
  });
}

test("scan names a package straight out of scaffold.mjs: it is a draft until it is finished", () => {
  const { root } = tree();
  const src = join(root, "book.txt");
  writeFileSync(src, "chapter one\n");
  const made = spawnSync(process.execPath, [SCAFFOLD, src, "fresh-draft"], { cwd: root, encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const { packages, problems } = scan(root);
  assert.deepEqual(packages, ["fresh-draft"]);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /^fresh-draft: .*V1 missing SKILL\.md/s);
});

test("validate.mjs --self-test passes: the validator still catches each defect class it claims to", () => {
  const r = spawnSync(process.execPath, [VALIDATE, "--self-test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK$/m);
});

test("every compiled skill package in this repo passes validate.mjs and sits under .claude/skills/<slug>/", (t) => {
  const { packages, problems } = scan(REPO);
  t.diagnostic(`checked ${packages.length} compiled package(s): ${packages.join(", ") || "none"}`);
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});
