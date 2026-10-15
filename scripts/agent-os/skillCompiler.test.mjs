/**
 * Canary for scripts/skill-compiler: scaffold.mjs and the V8 check in validate.mjs (2026-10-15).
 *
 * The first compiled skill (PR #3035) passed validate.mjs and still could not be used:
 *   1. scaffold.mjs wrote .claude/skills/generated/<slug>/, but Claude Code loads only
 *      .claude/skills/<name>/SKILL.md, so the package validated and never loaded;
 *   2. provenance/source.json carried the ABSOLUTE path of the source (an OS temp dir) in a
 *      public repo.
 * Flattening the path lets a slug collide with a real skill, so a directory that is not a
 * compiler package must be refused. Review of PR #3041 found four more holes, each pinned below:
 *   S1  a same-source re-scaffold rewrote provenance (custom label, license and date reset);
 *   S2  a path embedded anywhere in a label got through (only a leading one was refused);
 *   S3  a slug still under the old generated/ layout got a second, flat copy;
 *   S4  a fresh scaffold wrote a loadable SKILL.md while unfinished (now SKILL.draft.md, and
 *       validate.mjs V8 fails while that file exists).
 *
 * Shape (guard-red-team, positive-control-first): defectsOf(script) runs ONE scaffolder inside a
 * throwaway repo root and names what is wrong. It is proven first on stand-ins (a correct one
 * reads clean; each single-defect one is flagged by its own check), then pointed at the real
 * scaffold.mjs. The other arms drive the real scaffold.mjs and validate.mjs directly. Every run
 * uses cwd = a temp dir, so nothing is ever scaffolded into this repo.
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
  const pkg = join(skills, "demo-skill");

  const made = run(script, root, src, "demo-skill");
  if (made.status !== 0) defects.push(`scaffold exited ${made.status}: ${made.stderr.trim()}`);
  if (!existsSync(join(pkg, "provenance", "source.json"))) {
    defects.push("package is not at .claude/skills/<slug>/ (Claude Code loads only that path)");
  }
  if (existsSync(join(skills, "generated"))) defects.push("a generated/ folder was created");
  // S4: an unfinished package must not own the SKILL.md name, or Claude Code lists the draft.
  if (existsSync(join(pkg, "SKILL.md"))) defects.push("an unfinished package has a SKILL.md, so Claude Code would load the draft");
  if (!existsSync(join(pkg, "SKILL.draft.md"))) defects.push("no SKILL.draft.md was written");

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

  // S3: a slug that still lives under the old layout must not get a second, flat copy.
  mkdirSync(join(skills, "generated", "legacy-pkg", "provenance"), { recursive: true });
  writeFileSync(join(skills, "generated", "legacy-pkg", "provenance", "source.json"), "{}\n");
  const legacy = run(script, root, src, "legacy-pkg");
  if (legacy.status === 0) defects.push("did not refuse a slug that already exists under the old generated/ layout");
  else if (!legacy.stderr.includes("REFUSED")) defects.push("refused a legacy package without saying REFUSED");
  if (existsSync(join(skills, "legacy-pkg"))) defects.push("scaffolded a flat copy next to a legacy generated/ package");
  return defects;
}

/** A scaffolder cut down to the contract under test; each flag re-introduces one historical defect. */
function standIn({ nested = false, absolute = false, guard = true, legacyGuard = true, loadable = false } = {}) {
  const file = join(base, `standin-${seq++}.mjs`);
  writeFileSync(
    file,
    [
      'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { join, resolve } from "node:path";',
      "const [src, slug] = process.argv.slice(2);",
      `const out = resolve(".claude/skills", ${nested ? '"generated", ' : ""}slug);`,
      'const prov = join(out, "provenance", "source.json");',
      'const old = join(resolve(".claude/skills/generated", slug), "provenance", "source.json");',
      `if (${legacyGuard} && existsSync(old)) { console.error("REFUSED: old layout"); process.exit(1); }`,
      `if (${guard} && existsSync(out) && !existsSync(prov)) { console.error("REFUSED: not a compiler package"); process.exit(1); }`,
      'mkdirSync(join(out, "provenance"), { recursive: true });',
      `writeFileSync(join(out, "${loadable ? "SKILL.md" : "SKILL.draft.md"}"), "draft\\n");`,
      `writeFileSync(prov, JSON.stringify({ sourceLabel: "book.txt"${absolute ? ", sourcePathAtCompile: resolve(src)" : ""} }));`,
    ].join("\n"),
  );
  return file;
}

