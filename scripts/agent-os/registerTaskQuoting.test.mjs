// Canary for the scheduled-task register scripts that launch node through `-Command "& '<node>' '<script>'"`:
// a single-quoted PowerShell string ends at the first apostrophe, so a checkout under "C:\Users\Nick's Tire"
// (the shop PC) yields "The string is missing the terminator" and the task never runs (seen live on MECHANICS,
// 2026-11-07: NOURCITY-Graph-Forward result 1 on every start). Every such script must double the apostrophes,
// curly ones included, the way register-machine-sync-task.ps1 does. REGISTER_TEST_ROOT points at another tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.REGISTER_TEST_ROOT ?? join(import.meta.dirname, "..", "..");
const scripts = readdirSync(join(root, "scripts")).filter((f) => /^register-.*\.ps1$/.test(f));
const doubled = (name) => new RegExp(`^\\$${name} = .*-replace "\\['[^"]*"\\s*,\\s*'\\$0\\$0'`, "m");

for (const name of scripts) {
  test(`scripts/${name}: single-quoted paths passed to -Command have their apostrophes doubled`, () => {
    const ps1 = readFileSync(join(root, "scripts", name), "utf8");
    const m = ps1.match(/-Command `"& '\$(\w+)' '\$(\w+)'`"/);
    if (!m) return; // -File "$script" is double-quoted: an apostrophe inside it is harmless
    for (const v of [m[1], m[2]]) assert.match(ps1, doubled(v), `$${v} is interpolated inside single quotes without -replace "['‘’‚‛]", '$0$0'`);
  });
}
