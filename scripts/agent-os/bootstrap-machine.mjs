#!/usr/bin/env node
/**
 * bootstrap-machine: put the machine-local half of the always-on stance on this machine or account in one command,
 * from the repo copies, and report what is missing (job 2026-10-26-always-on-hardening).
 *
 *   node scripts/agent-os/bootstrap-machine.mjs            install or refresh every item, one receipt line each
 *   node scripts/agent-os/bootstrap-machine.mjs --check    report only (ok | MISSING | DRIFT), exit 1 when not clean
 *   ... --check --hook                                     SessionStart: one "[health] machine ..." line, exit 0 always
 *   --home <dir>                                           act on <dir> instead of the OS home (tests)
 * Wrappers: bootstrap-machine.ps1 (Windows) and bootstrap-machine.sh (Linux, cloud) pass their arguments through.
 *
 * Items, all under <home>/.claude and nothing else:
 *   hooks/always-on-skills.mjs, hooks/find-skills-turn.mjs   byte copies of scripts/agent-os/<same name>
 *   settings.json hooks   SessionStart startup|resume|clear|compact -> the always-on hook; UserPromptSubmit -> the
 *                         find-skills hook and this checkout's skill-recall.mjs --scope global. An entry is found by its
 *                         script name; only its command string is replaced; every other key is kept.
 *   skills/<name>         byte copies of the always-on skills that have a repo copy in .claude/skills (whole folder)
 *   CLAUDE.md             the block between the nourcity-always-on markers, from config/agent-os/global-claude-md-block.md
 * A file is backed up to <home>/.claude/bootstrap-backup/ before it is changed. A second run changes nothing.
 *
 * The hook line also names each plugin in config/agent-os/required-plugins.json that this account or machine has not
 * enabled (read through plugin-index.mjs from installed_plugins.json, settings.json enabledPlugins and the synced
 * account bucket), with its enable line. Plugins are enabled per account by Nour: the check detects and instructs only.
 * Canary: bootstrapMachine.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS } from "./always-on-skills.mjs";
import { enabledPlugins, readRouting } from "./plugin-index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const BEGIN = "<!-- nourcity-always-on:begin (written by scripts/agent-os/bootstrap-machine.mjs; edit the repo copy) -->";
const END = "<!-- nourcity-always-on:end -->";
const fwd = (p) => p.replaceAll("\\", "/");

/** The primary checkout, so the global skill-recall entry outlives a worktree; the script's own repo otherwise. */
function primaryRepo() {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const root = dirname(common);
    return existsSync(join(root, "scripts", "agent-os", "skill-recall.mjs")) ? root : REPO;
  } catch {
    return REPO;
  }
}

function filesUnder(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(join(d, e.name)); };
  walk(dir);
  return out;
}

const read = (f) => { try { return readFileSync(f); } catch { return null; } };

// The frontmatter `description:` entry, with any indented continuation lines.
const DESC = /^description:.*(?:\r?\n[ \t]+\S.*)*/m;
/** The repo SKILL.md with the machine copy's description put back, when the machine copy has one. */
export function keepDescription(repoBuf, machineBuf) {
  const repo = repoBuf.toString("utf8");
  const fm = (t) => /^---\r?\n[\s\S]*?\r?\n---/.exec(t)?.[0] ?? "";
  const mine = machineBuf ? DESC.exec(fm(machineBuf.toString("utf8")))?.[0] : null;
  const head = fm(repo);
  if (!mine || !DESC.test(head)) return repoBuf;
  return Buffer.from(head.replace(DESC, () => mine) + repo.slice(head.length), "utf8");
}

