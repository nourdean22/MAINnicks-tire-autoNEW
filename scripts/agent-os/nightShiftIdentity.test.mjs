/**
 * Night Shift identity preflight canaries (2026-09-15).
 *
 * judgeIdentity() is the credential-level boundary: the headless agent runs
 * only as an identity that structurally cannot land a change on main. These
 * break it first — the operator's own identity, a write identity with no
 * guard, an admin — then prove the two shapes that pass (read/triage → fork
 * flow; write + an ACTIVE non-bypassed ruleset → branch flow), and finally
 * that run.ps1 actually calls the preflight and refuses on its verdict.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeIdentity } from "../night-shift/identity-preflight.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const base = { operatorLogin: "nourdean22", nsLogin: "nick-night-shift", permission: "read", mainRuleset: { status: "unavailable" } };

test("POSITIVE CONTROL: a read-only machine identity is GO in fork mode", () => {
  const v = judgeIdentity(base);
  assert.deepEqual(v, { ok: true, mode: "fork", reasons: [] });
  assert.equal(judgeIdentity({ ...base, permission: "triage" }).mode, "fork");
});

test("the operator's own identity is REFUSED — a boundary against yourself is a fiction", () => {
  const v = judgeIdentity({ ...base, nsLogin: "nourdean22" });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join("\n"), /operator's own identity/);
  // case-insensitive: GitHub logins are
  assert.equal(judgeIdentity({ ...base, nsLogin: "NourDean22" }).ok, false);
});

test("a missing or unresolvable token is REFUSED", () => {
  const v = judgeIdentity({ ...base, nsLogin: null, permission: null });
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /NIGHT_SHIFT_GH_TOKEN is missing/);
});

test("write permission with no ruleset guard is REFUSED and names the Free-plan reason", () => {
  const v = judgeIdentity({ ...base, permission: "write" });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join("\n"), /GitHub Pro/);
  const disabled = judgeIdentity({ ...base, permission: "write", mainRuleset: { status: "disabled", restrictsMainUpdates: true, bypassesActor: false } });
  assert.equal(disabled.ok, false);
  assert.match(disabled.reasons.join("\n"), /no ACTIVE ruleset/);
});

test("write permission is GO in branch mode only with an ACTIVE ruleset that does not bypass this actor", () => {
  const ok = judgeIdentity({ ...base, permission: "write", mainRuleset: { status: "active", restrictsMainUpdates: true, bypassesActor: false } });
  assert.deepEqual(ok, { ok: true, mode: "branch", reasons: [] });
  const bypassed = judgeIdentity({ ...base, permission: "write", mainRuleset: { status: "active", restrictsMainUpdates: true, bypassesActor: true } });
  assert.equal(bypassed.ok, false);
  assert.match(bypassed.reasons.join("\n"), /actor bypasses it/);
});

test("admin / maintain / none are REFUSED with the reason named", () => {
  for (const permission of ["admin", "maintain"]) {
    const v = judgeIdentity({ ...base, permission });
    assert.equal(v.ok, false, permission);
    assert.match(v.reasons.join("\n"), /could merge anything/);
  }
  const none = judgeIdentity({ ...base, permission: "none" });
  assert.equal(none.ok, false);
  assert.match(none.reasons.join("\n"), /cannot even fork/);
});

test("a refusal never comes with a mode (nothing downstream may read a half-verdict)", () => {
  const v = judgeIdentity({ ...base, nsLogin: "nourdean22", permission: "read" });
  assert.equal(v.ok, false);
  assert.equal(v.mode, null);
});

test("run.ps1 fails CLOSED on the preflight: it requires the token, calls the preflight, refuses on a non-zero exit, and hands only GH_TOKEN to the child", () => {
  const src = readFileSync(resolve(HERE, "..", "night-shift", "run.ps1"), "utf8");
  // ASCII-only file (Windows PowerShell 5.1 reads BOM-less UTF-8 as cp1252)
  assert.ok(!/[^\x00-\x7F]/.test(src), "run.ps1 must stay ASCII");
  assert.match(src, /NIGHT_SHIFT_GH_TOKEN/);
  assert.match(src, /identity-preflight\.mjs/);
  assert.match(src, /darwin\.run_refused/);
  // the token is exported to the child as GH_TOKEN and the operator's token vars are cleared
  assert.match(src, /\$env:GH_TOKEN\s*=\s*\$env:NIGHT_SHIFT_GH_TOKEN/);
  assert.match(src, /\$env:GITHUB_TOKEN\s*=\s*\$null/);
  // the preflight verdict gates the run: a non-zero exit throws BEFORE claude starts
  const pre = src.indexOf("identity-preflight.mjs");
  const claude = src.indexOf("& claude @claudeArgs");
  assert.ok(pre > -1 && claude > -1 && pre < claude, "preflight must run before claude");
  assert.match(src.slice(pre, claude), /throw/);
});