/** Fill in a freshly scaffolded package so it satisfies every validate.mjs check, and drop the draft. */
function finish(pkg, name) {
  const tech = (n) =>
    ["## " + n, "- claim: rule " + n, "- source-section: ch1", '- quote-anchor: "short verbatim anchor"', "- evidence-class: author_evidenced", "- confidence: high", "", ""].join("\n");
  const put = (rel, text) => writeFileSync(join(pkg, rel), text);
  put(join("chapters", "map.md"), "# Section map\n- ch1 \u00b7 The Core Idea \u00b7 pp. 1-20\n");
  put("techniques.md", "# Techniques\n\n" + tech("one") + tech("two") + tech("three"));
  put(
    "anti-patterns.md",
    ["# Anti-patterns", "", "## Backwards", "- claim: never start with tactics", "- source-section: ch1", '- quote-anchor: "tactics without position fail"', "- evidence-class: author_asserted", "- confidence: medium", ""].join("\n"),
  );
  put("glossary.md", "# Glossary\n- leverage \u00b7 the core term \u00b7 ch1\n");
  put(
    join("evals", "questions.json"),
    JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ q: `q${i}`, expected: `a${i}`, sourceSection: "ch1", kind: i % 2 ? "recall" : "application" }))),
  );
  put("SKILL.md", `---\nname: ${name}\ndescription: finished skill for the scaffold canary.\n---\n\n# ${name}\n\nUse the thing.\n`);
  rmSync(join(pkg, "SKILL.draft.md"));
}

test("checker control: a correct scaffolder reads clean", () => {
  assert.deepEqual(defectsOf(standIn()), []);
});

for (const [name, flags, want] of [
  ["a package nested under generated/", { nested: true }, /not at \.claude\/skills\/<slug>/],
  ["an absolute path in provenance", { absolute: true }, /absolute path/],
  ["scaffolding into a directory that is not a compiler package", { guard: false }, /did not refuse a slug whose directory/],
  ["a loadable SKILL.md in an unfinished package", { loadable: true }, /unfinished package has a SKILL\.md/],
  ["a slug that already exists under the old generated/ layout", { legacyGuard: false }, /did not refuse a slug that already exists under the old/],
]) {
  test(`checker fires on ${name}`, () => {
    const defects = defectsOf(standIn(flags));
    assert.ok(defects.some((d) => want.test(d)), `wanted a defect matching ${want}, got ${JSON.stringify(defects)}`);
  });
}

