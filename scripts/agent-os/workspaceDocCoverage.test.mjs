/**
 * Every workspace package on disk must be named in the README's roster.
 *
 * WHY THIS EXISTS. On 2026-09-09 the root README documented THREE workspace
 * packages. Nine existed. Six — `ai-capabilities`, `social-assets`,
 * `reel-engine`, `gbp-publisher`, `meta-ads-architect`, `signal-forge` — had
 * been added over months and never appeared in the table a new reader (or a
 * new agent session) uses to learn what this repo contains. The ASCII tree
 * twenty lines above the table said the same wrong thing, and closed its list
 * with `└─`, which reads as "that is all of them".
 *
 * Nothing was broken by that. That is exactly what makes it expensive: an
 * undocumented package is not absent, it is INVISIBLE — the next session greps
 * the README, concludes the capability does not exist, and writes it again.
 * `@nour/signal-forge` is the live proof of how far this can drift: it is
 * declared in no app's `package.json` at all.
 *
 * WHY THIS IS A COVERAGE CHECK AND NOT A GENERATOR. The obvious fix is to
 * regenerate the table from `pnpm -r list --json`. Rejected on purpose: those
 * descriptions carry real judgment — which app consumes a package, at which
 * `package.json` line, and the fact that one has no consumer at all. A
 * generator would flatten that into a name-and-version list, i.e. delete the
 * only part worth reading. So this asserts COVERAGE (nothing on disk is
 * missing from the docs) and leaves the prose to a human.
 *
 * SCOPE. Presence of the package NAME, nothing more. It cannot tell whether
 * the surrounding sentence is true — a row that describes the wrong consumer
 * still passes. It closes the "wasn't mentioned at all" hole, which is the one
 * that actually happened, and does not pretend to close the other.
 *
 * HOW IT IS ITSELF PROVEN. `missingFrom()` is pure — roster and doc text in,
 * missing names out — so one test runs it against the live README and another
 * against a README with a real package's name deleted, asserting THAT name is
 * reported. A third asserts the roster is non-empty, so a clean verdict can
 * never come from an enumerator that found no packages.
 *
 * Run:  node --test scripts/agent-os/workspaceDocCoverage.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const README = join(REPO, "README.md");

/**
 * Workspace roots, read from pnpm-workspace.yaml rather than hardcoded, so
 * adding a third root does not leave this gate quietly scanning two of three.
 * Only the simple `- "dir/*"` form this repo uses is understood; anything else
 * throws rather than being skipped, because a root silently dropped here is a
 * whole class of package this gate stops covering.
 */
export function workspaceRoots(yamlText) {
  // Line scan, not one clever regex. The first version anchored the end of the
  // block with `(?=^\S|\Z)` — but JavaScript has no `\Z`, so that alternative
  // was the literal character Z. It passed against this repo only because
  // `catalog:` happens to follow the block; a workspace file ending at
  // `packages:` would have thrown "no packages: block". Caught by the parser
  // test below, which is the whole argument for having one.
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start < 0) throw new Error("pnpm-workspace.yaml has no `packages:` block");

  const roots = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) break; // a new top-level key ends the block
    const m = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (!m) throw new Error(`unparsable workspace entry: ${JSON.stringify(line)}`);
    roots.push(m[1]);
  }
  if (roots.length === 0) throw new Error("`packages:` block is empty");
  return roots;
}

/** Every workspace package on disk: its npm name and its repo-relative dir. */
export function roster(repo = REPO) {
  const roots = workspaceRoots(readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8"));
  const found = [];

  for (const glob of roots) {
    // Only the trailing-`*` form appears in this repo; anything else is a
    // shape this function has not been taught and must not silently ignore.
    if (!glob.endsWith("/*")) throw new Error(`unsupported workspace glob: ${glob}`);
    const dir = join(repo, glob.slice(0, -2));
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, "package.json");
      if (!existsSync(manifest)) continue; // e.g. apps/voice — a husk, 0 tracked files
      const name = JSON.parse(readFileSync(manifest, "utf8")).name;
      if (name) found.push({ name, dir: `${glob.slice(0, -2)}/${entry.name}` });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Pure: which rostered packages are absent from the doc text. */
export function missingFrom(docText, packages) {
  return packages.filter((p) => !docText.includes(p.name));
}

// ── The gate ───────────────────────────────────────────────────────────────

test("every workspace package is named in README.md", () => {
  const missing = missingFrom(readFileSync(README, "utf8"), roster());
  const detail = missing.map((p) => `  ${p.dir}  (${p.name})`).join("\n");
  assert.equal(
    missing.length,
    0,
    `workspace packages exist on disk but appear nowhere in README.md:\n${detail}\n` +
      `Add a row to the "Workspace packages" table — name, purpose, and which app consumes it.`,
  );
});

// ── Proof the gate can see ─────────────────────────────────────────────────

test("POSITIVE CONTROL: the roster is not vacuously empty", () => {
  const all = roster();
  assert.ok(all.length > 0, "no workspace packages enumerated — the gate would pass on anything");
  // Both declared roots must actually contribute, or a whole tree is going unchecked.
  assert.ok(all.some((p) => p.dir.startsWith("apps/")), "no apps/* package found");
  assert.ok(all.some((p) => p.dir.startsWith("packages/")), "no packages/* package found");
});

test("CANARY: deleting one real package's name from the README is caught", () => {
  const all = roster();
  const victim = all.find((p) => p.dir.startsWith("packages/"));
  assert.ok(victim, "no packages/* entry to mutate — cannot prove the gate fires");

  const text = readFileSync(README, "utf8");
  assert.equal(missingFrom(text, all).length, 0, "README starts clean");

  const corrupted = text.split(victim.name).join("«removed»");
  assert.notEqual(corrupted, text, "fixture setup failed: that name is not in the README");

  const caught = missingFrom(corrupted, all);
  assert.equal(caught.length, 1);
  assert.equal(caught[0].name, victim.name);
});

test("CANARY: a brand-new undocumented package would be reported", () => {
  // The actual regression shape: a directory lands, nobody updates the table.
  const invented = [{ name: "@nour/not-yet-documented", dir: "packages/not-yet-documented" }];
  const missing = missingFrom(readFileSync(README, "utf8"), invented);
  assert.equal(missing.length, 1);
});

// ── The workspace-root parser must fail loudly, never silently ─────────────

test("workspaceRoots reads the real config, and rejects shapes it cannot parse", () => {
  assert.deepEqual(workspaceRoots('packages:\n  - "apps/*"\n  - "packages/*"\n'), [
    "apps/*",
    "packages/*",
  ]);
  // A trailing block (this repo has `catalog:`) must not be swallowed as entries.
  assert.deepEqual(workspaceRoots('packages:\n  - "apps/*"\n\ncatalog:\n  typescript: "^5"\n'), [
    "apps/*",
  ]);
  // REGRESSION: `packages:` as the LAST block. The original `(?=^\S|\Z)` regex
  // threw here, because JS has no `\Z` — it read as a literal Z that never matched.
  assert.deepEqual(workspaceRoots('packages:\n  - "apps/*"\n'), ["apps/*"]);
  assert.deepEqual(workspaceRoots('packages:\n  - "apps/*"'), ["apps/*"]);
  assert.throws(() => workspaceRoots("catalog:\n  typescript: '^5'\n"), /no `packages:` block/);
  assert.throws(() => workspaceRoots("packages:\n  apps/*\n"), /unparsable workspace entry/);
});
