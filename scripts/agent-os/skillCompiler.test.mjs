/**
 * Canary for scripts/skill-compiler/scaffold.mjs (2026-10-15).
 *
 * The first compiled skill (PR #3035) passed validate.mjs and still could not be used:
 *   1. scaffold.mjs wrote .claude/skills/generated/<slug>/, but Claude Code loads only
 *      .claude/skills/<name>/SKILL.md, so the package validated and never loaded;
 *   2. provenance/source.json carried the ABSOLUTE path of the source (an OS temp dir) in a
 *      public repo.
 * Flattening the path lets a slug collide with a real skill, so a directory that is not a
 * compiler package must be refused.
 *
 * Shape (guard-red-team, positive-control-first): defectsOf(script) runs ONE scaffolder inside a
 * throwaway repo root and names what is wrong. It is proven first on stand-ins (a correct one
 * reads clean; each single-defect one is flagged by its own check), then pointed at the real
 * scaffold.mjs. Every run uses cwd = a temp dir, so nothing is ever scaffolded into this repo.
 *
 * Run: node --test scripts/agent-os/skillCompiler.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const SCAFFOLD = fileURLToPath(new URL("../skill-compiler/scaffold.mjs", import.meta.url));
const VALIDATE = fileURLToPath(new URL("../skill-compiler/validate.mjs", import.meta.url));

const base = mkdtempSync(join(tmpdir(), "skillscaf-"));
after(() => rmSync(base, { recursive: true, force: true }));

let seq = 0;

/** A stand-in repo root plus a source file OUTSIDE it, the way a book sits in Downloads. */
function fixture() {
  const dir = join(base, String(seq++));
  const root = join(dir, "repo");
  const skills = join(root, ".claude", "skills");
  mkdirSync(skills, { recursive: true });
  const src = join(dir, "book.txt");
  writeFileSync(src, "chapter one\n");
  return { dir, root, skills, src };
}

const run = (script, cwd, ...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/])/; // drive letter, leading slash, or UNC

/** Run one scaffolder in a fresh stand-in repo root and name everything wrong with the result. */
function defectsOf(script) {
  const defects = [];
  const { dir, root, skills, src } = fixture();

  const made = run(script, root, src, "demo-skill");
  if (made.status !== 0) defects.push(`scaffold exited ${made.status}: ${made.stderr.trim()}`);
  if (!existsSync(join(skills, "demo-skill", "SKILL.md"))) {
    defects.push("package is not at .claude/skills/<slug>/SKILL.md (Claude Code loads only that path)");
  }
  if (existsSync(join(skills, "generated"))) defects.push("a generated/ folder was created");

  // Search every depth: a package written to the wrong place must still have its provenance judged.
  const provFiles = readdirSync(skills, { recursive: true }).filter((p) => p.endsWith(join("provenance", "source.json")));
  if (provFiles.length === 0) defects.push("no provenance/source.json was written");
  for (const rel of provFiles) {
    for (const [key, value] of Object.entries(readJson(join(skills, rel)))) {
      if (typeof value === "string" && (ABSOLUTE.test(value) || value.includes(dir) || value.includes(tmpdir()))) {
        defects.push(`provenance.${key} holds an absolute path`);
      }
    }
  }

  const real = join(skills, "real-skill");
  mkdirSync(real);
  writeFileSync(join(real, "SKILL.md"), "keep me\n");
  const collided = run(script, root, src, "real-skill");
  if (collided.status === 0) defects.push("did not refuse a slug whose directory is not a compiler package");
  else if (!collided.stderr.includes("REFUSED")) defects.push("refused a non-package directory without saying REFUSED");
  if (readdirSync(real).join() !== "SKILL.md" || readFileSync(join(real, "SKILL.md"), "utf8") !== "keep me\n") {
    defects.push("wrote into an existing non-compiler directory");
  }
  return defects;
}