test("scaffold.mjs: lands flat as a draft, writes no absolute path, refuses a non-package or legacy directory", () => {
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

test("scaffold.mjs: a label with a file path anywhere in it, or a blank label, is refused before anything is written", () => {
  for (const label of [
    "C:\\Users\\someone\\book.pdf",
    "/home/someone/book.pdf",
    "  ",
    "Book at /home/alice/private/book.pdf",
    "Book at C:\\Users\\alice\\book.pdf",
    "Book at C:/Users/alice/book.pdf",
    "see ~/notes/x",
    "\\\\server\\share\\x",
    "(/etc/passwd)",
    '"/etc/passwd"',
    "path=/home/alice/x",
  ]) {
    const f = fixture();
    const r = run(SCAFFOLD, f.root, f.src, "bad-label", "--source-label", label);
    assert.equal(r.status, 2, `label ${JSON.stringify(label)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--source-label/);
    assert.deepEqual(readdirSync(f.skills), [], `label ${JSON.stringify(label)} left files behind`);
  }
});

test("scaffold.mjs: ordinary labels pass, including a slash inside a token, a lone slash and a URL", () => {
  for (const label of [
    "yihui-dev/awesome-opus5-5-videos @ 92aee2f",
    "Descriptive Book (2021)",
    "v1.2 draft",
    "Part 1 / Part 2",
    "https://example.com/post/1",
  ]) {
    const f = fixture();
    const r = run(SCAFFOLD, f.root, f.src, "ok-label", "--source-label", label);
    assert.equal(r.status, 0, `label ${JSON.stringify(label)}: ${r.stdout}${r.stderr}`);
    assert.equal(readJson(join(f.skills, "ok-label", "provenance", "source.json")).sourceLabel, label);
  }
});

test("scaffold.mjs: a same-source re-scaffold keeps provenance byte for byte, a new label changes only sourceLabel", () => {
  const f = fixture();
  const prov = join(f.skills, "keep-prov", "provenance", "source.json");
  assert.equal(run(SCAFFOLD, f.root, f.src, "keep-prov", "--source-label", "Custom Label (2021)").status, 0);
  // Step 9 of the skill: the operator records the license by hand.
  writeFileSync(prov, JSON.stringify({ ...readJson(prov), license: "CC-BY-4.0" }, null, 2) + "\n");
  const before = readFileSync(prov, "utf8");

  const plain = run(SCAFFOLD, f.root, f.src, "keep-prov");
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(readFileSync(prov, "utf8"), before, "no label given: provenance must not be rewritten");
  assert.match(plain.stdout, /kept existing provenance/);

  const relabel = run(SCAFFOLD, f.root, f.src, "keep-prov", "--source-label", "Renamed Label");
  assert.equal(relabel.status, 0, relabel.stderr);
  assert.match(relabel.stdout, /updated sourceLabel only/);
  const after = readJson(prov);
  const prior = JSON.parse(before);
  assert.equal(after.sourceLabel, "Renamed Label");
  assert.deepEqual({ ...after, sourceLabel: null }, { ...prior, sourceLabel: null }, "only sourceLabel may change");
  assert.deepEqual(Object.keys(after), Object.keys(prior), "key order is kept");
});

test("scaffold.mjs: same-source re-scaffold keeps edits, a changed source is still refused with a new-slug hint", () => {
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
  assert.match(changed.stderr, /use a new slug/);
  assert.equal(readFileSync(prov, "utf8"), before, "a refused re-compile must not touch provenance");
});

// Found by mutating the refusal to carry on after printing REFUSED: the arm above stayed green.
test("scaffold.mjs: a changed source is refused before anything is written, a same-source re-run carries on", () => {
  const f = fixture();
  const gone = join(f.skills, "stops-there", "glossary.md"); // the scaffolder recreates it when it runs to the end
  assert.equal(run(SCAFFOLD, f.root, f.src, "stops-there").status, 0);

  rmSync(gone);
  const same = run(SCAFFOLD, f.root, f.src, "stops-there");
  assert.equal(same.status, 0, same.stderr);
  assert.equal(existsSync(gone), true, "a same-source re-run must run to the end");

  rmSync(gone);
  writeFileSync(f.src, "chapter one, revised\n");
  const changed = run(SCAFFOLD, f.root, f.src, "stops-there");
  assert.equal(changed.status, 1);
  assert.equal(existsSync(gone), false, "a refused re-compile must not write anything");
  assert.doesNotMatch(changed.stdout, /scaffolded/);
});

test("scaffold.mjs: a slug that still lives under the old generated/ layout is refused with a migrate hint", () => {
  const f = fixture();
  const legacy = join(f.skills, "generated", "legacy-pkg");
  mkdirSync(join(legacy, "provenance"), { recursive: true });
  writeFileSync(join(legacy, "provenance", "source.json"), "{}\n");
  const r = run(SCAFFOLD, f.root, f.src, "legacy-pkg");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /REFUSED/);
  assert.match(r.stderr, /Migrate it to \.claude\/skills\/legacy-pkg\//);
  assert.match(r.stderr, /another slug/);
  assert.equal(existsSync(join(f.skills, "legacy-pkg")), false, "no flat copy may appear beside a legacy package");
  assert.equal(readFileSync(join(legacy, "provenance", "source.json"), "utf8"), "{}\n", "the legacy package is left alone");
});

test("validate.mjs: a fresh draft is not loadable and fails, a finished package passes, a leftover draft fails V8 alone", () => {
  const f = fixture();
  const pkg = join(f.skills, "finished-pkg");
  assert.equal(run(SCAFFOLD, f.root, f.src, "finished-pkg").status, 0);

  assert.equal(existsSync(join(pkg, "SKILL.md")), false, "an unfinished package must not own SKILL.md");
  assert.equal(existsSync(join(pkg, "SKILL.draft.md")), true);
  const fresh = run(VALIDATE, f.root, pkg);
  assert.equal(fresh.status, 1, fresh.stdout + fresh.stderr);

  finish(pkg, "finished-pkg");
  const done = run(VALIDATE, f.root, pkg);
  assert.equal(done.status, 0, done.stdout + done.stderr);

  // Re-scaffolding a finished package must not bring the draft back.
  assert.equal(run(SCAFFOLD, f.root, f.src, "finished-pkg").status, 0);
  assert.equal(existsSync(join(pkg, "SKILL.draft.md")), false, "a re-scaffold resurrected the draft");
  assert.equal(run(VALIDATE, f.root, pkg).status, 0);

  writeFileSync(join(pkg, "SKILL.draft.md"), "DRAFT\n");
  const left = run(VALIDATE, f.root, pkg);
  assert.equal(left.status, 1);
  const lines = left.stderr.split("\n").filter((l) => l.startsWith("  \u00b7 "));
  assert.equal(lines.length, 1, left.stderr);
  assert.match(lines[0], /V8 /);
});