/** Every item as { label, state: ok|MISSING|DRIFT, apply() }. Nothing is written here. */
export function plan(home) {
  const claude = join(home, ".claude");
  const items = [];
  const backup = (file) => {
    if (!existsSync(file)) return;
    const to = join(claude, "bootstrap-backup", `${new Date().toISOString().replace(/[:.]/g, "-")}`, relative(claude, file));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
  };
  const fileItem = (label, src, dest) => {
    const have = read(dest);
    const state = have === null ? "MISSING" : have.equals(readFileSync(src)) ? "ok" : "DRIFT";
    items.push({ label, state, apply() { backup(dest); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest); } });
  };

  for (const name of ["always-on-skills.mjs", "find-skills-turn.mjs"]) fileItem(`~/.claude/hooks/${name}`, join(HERE, name), join(claude, "hooks", name));

  // Skills: whole folder from the repo, except that an existing machine SKILL.md keeps its own `description:` (the
  // operator's wording on this machine wins: prompt-gallery's machine copy says "every request", ruling 2026-10-26).
  // A machine-only extra file is left alone.
  const skillNames = [...new Set([...SKILLS.map((s) => s.split(" ")[0]), "antislop"])];
  for (const name of skillNames) {
    const src = join(REPO, ".claude", "skills", name);
    if (!existsSync(join(src, "SKILL.md"))) { items.push({ label: `~/.claude/skills/${name} (no repo copy: machine-only)`, state: "ok", apply() {} }); continue; }
    const pairs = filesUnder(src).map((f) => {
      const d = join(claude, "skills", name, relative(src, f));
      const want = /SKILL\.md$/.test(f) ? keepDescription(readFileSync(f), read(d)) : readFileSync(f);
      return [want, d];
    });
    const states = pairs.map(([want, d]) => { const h = read(d); return h === null ? "MISSING" : h.equals(want) ? "ok" : "DRIFT"; });
    const state = states.every((s) => s === "ok") ? "ok" : !existsSync(join(claude, "skills", name, "SKILL.md")) ? "MISSING" : "DRIFT";
    items.push({ label: `~/.claude/skills/${name}`, state, apply() {
      pairs.forEach(([want, d], i) => { if (states[i] !== "ok") { backup(d); mkdirSync(dirname(d), { recursive: true }); writeFileSync(d, want); } });
    } });
  }

  // settings.json hook registrations.
  const settingsFile = join(claude, "settings.json");
  const wanted = [
    { event: "SessionStart", matcher: "startup|resume|clear|compact", key: "always-on-skills.mjs", command: `node "${fwd(join(claude, "hooks", "always-on-skills.mjs"))}"` },
    { event: "UserPromptSubmit", matcher: "", key: "find-skills-turn.mjs", command: `node "${fwd(join(claude, "hooks", "find-skills-turn.mjs"))}"`, timeout: 5 },
    { event: "UserPromptSubmit", matcher: "", key: "skill-recall.mjs", command: `node "${fwd(join(primaryRepo(), "scripts", "agent-os", "skill-recall.mjs"))}" --scope global` },
  ];
  let settings;
  let settingsErr = null;
  try {
    settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  } catch {
    settingsErr = "settings.json is not valid JSON: fix it by hand first";
  }
  for (const w of wanted) {
    const label = `~/.claude/settings.json ${w.event} ${w.key}`;
    if (settingsErr) { items.push({ label: `${label} (${settingsErr})`, state: "DRIFT", apply() { throw new Error(settingsErr); } }); continue; }
    const hooks = (settings.hooks?.[w.event] ?? []).flatMap((g) => g.hooks ?? []);
    const found = hooks.find((h) => String(h.command || "").includes(w.key) && !String(h.command).includes("--repo"));
    const state = !found ? "MISSING" : found.command === w.command ? "ok" : "DRIFT";
    items.push({ label, state, apply() {
      const s = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
      s.hooks ??= {};
      s.hooks[w.event] ??= [];
      const hit = s.hooks[w.event].flatMap((g) => g.hooks ?? []).find((h) => String(h.command || "").includes(w.key) && !String(h.command).includes("--repo"));
      if (hit) hit.command = w.command;
      else s.hooks[w.event].push({ matcher: w.matcher, hooks: [{ type: "command", command: w.command, timeout: w.timeout ?? 10 }] });
      backup(settingsFile);
      mkdirSync(claude, { recursive: true });
      writeFileSync(settingsFile, `${JSON.stringify(s, null, 2)}\n`);
    } });
  }

  // Global CLAUDE.md pointer block.
  const mdFile = join(claude, "CLAUDE.md");
  const block = `${BEGIN}\n${readFileSync(join(REPO, "config", "agent-os", "global-claude-md-block.md"), "utf8").trim()}\n${END}`;
  const md = read(mdFile)?.toString("utf8") ?? null;
  const at = md?.indexOf(BEGIN) ?? -1;
  const endAt = at >= 0 ? md.indexOf(END, at) : -1;
  const mdState = at < 0 || endAt < 0 ? "MISSING" : md.slice(at, endAt + END.length) === block ? "ok" : "DRIFT";
  items.push({ label: "~/.claude/CLAUDE.md always-on block", state: mdState, apply() {
    const cur = read(mdFile)?.toString("utf8") ?? "";
    const a = cur.indexOf(BEGIN);
    const b = a >= 0 ? cur.indexOf(END, a) : -1;
    const next = a >= 0 && b >= 0 ? cur.slice(0, a) + block + cur.slice(b + END.length) : `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}\n${block}\n`;
    backup(mdFile);
    mkdirSync(claude, { recursive: true });
    writeFileSync(mdFile, next);
  } });
  return items;
}