/** A scaffolder cut down to the contract under test; each flag re-introduces one historical defect. */
function standIn({ nested = false, absolute = false, guard = true } = {}) {
  const file = join(base, `standin-${seq++}.mjs`);
  writeFileSync(
    file,
    [
      'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { join, resolve } from "node:path";',
      "const [src, slug] = process.argv.slice(2);",
      `const out = resolve(".claude/skills", ${nested ? '"generated", ' : ""}slug);`,
      'const prov = join(out, "provenance", "source.json");',
      `if (${guard} && existsSync(out) && !existsSync(prov)) { console.error("REFUSED: not a compiler package"); process.exit(1); }`,
      'mkdirSync(join(out, "provenance"), { recursive: true });',
      'writeFileSync(join(out, "SKILL.md"), "draft\\n");',
      `writeFileSync(prov, JSON.stringify({ sourceLabel: "book.txt"${absolute ? ", sourcePathAtCompile: resolve(src)" : ""} }));`,
    ].join("\n"),
  );
  return file;
}

test("checker control: a correct scaffolder reads clean", () => {
  assert.deepEqual(defectsOf(standIn()), []);
});

for (const [name, flags, want] of [
  ["a package nested under generated/", { nested: true }, /not at \.claude\/skills\/<slug>/],
  ["an absolute path in provenance", { absolute: true }, /absolute path/],
  ["scaffolding into a directory that is not a compiler package", { guard: false }, /did not refuse/],
]) {
  test(`checker fires on ${name}`, () => {
    const defects = defectsOf(standIn(flags));
    assert.ok(defects.some((d) => want.test(d)), `wanted a defect matching ${want}, got ${JSON.stringify(defects)}`);
  });
}

test("scaffold.mjs: lands flat, writes no absolute path, refuses a non-package directory", () => {
  assert.deepEqual(defectsOf(SCAFFOLD), []);
});

test("scaffold.mjs: --source-label is recorded, and the default is the file basename", () => {
  const a = fixture();
  assert.equal(run(SCAFFOLD, a.root, a.src, "label-default").status, 0);
  assert.equal(readJson(join(a.skills, "label-default", "provenance", "source.json")).sourceLabel, "book.txt");

  const b = fixture();
  const label = "Example Book (2021), ch. 1-5";
  assert.equal(run(SCAFFOLD, b.root, b.src, "label-custom", "--source-label", label).status, 0);
  assert.equal(readJson(join(b.skills, "label-custom", "provenance", "source.json")).sourceLabel, label);
});

test("scaffold.mjs: an absolute-path or blank label is refused before anything is written", () => {
  for (const label of ["C:\\Users\\someone\\book.pdf", "/home/someone/book.pdf", "\\\\server\\share\\book.pdf", "  "]) {
    const f = fixture();
    const r = run(SCAFFOLD, f.root, f.src, "bad-label", "--source-label", label);
    assert.equal(r.status, 2, `label ${JSON.stringify(label)}: ${r.stderr}`);
    assert.match(r.stderr, /--source-label/);
    assert.deepEqual(readdirSync(f.skills), [], `label ${JSON.stringify(label)} left files behind`);
  }
});

test("scaffold.mjs: same-source re-scaffold keeps edits, a changed source is still refused", () => {
  const f = fixture();
  const skill = join(f.skills, "keep-me");
  const prov = join(skill, "provenance", "source.json");
  assert.equal(run(SCAFFOLD, f.root, f.src, "keep-me").status, 0);
  writeFileSync(join(skill, "techniques.md"), "# my work\n");

  const again = run(SCAFFOLD, f.root, f.src, "keep-me");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(join(skill, "techniques.md"), "utf8"), "# my work\n");

  const before = readFileSync(prov, "utf8");
  writeFileSync(f.src, "chapter one, revised\n");
  const changed = run(SCAFFOLD, f.root, f.src, "keep-me");
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /checksum mismatch/);
  assert.equal(readFileSync(prov, "utf8"), before, "a refused re-compile must not touch provenance");
});

test("validate.mjs: scaffolded provenance passes V1/V2, the draft fails only the unfinished-work checks", () => {
  const f = fixture();
  assert.equal(run(SCAFFOLD, f.root, f.src, "fresh-draft").status, 0);
  const v = run(VALIDATE, f.root, join(f.skills, "fresh-draft"));
  assert.equal(v.status, 1, v.stdout + v.stderr);
  assert.match(v.stderr, /V7 /, "the validator must really run: the draft marker is its own catch");
  assert.doesNotMatch(v.stderr, /V[12] /, "layout and provenance must be complete");
});
