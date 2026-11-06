#!/usr/bin/env node
/**
 * Merge config/agent-os/auto-mode-layer.json into ~/.claude/settings.json: the auto-mode classifier entries (autoMode.*) and
 * the permissions.ask rules that keep protected Railway commands prompted. Nour runs it; an agent in auto mode cannot write
 * settings, and the classifier reads autoMode only from the user file (code.claude.com/docs/en/auto-mode-config, read
 * 2026-11-06). Machine entries stay; entries this script installed before and the layer dropped are removed (ledger:
 * ~/.claude/auto-mode-layer.installed.json). `--check` reports and writes nothing. Canary: autoModeLayer.test.mjs.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LISTS = ["environment", "allow", "soft_deny", "hard_deny"];
const ASK = /^(?:Bash|PowerShell)\([^()*]+\*?\)$/;

/** Why this layer may not install; empty when it may. Only classifier prose and ask rules: never an allow rule or a mode. */
export function layerProblems(layer) {
  const out = [];
  for (const k of Object.keys(layer ?? {})) if (!["_doc", "autoMode", "ask"].includes(k)) out.push(`key "${k}" is not allowed`);
  for (const k of Object.keys(layer?.autoMode ?? {})) if (!LISTS.includes(k)) out.push(`autoMode.${k} is not allowed`);
  for (const k of LISTS) {
    const v = layer?.autoMode?.[k];
    if (v === undefined) continue;
    // Without "$defaults" the built-in rules for that list are dropped: force-push, prod deploys, exfiltration.
    if (!Array.isArray(v) || !v.includes("$defaults") || v.some((e) => typeof e !== "string" || !e.trim())) out.push(`autoMode.${k} must be strings and keep "$defaults"`);
  }
  if (layer?.ask !== undefined && !Array.isArray(layer.ask)) out.push(`"ask" must be a list`);
  for (const r of Array.isArray(layer?.ask) ? layer.ask : []) if (typeof r !== "string" || !ASK.test(r)) out.push(`ask rule "${r}" must be one Bash(...) or PowerShell(...) prefix`);
  return out;
}

/** The settings object after the merge. `prev` = what this script installed last time. Pure. */
export function merge(settings, layer, prev = { autoMode: {}, ask: [] }) {
  const s = structuredClone(settings);
  const fold = (have = [], want = [], old = []) => [...have.filter((e) => e === "$defaults" || !old.includes(e) || want.includes(e)), ...want.filter((e) => !have.includes(e))];
  // A list the layer dropped still runs, with want = [], so the entries installed last time come out.
  for (const k of LISTS) {
    const want = layer.autoMode?.[k] ?? [];
    if (!want.length && !s.autoMode?.[k]) continue;
    s.autoMode ??= {};
    s.autoMode[k] = fold(s.autoMode[k] ?? ["$defaults"], want, prev.autoMode?.[k]);
  }
  const ask = layer.ask ?? [];
  if (ask.length || s.permissions?.ask) {
    s.permissions ??= {};
    s.permissions.ask = fold(s.permissions.ask, ask, prev.ask);
  }
  return s;
}

function main() {
  const args = process.argv.slice(2);
  const home = args.includes("--home") ? resolve(args[args.indexOf("--home") + 1]) : homedir();
  const claude = join(home, ".claude");
  const layerFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "agent-os", "auto-mode-layer.json");
  const layer = JSON.parse(readFileSync(layerFile, "utf8"));
  const problems = layerProblems(layer);
  if (problems.length) { for (const p of problems) console.log(`REFUSE  ${p}`); process.exit(1); }
  const file = join(claude, "settings.json");
  const ledger = join(claude, "auto-mode-layer.installed.json");
  let settings;
  try { settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; } catch { console.log("REFUSE  ~/.claude/settings.json is not valid JSON: fix it by hand first"); process.exit(1); }
  let prev;
  try { prev = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8")) : undefined; } catch { console.log("REFUSE  ~/.claude/auto-mode-layer.installed.json is not valid JSON: delete it by hand, then run again"); process.exit(1); }
  const record = `${JSON.stringify({ autoMode: layer.autoMode ?? {}, ask: layer.ask ?? [] }, null, 2)}\n`;
  // Write beside, then rename: a session starting now never reads half a settings file.
  const put = (f, text) => { writeFileSync(`${f}.tmp`, text); renameSync(`${f}.tmp`, f); };
  const next = merge(settings, layer, prev);
  const same = JSON.stringify(next) === JSON.stringify(settings);
  const count = (o) => [...LISTS.map((k) => o.autoMode?.[k]?.length ?? 0), o.permissions?.ask?.length ?? 0].join("/");
  if (args.includes("--check")) { console.log(`${same ? "ok" : "DRIFT"}  ~/.claude/settings.json autoMode env/allow/soft/hard + ask: ${count(settings)} (want ${count(next)})`); process.exit(same ? 0 : 1); }
  if (!same) {
    if (existsSync(file)) { const bak = join(claude, "bootstrap-backup", new Date().toISOString().replace(/[:.]/g, "-"), "settings.json"); mkdirSync(dirname(bak), { recursive: true }); copyFileSync(file, bak); }
    mkdirSync(claude, { recursive: true });
    put(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (!existsSync(ledger) || readFileSync(ledger, "utf8") !== record) put(ledger, record);
  console.log(`${same ? "ok" : "updated"}  ~/.claude/settings.json autoMode env/allow/soft/hard + ask: ${count(next)}. Restart Claude Code sessions to load it; check with: claude auto-mode config`);
}

// realpath both sides: run through a junction or with other drive-letter case, a plain compare skipped main() and exited 0.
function isEntry() {
  try {
    const [a, b] = [realpathSync(process.argv[1]), realpathSync(fileURLToPath(import.meta.url))];
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}
if (isEntry()) main();
