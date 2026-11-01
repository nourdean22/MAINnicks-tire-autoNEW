#!/usr/bin/env node
/**
 * plugin-prune: turn off, in ~/.claude/settings.json, the enabled plugins this repo has already ruled out
 * (config/agent-os/required-plugins.json `reject`; a `required` plugin always stays on).
 *
 * Why: 2026-11-01, 159 plugins were enabled and 26 of their MCP servers failed to connect at every session start; in
 * 30 days of transcripts only 9 plugins' MCP tools and about 12 plugins' skills were ever called. 37 of the enabled
 * plugins were on the reject list (wrong business or stack), still loading servers and skill text into every session.
 *
 *   node scripts/agent-os/plugin-prune.mjs                 plan: what would turn off (changes nothing)
 *   node scripts/agent-os/plugin-prune.mjs --apply         back up settings.json, then set those keys to false
 *   node scripts/agent-os/plugin-prune.mjs --restore <backup-file>
 *
 * Keys are set to false, never deleted, so /plugin and the claude.ai toggle still show them. Plugins enabled through
 * the claude.ai account (synced) are not in this file and are listed in the runbook instead. Canary: pluginPrune.test.mjs.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Keys of `enabledPlugins` to turn off: on, on the reject list, and not required. A failing MCP server is NOT a
 * reason by itself: prisma's local server fails while its remote one is the 4th most-called MCP (69 calls in 30 days).
 */
export function planPrune(settings, policy) {
  const name = (key) => key.split("@")[0];
  const required = new Set(policy.required.map((r) => r.name));
  return Object.entries(settings.enabledPlugins ?? {})
    .filter(([key, on]) => on === true && !required.has(name(key)) && Object.hasOwn(policy.reject ?? {}, name(key)))
    .map(([key]) => ({ key, reason: policy.reject[name(key)] }));
}

export function main(argv, { home = homedir(), root = ROOT, now = new Date() } = {}) {
  const file = join(home, ".claude", "settings.json");
  const r = argv.indexOf("--restore");
  if (r >= 0) {
    copyFileSync(argv[r + 1], file);
    return `[plugin-prune] restored ${file} from ${argv[r + 1]}`;
  }
  const settings = JSON.parse(readFileSync(file, "utf8"));
  const plan = planPrune(settings, JSON.parse(readFileSync(join(root, "config", "agent-os", "required-plugins.json"), "utf8")));
  const lines = plan.map((p) => `  off ${p.key}  (${p.reason})`);
  if (!argv.includes("--apply") || !plan.length) {
    return [`[plugin-prune] plan: ${plan.length} plugin(s) would turn off${plan.length ? " (run with --apply)" : ""}`, ...lines].join("\n");
  }
  const backup = `${file}.bak-plugin-prune-${now.toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  for (const p of plan) settings.enabledPlugins[p.key] = false;
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  return [`[plugin-prune] turned off ${plan.length} plugin(s); backup ${backup}`, `  undo: node scripts/agent-os/plugin-prune.mjs --restore "${backup}"`, ...lines].join("\n");
}

if (process.argv[1] && basename(process.argv[1]) === "plugin-prune.mjs") {
  try { process.stdout.write(main(process.argv.slice(2)) + "\n"); } catch (e) { process.stderr.write(`[plugin-prune] ${e.message}\n`); process.exitCode = 1; }
}
