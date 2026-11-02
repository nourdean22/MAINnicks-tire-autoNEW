/**
 * Canaries for reconciliation-render.mjs (2026-11-02): one file per PR under apps/statenour/docs/reconciliation/, read
 * newest first, and a misnamed file or a header whose date disagrees with the file name fails the run (exit 1, named).
 * Every arm spawns the real script.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "reconciliation-render.mjs");
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...(root ? ["--root", root] : []), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "recon-"));
  const dir = join(root, "apps", "statenour", "docs", "reconciliation");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return root;
}
const OLD = "> ## 2026-11-02 · older wave · 1 ship\n>\n> - **a ship**\n";
const NEW = "> ## 2026-11-05 · newer wave · 2 ships\r\n>\r\n> - **b ship**\r\n";

test("positive control: the repo's own folder renders with exit 0 and at least one entry", () => {
  const r = run(null, "--list");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md {2}> ## \d{4}-\d{2}-\d{2}/m);
});

test("entries print newest first, in full, and --tail / --list narrow them", () => {
  const root = fixture({ "2026-11-02-older.md": OLD, "2026-11-05-newer.md": NEW });
  const all = run(root);
  assert.equal(all.code, 0, all.err);
  assert.ok(all.out.indexOf("newer wave") < all.out.indexOf("older wave") && all.out.includes("> - **a ship**"), all.out);
  const one = run(root, "--tail", "1", "--list");
  assert.equal(one.out, "2026-11-05-newer.md  > ## 2026-11-05 · newer wave · 2 ships\n");
});

test("a misnamed file or a header whose date disagrees with the name fails the run, named, and good entries still print", () => {
  const root = fixture({ "2026-11-02-older.md": OLD, "notes.md": OLD, "2026-11-03-wrong-date.md": OLD });
  mkdirSync(join(root, "apps", "statenour", "docs", "reconciliation", "2026-11-04-a-directory.md")); // a directory, not a file
  const r = run(root, "--list");
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /notes\.md: name must be/);
  assert.match(r.err, /2026-11-03-wrong-date\.md: first line must be "> ## 2026-11-03/);
  assert.match(r.err, /2026-11-04-a-directory\.md: unreadable/, "one unreadable entry is named, not the whole folder");
  assert.equal(r.out, "2026-11-02-older.md  > ## 2026-11-02 · older wave · 1 ship\n", "only the well-formed entry prints");
});

test("bad flag exits 64; a missing folder exits 2", () => {
  assert.equal(run(fixture({}), "--tail", "0").code, 64);
  assert.equal(run(mkdtempSync(join(tmpdir(), "recon-none-"))).code, 2);
});
