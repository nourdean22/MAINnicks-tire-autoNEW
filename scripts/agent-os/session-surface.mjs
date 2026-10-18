#!/usr/bin/env node
/**
 * session-surface: one SessionStart line saying what this session can reach, so a session knows the tools exist.
 *
 *   [surface] hooks: <user>+<project> events | mcp: user <names>; local <names>; project <names>; connectors: not
 *   readable here | plugins: <n> enabled | path: rtk ok|MISSING, uv ..., gh ..., railway ...
 *
 * Reads only local files and PATH; no network, never runs a tool (presence is `where.exe /q` on Windows, `command -v`
 * elsewhere). Health is not probed: `claude mcp list` takes seconds and a SessionStart hook must stay fast.
 *   user hooks, plugins     <home>/.claude/settings.json   missing or broken -> that side reads UNKNOWN (<reason>)
 *   mcp user + local        <home>/.claude.json            missing or broken -> UNKNOWN (<reason>), never "none"
 *   project hooks, plugins  <project>/.claude/settings.json + settings.local.json; an absent project file is a real 0
 *   mcp project             <project>/.mcp.json; absent is a real "none", broken is UNKNOWN
 * claude.ai connectors (Context7, Sentry, Gmail...) come from the account and are in no local file: the line says
 * so instead of listing them as present or absent.
 *
 * Every segment is computed on its own; one failed read never blanks another (empty-vs-error).
 * --home <dir> reads <dir> instead of the OS home (tests). Project dir: CLAUDE_PROJECT_DIR, else cwd.
 * Exit 0 always: any unexpected error prints one "[surface] off: <reason>" line. Canary: sessionSurface.test.mjs.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const TOOLS = ["rtk", "uv", "gh", "railway"];
const MAX_NAMES = 6;
const MAX_LINE = 300;
const WIN = process.platform === "win32";

/** Parse a JSON file; errors come back short and named ("settings.json: ENOENT"). `optional` turns ENOENT into null. */
function readJson(file, optional = false) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (optional && err.code === "ENOENT") return null;
    throw new Error(`${basename(file)}: ${err.code || "unreadable"}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${basename(file)}: bad JSON`);
  }
}

/** Run a read; a throw becomes {err}, so each caller decides how its own segment renders. */
function attempt(fn) {
  try {
    return { value: fn() };
  } catch (err) {
    return { err: String(err?.message || err).split(/\r?\n/)[0].slice(0, 60) };
  }
}

const unknown = (r) => `UNKNOWN (${r.err})`;

function objectAt(settings, key) {
  const v = settings?.[key];
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${key} is not an object`);
  return v;
}

function names(servers) {
  const list = Object.keys(servers || {});
  if (!list.length) return "none";
  return list.slice(0, MAX_NAMES).join(", ") + (list.length > MAX_NAMES ? ` +${list.length - MAX_NAMES} more` : "");
}

/** Claude Code keys projects in ~/.claude.json by path with forward slashes; drive-letter case varies on Windows. */
function projectEntry(claudeJson, projectDir) {
  const want = projectDir.replace(/\\/g, "/");
  const same = (k) => (WIN ? k.replace(/\\/g, "/").toLowerCase() === want.toLowerCase() : k === want);
  const key = Object.keys(objectAt(claudeJson, "projects")).find(same);
  return key ? claudeJson.projects[key] : undefined;
}

function onPath(tool) {
  const r = WIN
    ? spawnSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), ["/q", tool], { stdio: "ignore", timeout: 3000 })
    : spawnSync("/bin/sh", ["-c", 'command -v "$1"', "sh", tool], { stdio: "ignore", timeout: 3000 });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) throw new Error(`lookup exit ${r.status}`);
  return r.status === 0;
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--home");
  const home = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : homedir();
  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

  const user = attempt(() => readJson(join(home, ".claude", "settings.json")));
  const project = attempt(() => [
    readJson(join(projectDir, ".claude", "settings.json"), true),
    readJson(join(projectDir, ".claude", "settings.local.json"), true),
  ]);

  const userHooks = user.err ? user : attempt(() => Object.keys(objectAt(user.value, "hooks")).length);
  const projectHooks = project.err ? project : attempt(() => new Set(project.value.flatMap((s) => Object.keys(objectAt(s, "hooks")))).size);
  const hooks = `hooks: ${userHooks.err ? unknown(userHooks) : userHooks.value}+${projectHooks.err ? unknown(projectHooks) : projectHooks.value} events`;

  const claudeJson = attempt(() => readJson(join(home, ".claude.json")));
  const userLocal = claudeJson.err ? claudeJson : attempt(() => {
    const local = projectEntry(claudeJson.value, projectDir);
    return `user ${names(objectAt(claudeJson.value, "mcpServers"))}; local ${names(objectAt(local, "mcpServers"))}`;
  });
  const mcpJson = attempt(() => names(objectAt(readJson(join(projectDir, ".mcp.json"), true), "mcpServers")));
  const mcp = `mcp: ${userLocal.err ? unknown(userLocal) : userLocal.value}; project ${mcpJson.err ? unknown(mcpJson) : mcpJson.value}; connectors: not readable here`;

  // Effective plugin state: project files override user entries of the same name, as Claude Code merges them.
  const plugins = attempt(() => {
    if (user.err) throw new Error(user.err);
    if (project.err) throw new Error(project.err);
    const merged = Object.assign({}, objectAt(user.value, "enabledPlugins"), ...project.value.map((s) => objectAt(s, "enabledPlugins")));
    return Object.values(merged).filter((v) => v === true).length;
  });
  const pluginSeg = `plugins: ${plugins.err ? unknown(plugins) : `${plugins.value} enabled`}`;

  const path = "path: " + TOOLS.map((t) => {
    const r = attempt(() => onPath(t));
    return `${t} ${r.err ? unknown(r) : r.value ? "ok" : "MISSING"}`;
  }).join(", ");

  const line = `[surface] ${hooks} | ${mcp} | ${pluginSeg} | ${path}`;
  process.stdout.write((line.length > MAX_LINE ? line.slice(0, MAX_LINE - 3) + "..." : line) + "\n");
}

try {
  main();
} catch (err) {
  process.stdout.write(`[surface] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
}
process.exitCode = 0;