/** Required plugins this account or machine has not enabled. */
export function missingPlugins(home, routing) {
  const { plugins } = enabledPlugins(home);
  const have = new Set(plugins.map((p) => p.name));
  return (routing.required ?? []).filter((p) => !have.has(p.name));
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--home");
  const home = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : process.env.USERPROFILE || process.env.HOME || homedir();
  const check = argv.includes("--check");
  const items = plan(home);
  const bad = items.filter((x) => x.state !== "ok");

  if (argv.includes("--hook")) {
    const routing = readRouting(REPO);
    const missing = missingPlugins(home, routing);
    const parts = [bad.length ? `bootstrap: ${bad.length} item(s) ${bad.map((x) => `${x.state} ${x.label.replace("~/.claude/", "")}`).join(", ")}` : "bootstrap ok"];
    parts.push(missing.length ? `plugins MISSING: ${missing.map((p) => p.name).join(", ")}` : `plugins ok (${(routing.required ?? []).length} required)`);
    const known = routing.knownConnectFailures?.servers?.length;
    if (known) parts.push(`known MCP connect failures: ${known} (as of ${routing.knownConnectFailures.asOf}, config/agent-os/required-plugins.json; not retried here)`);
    const fixes = [...(bad.length ? [`node "${fwd(join(REPO, "scripts", "agent-os", "bootstrap-machine.mjs"))}"`] : []), ...missing.map((p) => `Nour: ${p.enable}`)];
    const ok = !fixes.length;
    process.stdout.write(`[health] machine ${ok ? "ok | " : ""}${parts.join(" | ")}${fixes.length ? ` | FIX FIRST: ${fixes.map((f, n) => `(${n + 1}) ${f}`).join(" ")}` : ""}\n`);
    return 0;
  }
  if (check) {
    for (const x of items) process.stdout.write(`[bootstrap] ${x.state.padEnd(7)} ${x.label}\n`);
    process.stdout.write(`[bootstrap] ${bad.length ? `${bad.length} item(s) to fix: run without --check` : "clean"}\n`);
    return bad.length ? 1 : 0;
  }
  for (const x of items) {
    if (x.state === "ok") { process.stdout.write(`[bootstrap] ok        ${x.label}\n`); continue; }
    x.apply();
    process.stdout.write(`[bootstrap] ${x.state === "MISSING" ? "installed" : "updated  "} ${x.label}\n`);
  }
  return 0;
}

function isEntry() {
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntry()) {
  const hook = process.argv.includes("--hook");
  try {
    process.exitCode = main();
  } catch (err) {
    process.stdout.write(`${hook ? "[health] machine off" : "[bootstrap] error"}: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
    process.exitCode = hook ? 0 : 1;
  }
}
