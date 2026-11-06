// Canary for scripts/agent-os/auto-mode-layer.mjs (job 2026-11-06-auto-mode-output-style). The layer may only add
// classifier prose and ask rules, every list keeps "$defaults", and the REAL script run against a fixture home merges
// without touching any other key, is idempotent, and --check writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installed, layerProblems, merge } from "./auto-mode-layer.mjs";

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

test("merge allow (Codex 4494924444) covers merge-gate only without review-wait overrides, which need the user's own order", () => {
  const rule = LAYER.autoMode.allow.find((e) => e.includes("merge-gate.mjs"));
  assert.match(rule, /--codex-wait-minutes 0/);
  assert.match(rule, /without (?:any )?review-wait override/i);
  assert.match(rule, /override[^.]*user's own (?:message|order)/i);
});

test("gate: a list without $defaults, an allow rule, a mode or a broad ask rule refuses", () => {
  const cases = {
    "drops defaults": { autoMode: { soft_deny: ["only mine"] } },
    "permission allow": { ...LAYER, permissions: { allow: ["Bash(*)"] } },
    "default mode": { ...LAYER, defaultMode: "bypassPermissions" },
    "classifyAllShell off": { autoMode: { ...LAYER.autoMode, classifyAllShell: false } },
    "blanket ask": { ...LAYER, ask: ["Bash(*)"] },
    "non-shell ask": { ...LAYER, ask: ["Edit(**)"] },
    // Second reader 2026-11-06: RegExp.test stringifies, so a nested list passed and then duplicated on every merge.
    "nested ask": { ...LAYER, ask: [["Bash(railway up*)"]] },
    "ask not a list": { ...LAYER, ask: "Bash(railway up*)" },
    "blank entry": { autoMode: { allow: ["$defaults", "  "] } },
    "non-string entry": { autoMode: { allow: ["$defaults", 7] } },
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
  // A whole list or the ask list dropped from the layer takes our old entries with it; machine entries stay.
  const { soft_deny: _gone, ...rest } = LAYER.autoMode;
  const dropped = merge(once, { autoMode: rest }, LAYER);
  assert.deepEqual(dropped.autoMode.soft_deny, ["$defaults"]);
  assert.deepEqual(dropped.permissions.ask, ["Bash(mine *)"]);
});

test("ledger (Codex 4494924397): a rule the machine had before the first run is not recorded as ours, so dropping it later keeps it", () => {
  const ours = LAYER.autoMode.allow.find((e) => e !== "$defaults");
  const machine = { autoMode: { allow: ["$defaults", ours] } };
  const rec = installed(machine, LAYER);
  assert.ok(!rec.autoMode.allow.includes(ours), "a pre-existing machine rule was recorded as installed");
  const once = merge(machine, LAYER);
  const shrunk = { ...LAYER, autoMode: { ...LAYER.autoMode, allow: ["$defaults"] } };
  assert.ok(merge(once, shrunk, rec).autoMode.allow.includes(ours), "the machine's own rule was deleted");
  // A rule we added is still recorded, and one we recorded before stays recorded.
  assert.ok(installed({}, LAYER).autoMode.allow.includes(ours));
  assert.ok(installed(once, LAYER, installed({}, LAYER)).autoMode.allow.includes(ours));
});

test("cli (Codex 4494924384): with no --home, CLAUDE_CONFIG_DIR picks the settings file, as Claude Code does", () => {
  const f = fixture("config-dir");
  const dir = join(SCRATCH, "config-dir-alt");
  write(join(dir, "settings.json"), "{}");
  const e = { ...process.env, CLAUDE_CONFIG_DIR: dir, HOME: f.home, USERPROFILE: f.home };
  const r = spawnSync(process.execPath, [join(SCRATCH, "config-dir", "scripts", "agent-os", "auto-mode-layer.mjs")], { encoding: "utf8", env: e });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).autoMode, "CLAUDE_CONFIG_DIR settings.json was not written");
  assert.equal(JSON.parse(f.settings()).autoMode.soft_deny, undefined, "wrote ~/.claude/settings.json instead");
});

test("cli: a corrupt install ledger refuses with a REFUSE line and writes nothing", () => {
  const f = fixture("bad-ledger");
  write(join(f.home, ".claude", "auto-mode-layer.installed.json"), "{ broken");
  const before = f.settings();
  const r = f.run();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REFUSE\s+.*installed\.json/);
  assert.equal(f.settings(), before);
});

test("cli: run through a junction or symlink, the script still runs (a plain path compare skipped main and exited 0)", (t) => {
  const f = fixture("linked");
  const link = join(SCRATCH, "linked-via");
  try { symlinkSync(join(SCRATCH, "linked"), link, "junction"); } catch (err) { t.skip(`no link support: ${err.code}`); return; }
  const r = spawnSync(process.execPath, [join(link, "scripts", "agent-os", "auto-mode-layer.mjs"), "--home", f.home, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /DRIFT/);
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
  assert.ok(!existsSync(join(f.home, ".claude", "auto-mode-layer.installed.json")), "a refusal wrote the ledger");
});
