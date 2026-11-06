// Canary for scripts/agent-os/auto-mode-layer.mjs (job 2026-11-06-auto-mode-output-style). The layer may only add
// classifier prose and ask rules, every list keeps "$defaults", and the REAL script run against a fixture home merges
// without touching any other key, is idempotent, and --check writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { layerProblems, merge } from "./auto-mode-layer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const LAYER = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "auto-mode-layer.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "auto-mode-layer-"));
const write = (f, t) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };

function fixture(label, layer = LAYER) {
  const repo = join(SCRATCH, label);
  write(join(repo, "scripts", "agent-os", "auto-mode-layer.mjs"), readFileSync(join(HERE, "auto-mode-layer.mjs")));
  write(join(repo, "config", "agent-os", "auto-mode-layer.json"), JSON.stringify(layer));
  const home = join(repo, "home");
  write(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["Read"], ask: ["Bash(mine *)"] }, autoMode: { allow: ["$defaults", "my own rule"] } }, null, 2));
  const run = (...a) => { const r = spawnSync(process.execPath, [join(repo, "scripts", "agent-os", "auto-mode-layer.mjs"), "--home", home, ...a], { encoding: "utf8" }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  return { home, run, settings: () => readFileSync(join(home, ".claude", "settings.json"), "utf8") };
}

test("positive control: the shipped layer passes the gate and keeps $defaults in every list it sets", () => {
  assert.deepEqual(layerProblems(LAYER), []);
  for (const k of ["environment", "allow", "soft_deny"]) assert.ok(LAYER.autoMode[k].includes("$defaults"), k);
});

test("gate: a list without $defaults, an allow rule, a mode or a broad ask rule refuses", () => {
  const cases = {
    "drops defaults": { autoMode: { soft_deny: ["only mine"] } },
    "permission allow": { ...LAYER, permissions: { allow: ["Bash(*)"] } },
    "default mode": { ...LAYER, defaultMode: "bypassPermissions" },
    "classifyAllShell off": { autoMode: { ...LAYER.autoMode, classifyAllShell: false } },
    "blanket ask": { ...LAYER, ask: ["Bash(*)"] },
    "non-shell ask": { ...LAYER, ask: ["Edit(**)"] },
  };
  for (const [label, layer] of Object.entries(cases)) assert.notDeepEqual(layerProblems(layer), [], label);
});

test("merge: machine entries stay, ours are added once, an entry we installed and later dropped is removed", () => {
  const machine = { model: "opus", autoMode: { allow: ["$defaults", "my own rule"] }, permissions: { allow: ["Read"], ask: ["Bash(mine *)"] } };
  const once = merge(machine, LAYER);
  assert.deepEqual(merge(once, LAYER, LAYER), once, "second merge changed something");
  assert.ok(once.autoMode.allow.includes("my own rule") && once.autoMode.allow.filter((e) => e === "$defaults").length === 1);
  assert.deepEqual(once.permissions.allow, ["Read"], "allow rules must never change");
  const shrunk = { ...LAYER, autoMode: { ...LAYER.autoMode, allow: ["$defaults"] } };
  const after = merge(once, shrunk, LAYER);
  assert.deepEqual(after.autoMode.allow, ["$defaults", "my own rule"]);
});

test("cli: --check on a fresh home reports DRIFT and writes nothing; apply merges; --check is then clean", () => {
  const f = fixture("cli");
  const before = f.settings();
  const c1 = f.run("--check");
  assert.equal(c1.code, 1, c1.out);
  assert.match(c1.out, /DRIFT/);
  assert.equal(f.settings(), before, "--check wrote settings");
  assert.equal(f.run().code, 0);
  const s = JSON.parse(f.settings());
  assert.equal(s.model, "opus");
  assert.deepEqual(s.permissions.allow, ["Read"]);
  assert.ok(s.permissions.ask.includes("Bash(mine *)") && s.permissions.ask.includes("Bash(railway up*)"));
  assert.ok(s.autoMode.soft_deny.includes("$defaults"));
  assert.ok(existsSync(join(f.home, ".claude", "bootstrap-backup")), "no backup was made");
  assert.equal(f.run("--check").code, 0);
});

test("cli: a refused layer writes nothing", () => {
  const f = fixture("refused", { autoMode: { allow: ["no defaults here"] } });
  const before = f.settings();
  const r = f.run();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REFUSE\s+autoMode\.allow/);
  assert.equal(f.settings(), before);
});
