/**
 * Canary for vendoredSkill.mjs (2026-10-18). The helper exempts vendored upstream copies from three repo-authored skill
 * gates, so it must say yes only for a folder whose SOURCE.md sha the UPSTREAMS register also names. Each rule is broken
 * on a throwaway repo and the answer must flip to false; the unbroken fixture and the real repo must still say true.
 *
 * Run: node --test scripts/agent-os/vendoredSkill.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isVendoredSkill } from "./vendoredSkill.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";

function fixture({ source = `Source: x\nPinned: ${SHA}\nLicense: MIT\n`, register = `| up | cap | **ADOPTED** | pinned \`${SHA}\` |\n` } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vendored-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  if (register !== null) writeFileSync(join(root, "docs", "UPSTREAMS.md"), register);
  const dir = join(root, ".claude", "skills", "x");
  mkdirSync(dir, { recursive: true });
  if (source !== null) writeFileSync(join(dir, "SOURCE.md"), source);
  return { root, dir };
}

test("a SOURCE.md that pins a full sha the register names is vendored", () => {
  const f = fixture();
  try {
    assert.equal(isVendoredSkill(f.dir, f.root), true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("each broken rule answers false: no SOURCE.md, short sha, sha absent from the register, no register file", () => {
  const cases = {
    "no SOURCE.md": fixture({ source: null }),
    "short sha": fixture({ source: "Pinned: 0123456\n" }),
    "sha not in the register": fixture({ register: "| up | cap | ADOPTED | a different sha |\n" }),
    "no register file": fixture({ register: null }),
    "sha not on its own Pinned line": fixture({ source: `see ${SHA} somewhere\n` }),
  };
  try {
    for (const [name, f] of Object.entries(cases)) assert.equal(isVendoredSkill(f.dir, f.root), false, name);
  } finally {
    for (const f of Object.values(cases)) rmSync(f.root, { recursive: true, force: true });
  }
});

test("every real folder that carries a SOURCE.md is vendored (a SOURCE.md without a register row is a defect)", () => {
  const root = join(REPO, ".claude", "skills");
  const withSource = readdirSync(root).filter((d) => existsSync(join(root, d, "SOURCE.md")));
  assert.ok(withSource.length >= 21, `only ${withSource.length} vendored folders found`);
  assert.deepEqual(withSource.filter((d) => !isVendoredSkill(join(root, d), REPO)), []);
});
