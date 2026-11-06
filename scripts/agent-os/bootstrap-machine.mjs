#!/usr/bin/env node
/**
 * bootstrap-machine: put the machine-local half of the always-on stance on this machine or account in one command,
 * from the repo copies, and report what is missing (job 2026-10-26-always-on-hardening).
 *
 *   node scripts/agent-os/bootstrap-machine.mjs            install or refresh every item, one receipt line each
 *   node scripts/agent-os/bootstrap-machine.mjs --check    report only (ok | MISSING | DRIFT), exit 1 when not clean
 *   ... --check --hook                                     SessionStart: one "[health] machine ..." line, exit 0 always
 *   --home <dir>                                           act on <dir> instead of the OS home (tests); wins over CLAUDE_CONFIG_DIR
 * Wrappers: bootstrap-machine.ps1 (Windows) and bootstrap-machine.sh (Linux, cloud) pass their arguments through.
 *
 * Items, all under <home>/.claude and nothing else:
 *   hooks/always-on-skills.mjs, hooks/find-skills-turn.mjs   byte copies of scripts/agent-os/<same name>
 *   settings.json hooks   SessionStart startup|resume|clear|compact -> the always-on hook; UserPromptSubmit -> the
 *                         find-skills hook and this checkout's skill-recall.mjs and prompt-sharpen.mjs, each with
 *                         --scope global. An entry is found by its
 *                         script name; only its command string is replaced; every other key is kept.
 *   skills/<name>         byte copies of the always-on skills that have a repo copy in .claude/skills (whole folder)
 *   CLAUDE.md             the block between the nourcity-always-on markers, from config/agent-os/global-claude-md-block.md
 *   settings.json hooks   (2026-11-03) SessionStart -> graph-ensure-mcp.mjs --scope global and UserPromptSubmit ->
 *                         graph-recall.mjs --scope global from this checkout, so every repo on the machine gets the graph
 *                         MCP launched and queried; both stay silent inside a project whose own settings run them.
 * And one file beside it: <home>/.claude.json `mcpServers.graphify` = the user-scope MCP entry (what `claude mcp add
 * --transport http --scope user` writes; docs: code.claude.com/docs/en/mcp, read 2026-11-03), the mirror of the repo's
 * .mcp.json for other repos on the machine. Every other key in that file is kept; a file that is not valid JSON is
 * never touched (DRIFT with a fix-by-hand note).
 * A file is backed up to <home>/.claude/bootstrap-backup/ before it is changed. A second run changes nothing.
 *
 * The hook line also names each plugin in config/agent-os/required-plugins.json that this account or machine has not
 * enabled (read through plugin-index.mjs from installed_plugins.json, settings.json enabledPlugins and the synced
 * account bucket), with its enable line. Plugins are enabled per account by Nour: the check detects and instructs only.
 * The personal layer (2026-11-05) comes from config/agent-os/user-layer.json, the one source: the skills beyond the always-on
 * set, the settings keys and marketplaces, the hook list above, the extra MCP entries and RTK.md. Audit and reasons:
 * docs/agent-os/MACHINE-SYNC.md, section Personal layer. An item that needs a tool (`requires`) reads n/a where it is not on
 * PATH. Before anything is written, every source file passes the public-repo gate: a secret, a machine path, a private
 * address, a key file, a skill that registers hooks, a tool grant beyond the file tools (BASH_GRANTS names three exceptions), a link
 * on a write path, or a layer key outside the allowlists reads REFUSE,
 * and an install writes nothing. A permission entry can only arrive by editing SETTINGS_KEYS in a PR, after Nour's yes.
 * Canary: bootstrapMachine.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matcherCovers, SKILLS } from "./always-on-skills.mjs";
import { configDir, enabledPlugins, globalConfigFile, readRouting } from "./plugin-index.mjs";
import { onPath } from "./session-surface.mjs";

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

const LAYER_KEYS = new Set(["_doc", "skills", "settings", "hooks", "files", "mcpServers"]);
// The settings this script may write. Everything else refuses the install: permissions, defaultMode, env, apiKeyHelper,
// hooks (those come through the hook list) and, until Nour says yes, enabledPlugins and cleanupPeriodDays.
const SETTINGS_KEYS = new Set(["skillListingBudgetFraction", "outputStyle", "theme", "skipWorkflowUsageWarning", "precomputeCompactionEnabled", "switchModelsOnFlag", "inputNeededNotifEnabled", "agentPushNotifEnabled", "extraKnownMarketplaces"]);
const HOOK_KEYS = new Set(["event", "matcher", "sources", "key", "command", "timeout", "requires"]);
// Where files[] may write. Without this a dest of settings.json or CLAUDE.md would replace the whole file and sidestep the gate.
const FILE_DESTS = new Set(["RTK.md", "output-styles/nour.md"]);
// One optional subfolder under config/agent-os, never an all-dots segment ("..", or "..." that Windows trims to "..").
const FILE_SRC = /^config\/agent-os\/(?:(?!\.+\/)[\w.-]+\/)?(?!\.+$)[\w.-]+$/;
const isMap = (x) => typeof x === "object" && x !== null && !Array.isArray(x);

/** Why this user-layer.json may not install; empty when it may. */
export function layerProblems(layer) {
  if (!isMap(layer)) return ["the layer must be an object"];
  const shape = [["settings", isMap], ["mcpServers", isMap], ["hooks", Array.isArray], ["files", Array.isArray]].filter(([k, ok]) => layer[k] !== undefined && !ok(layer[k])).map(([k]) => `"${k}" has the wrong shape`);
  if (shape.length) return shape;
  if ([...(layer.hooks ?? []), ...(layer.files ?? []), ...Object.values(layer.mcpServers ?? {})].some((x) => !isMap(x))) return ["every hook, file and MCP entry must be an object"];
  const out = [];
  for (const k of Object.keys(layer)) if (!LAYER_KEYS.has(k)) out.push(`key "${k}" is not allowed`);
  for (const k of Object.keys(layer.settings ?? {})) if (!SETTINGS_KEYS.has(k)) out.push(`settings key "${k}" is not allowed`);
  if (!Array.isArray(layer.skills) || layer.skills.some((n) => !/^[a-z0-9][a-z0-9-]*$/.test(n))) out.push("skills must be a list of folder names");
  for (const [name, m] of Object.entries(layer.mcpServers ?? {})) {
    if (Object.keys(m).sort().join() !== "type,url" || m.type !== "http" || !/^https:\/\//.test(m.url)) out.push(`mcpServers "${name}" must be only type http and an https url`);
  }
  for (const h of layer.hooks ?? []) {
    if (Object.keys(h).some((k) => !HOOK_KEYS.has(k)) || !h.event || !h.key || !String(h.command ?? "").includes(h.key)) out.push(`hook "${h.key ?? h.event}" must have an event, a key and a command naming that key, and no other field`);
  }
  for (const x of layer.files ?? []) {
    if (!FILE_DESTS.has(x.dest) || !FILE_SRC.test(x.src ?? "")) out.push(`file "${x.dest}" must be a named destination copied from config/agent-os`);
  }
  return out;
}

// What a public repo must not hand to a machine. Placeholders (<you>, %USERNAME%, $USER) pass.
const NOT_A_NAME = /(?![<{$%]|(?:you|your|user|username|name|me|example|public|default)(?:[\\/]|$))/.source;
const UNSAFE = [
  ["api key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Neon password", /\bnpg_[A-Za-z0-9]{10,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Telegram token", /\b\d{8,10}:[A-Za-z0-9_-]{35,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Stripe key", /\b[sr]k_live_[A-Za-z0-9]{10,}/],
  ["database URL", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/<>{}$%]+@/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ["credential value", /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
  ["user folder", new RegExp(/\b[A-Za-z]:[\\/]+Users[\\/]+/.source + NOT_A_NAME + /[^\\/\s"'<>]+/.source, "i")],
  ["user folder", new RegExp(/(?:^|[\s"'(])\/(?:home|Users)\//.source + NOT_A_NAME + /[A-Za-z][\w-]*\//.source, "i")],
  ["private address", /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b(?!\/\d)/],
  ["tailnet address", /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b(?!\/\d)/],
];
const KEY_FILE = /^(?:\.env(?:\..*)?|\.credentials\.json|id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i;

// The tools a skill may grant itself. A grant is a permission entry, so this is an allowlist: PowerShell, an MCP runner, Agent or
// anything new refuses without being named here.
const SAFE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep"]);
// Nour, 2026-11-05 10:45 EST, on these three: "yes i want it too those are good skills needed". Exactly these folders, exactly
// these grants: any other shell grant, and any change to one of these lines, refuses.
const BASH_GRANTS = new Map([
  ["antislop-human", "Bash(python *) Bash(python3 *) Read Write Edit Glob Grep"],
  ["differential-review", "Read Write Grep Glob Bash"],
  ["supply-chain-risk-auditor", "Read Write Bash Glob Grep"],
]);
const FRONT_KEY = (key) => new RegExp(String.raw`(?:^|[{,][ \t]*)["']?${key}["']?[ \t]*:.*(?:\r?\n[ \t]+.*)*`, "gim");

/** Why one source file may not install, as "<kind>" or "<line> <kind>" strings. Never the matched text. */
export function fileProblems(name, buf, skill = null) {
  const out = KEY_FILE.test(name) ? ["a key or env file by its name"] : [];
  const text = buf.toString("utf8");
  for (const [kind, re] of UNSAFE) {
    if (!re.test(text)) continue;
    text.split("\n").forEach((line, i) => { if (re.test(line)) out.push(`${i + 1} ${kind}`); });
  }
  if (name === "SKILL.md") {
    // trimStart: a BOM or a blank line before the opening fence must not hide the frontmatter from this check.
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.trimStart())?.[1] ?? "";
    if (FRONT_KEY("hooks").test(fm)) out.push("a hooks key in the frontmatter");
    const grants = [...fm.matchAll(FRONT_KEY("allowed[-_]?tools"))].map((m) => m[0]);
    const value = (g) => g.slice(g.indexOf(":") + 1).trim();
    const named = grants.length === 1 && value(grants[0]) === BASH_GRANTS.get(skill);
    const safe = (g) => value(g).replace(/[[\]"']/g, " ").split(/[\s,]+/).filter((t) => t && t !== "-").every((t) => SAFE_TOOLS.has(t));
    if (!named && !grants.every(safe)) out.push("a tool grant beyond the file tools in allowed-tools");
  }
  return out;
}

// The frontmatter `description:` entry, with any indented continuation lines.
const DESC = /^description:.*(?:\r?\n[ \t]+\S.*)*/m;
/** The repo SKILL.md with the machine copy's description put back, when the machine copy has one. */
export function keepDescription(repoBuf, machineBuf) {
  const repo = repoBuf.toString("utf8");
  const fm = (t) => /^---\r?\n[\s\S]*?\r?\n---/.exec(t)?.[0] ?? "";
  const mine = machineBuf ? DESC.exec(fm(machineBuf.toString("utf8")))?.[0]?.replaceAll("\r", "") : null;
  const head = fm(repo);
  if (!mine || !DESC.test(head)) return repoBuf;
  return Buffer.from(head.replace(DESC, () => mine) + repo.slice(head.length), "utf8");
}

/** Every item as { label, state: ok|MISSING|DRIFT, apply() }. Nothing is written here. */
export function plan(home) {
  const claude = configDir(home); // CLAUDE_CONFIG_DIR when set and no --home (Codex 4380254412)
  const items = [];
  const refuse = (what) => items.push({ label: what, state: "REFUSE", apply() { throw new Error(what); } });
  let layer;
  try {
    layer = JSON.parse(readFileSync(join(REPO, "config", "agent-os", "user-layer.json"), "utf8"));
  } catch (err) {
    refuse(`config/agent-os/user-layer.json: unreadable (${String(err?.message || err).split(/\r?\n/)[0]})`);
    return items;
  }
  const problems = layerProblems(layer);
  for (const p of problems) refuse(`config/agent-os/user-layer.json: ${p}`);
  if (problems.length) return items;
  const skillNames = [...new Set([...SKILLS.map((s) => s.split(" ")[0]), "antislop", ...layer.skills])];

  // The gate: all of it runs before any item exists, so a refusal cannot leave a half-made install.
  const sources = [...["always-on-skills.mjs", "find-skills-turn.mjs"].map((n) => join(HERE, n)), ...["user-layer.json", "global-claude-md-block.md"].map((n) => join(REPO, "config", "agent-os", n)),
    ...(layer.files ?? []).map((x) => join(REPO, x.src ?? "")), ...skillNames.flatMap((n) => { const d = join(REPO, ".claude", "skills", n); return existsSync(d) ? filesUnder(d) : []; })];
  for (const f of sources) {
    const buf = read(f);
    // Only a skill's own top-level SKILL.md can match BASH_GRANTS: the name comes from the folder, never from the file.
    const parts = fwd(relative(join(REPO, ".claude", "skills"), f)).split("/");
    if (buf) for (const p of fileProblems(basename(f), buf, parts.length === 2 ? parts[0] : null)) refuse(`${fwd(relative(REPO, f))}:${p}`);
  }
  if (items.length) return items;

  // writeFileSync follows a link, so a link on a write path would change files outside the config dir.
  const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
  const linkRefused = (p, label) => { if (isLink(p)) refuse(`${label} is a link: replace it by hand, bootstrap never writes through one`); return isLink(p); };
  linkRefused(join(claude, "hooks"), "~/.claude/hooks");
  linkRefused(join(claude, "skills"), "~/.claude/skills");

  const tools = new Map();
  const has = (tool) => { if (!tools.has(tool)) tools.set(tool, onPath(tool).state === "ok"); return tools.get(tool); };
  const absent = (label, tool) => items.push({ label: `${label} (${tool} not on PATH)`, state: "n/a", apply() {} });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backedUp = new Set();
  const backup = (file) => {
    if (!existsSync(file) || backedUp.has(file)) return;
    backedUp.add(file);
    // ~/.claude.json sits beside the config dir, not inside it: keep its backup inside bootstrap-backup/ by base name.
    const rel = relative(claude, file);
    const to = join(claude, "bootstrap-backup", stamp, rel.startsWith("..") ? basename(file) : rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
  };
  const fileItem = (label, src, dest) => {
    // Every folder between the config dir and a nested dest too: copyFileSync follows a linked parent (Codex 4494924419).
    for (let d = dirname(dest); relative(claude, d) && !relative(claude, d).startsWith(".."); d = dirname(d)) {
      if (linkRefused(d, `~/.claude/${fwd(relative(claude, d))}`)) return;
    }
    if (linkRefused(dest, label)) return;
    const have = read(dest);
    const state = have === null ? "MISSING" : have.equals(readFileSync(src)) ? "ok" : "DRIFT";
    items.push({ label, state, apply() { backup(dest); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest); } });
  };

  for (const name of ["always-on-skills.mjs", "find-skills-turn.mjs"]) fileItem(`~/.claude/hooks/${name}`, join(HERE, name), join(claude, "hooks", name));
  for (const x of layer.files ?? []) {
    if (x.requires && !has(x.requires)) absent(`~/.claude/${x.dest}`, x.requires);
    else fileItem(`~/.claude/${x.dest}`, join(REPO, x.src), join(claude, x.dest));
  }

  // Skills: whole folder from the repo, except that an existing machine SKILL.md keeps its own `description:` (the
  // operator's wording on this machine wins: prompt-gallery's machine copy says "every request", ruling 2026-10-26).
  // A machine-only extra file is left alone.
  for (const name of skillNames) {
    const src = join(REPO, ".claude", "skills", name);
    if (!existsSync(join(src, "SKILL.md"))) {
      // No repo copy: the bootstrap cannot install it, so a machine without it reads MISSING, never ok (Codex 4380254390).
      const have = existsSync(join(claude, "skills", name, "SKILL.md"));
      items.push({ label: `~/.claude/skills/${name} (no repo copy: install it on this machine or vendor it into .claude/skills)`, state: have ? "ok" : "MISSING", manual: true, apply() {} });
      continue;
    }
    // A skill folder that is a link (`npx skills` junctions) is replaced by a real one: only the link goes, its target stays.
    const linked = isLink(join(claude, "skills", name));
    const pairs = filesUnder(src).map((f) => {
      const d = join(claude, "skills", name, relative(src, f));
      const want = /SKILL\.md$/.test(f) ? keepDescription(readFileSync(f), read(d)) : readFileSync(f);
      return [want, d, f];
    });
    const states = pairs.map(([want, d]) => { const h = read(d); return h === null ? "MISSING" : h.equals(want) ? "ok" : "DRIFT"; });
    if (!linked && pairs.some(([, d]) => linkRefused(d, `~/.claude/skills/${name}/${basename(d)}`))) continue;
    const state = linked ? "DRIFT" : states.every((s) => s === "ok") ? "ok" : !existsSync(join(claude, "skills", name, "SKILL.md")) ? "MISSING" : "DRIFT";
    items.push({ label: `~/.claude/skills/${name}${linked ? " (a link: bootstrap replaces it with a real folder)" : ""}`, state, apply() {
      if (linked) unlinkSync(join(claude, "skills", name));
      pairs.forEach(([want, d, f], i) => { if (linked || states[i] !== "ok") { backup(d); mkdirSync(dirname(d), { recursive: true }); writeFileSync(d, want); chmodSync(d, statSync(f).mode); } });
    } });
  }

  // settings.json hook registrations.
  const settingsFile = join(claude, "settings.json");
  const primary = fwd(primaryRepo());
  const wanted = (layer.hooks ?? []).map((h) => ({ ...h, command: h.command.replaceAll("{claude}", fwd(claude)).replaceAll("{repo}", primary) }));
  let settings;
  let settingsErr = null;
  try {
    settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  } catch {
    settingsErr = "settings.json is not valid JSON: fix it by hand first";
  }
  const saveSettings = (s) => {
    backup(settingsFile);
    mkdirSync(claude, { recursive: true });
    writeFileSync(settingsFile, `${JSON.stringify(s, null, 2)}\n`);
  };
  const readSettings = () => (existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {});
  for (const w of wanted) {
    const label = `~/.claude/settings.json ${w.event} ${w.key}`;
    if (w.requires && !has(w.requires)) { absent(label, w.requires); continue; }
    if (linkRefused(settingsFile, label)) continue;
    if (settingsErr) { items.push({ label: `${label} (${settingsErr})`, state: "DRIFT", apply() { throw new Error(settingsErr); } }); continue; }
    const isOurs = (h) => String(h.command || "").includes(w.key) && !String(h.command).includes("--repo");
    const locate = (s) => { for (const g of s.hooks?.[w.event] ?? []) { const h = (g.hooks ?? []).find(isOurs); if (h) return { g, h }; } return null; };
    // A registration whose group matcher misses one of the sources is partial: the repo hook re-arms only the sources
    // it misses, so --check says DRIFT and apply moves the hook to a full group (Codex 4380254400).
    const covers = (g) => !w.sources || w.sources.every((src) => matcherCovers(g.matcher, src));
    const found = locate(settings);
    const state = !found ? "MISSING" : found.h.command === w.command && covers(found.g) ? "ok" : "DRIFT";
    items.push({ label: found && !covers(found.g) ? `${label} (matcher "${found.g.matcher}" is partial)` : label, state, apply() {
      const s = readSettings();
      s.hooks ??= {};
      s.hooks[w.event] ??= [];
      const hit = locate(s);
      if (hit && covers(hit.g)) hit.h.command = w.command;
      else {
        if (hit) {
          hit.g.hooks = hit.g.hooks.filter((h) => h !== hit.h);
          s.hooks[w.event] = s.hooks[w.event].filter((g) => (g.hooks ?? []).length);
        }
        s.hooks[w.event].push({ matcher: w.matcher, hooks: [{ type: "command", command: w.command, timeout: w.timeout ?? 10 }] });
      }
      saveSettings(s);
    } });
  }

  // Settings keys and marketplaces: one item each, and a marketplace of the machine's own stays.
  const { extraKnownMarketplaces: markets = {}, ...plainSettings } = layer.settings ?? {};
  const settingItems = [
    ...Object.entries(plainSettings).map(([k, want]) => ({ label: k, want, get: (s) => s[k], set: (s) => { s[k] = want; } })),
    ...Object.entries(markets).map(([m, want]) => ({ label: `extraKnownMarketplaces ${m}`, want, get: (s) => s.extraKnownMarketplaces?.[m], set: (s) => { (s.extraKnownMarketplaces ??= {})[m] = want; } })),
  ];
  for (const x of settingItems) {
    const label = `~/.claude/settings.json ${x.label}`;
    if (linkRefused(settingsFile, label)) continue;
    if (settingsErr) { items.push({ label: `${label} (${settingsErr})`, state: "DRIFT", apply() { throw new Error(settingsErr); } }); continue; }
    const cur = x.get(settings);
    items.push({ label, state: cur === undefined ? "MISSING" : JSON.stringify(cur) === JSON.stringify(x.want) ? "ok" : "DRIFT", apply() { const s = readSettings(); x.set(s); saveSettings(s); } });
  }

  // User-scope MCP entry in the global config file, where plugin-index.mjs (the repo's own reader) looks: inside
  // CLAUDE_CONFIG_DIR when one lives there, else <home>/.claude.json (round-3 reader).
  const claudeJson = globalConfigFile(home);
  const graph = JSON.parse(readFileSync(join(REPO, "config", "agent-os", "local-services.json"), "utf8")).servers.find((s) => s.kind === "graphify");
  const wantMcp = { type: "http", url: `http://127.0.0.1:${graph.port}${graph.path}` };
  let cj = null;
  let cjErr = null;
  try {
    cj = existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, "utf8")) : {};
  } catch {
    cjErr = ".claude.json is not valid JSON: fix it by hand first";
  }
  for (const [name, want] of Object.entries({ graphify: wantMcp, ...layer.mcpServers })) {
    const mcpLabel = `~/.claude.json mcpServers ${name}`;
    const have = cj?.mcpServers?.[name];
    const mcpState = cjErr ? "DRIFT" : !have ? "MISSING" : have.type === want.type && have.url === want.url ? "ok" : "DRIFT";
    items.push({ label: cjErr ? `${mcpLabel} (${cjErr})` : mcpLabel, state: mcpState, apply() {
      if (cjErr) throw new Error(cjErr);
      const s = existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, "utf8")) : {};
      s.mcpServers = { ...(s.mcpServers ?? {}), [name]: want };
      backup(claudeJson);
      mkdirSync(dirname(claudeJson), { recursive: true });
      // Atomic: the harness rewrites this 160 KB file itself while sessions run; a truncating write would race it.
      const tmp = `${claudeJson}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`);
      renameSync(tmp, claudeJson);
    } });
  }

  // Global CLAUDE.md pointer block.
  const mdFile = join(claude, "CLAUDE.md");
  const md = read(mdFile)?.toString("utf8") ?? null;
  const at = md?.indexOf(BEGIN) ?? -1;
  const endAt = at >= 0 ? md.indexOf(END, at) : -1;
  // A rule the machine already carries outside the markers stays out of the block: bootstrap never edits that text.
  const outside = new Set(((at >= 0 && endAt >= 0 ? md.slice(0, at) + md.slice(endAt + END.length) : md) ?? "").split(/\r?\n/));
  const blockBody = readFileSync(join(REPO, "config", "agent-os", "global-claude-md-block.md"), "utf8").split(/^(?=## )/m)
    .filter((section) => !outside.has(section.split(/\r?\n/)[0])).join("").replace(/^@RTK\.md\r?\n?/m, (line) => (has("rtk") && !outside.has("@RTK.md") ? line : ""));
  const block = `${BEGIN}\n${blockBody.trim()}\n${END}`;
  linkRefused(mdFile, "~/.claude/CLAUDE.md");
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

/** Required plugins this account or machine has not enabled, plus the plugin sources that could not be READ at all
 * (`readErrors`; a read that worked and found a gap is a plain warning, and its gap stays MISSING). */
export function missingPlugins(home, routing) {
  const { plugins, readErrors } = enabledPlugins(home, resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  const have = new Set(plugins.map((p) => p.name));
  return { missing: (routing.required ?? []).filter((p) => !have.has(p.name)), warnings: readErrors };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--home");
  const explicitHome = i >= 0 && argv[i + 1];
  // An explicit --home wins over an inherited CLAUDE_CONFIG_DIR (reads and writes), so a test run cannot touch the real profile.
  if (explicitHome) delete process.env.CLAUDE_CONFIG_DIR;
  const home = explicitHome ? resolve(argv[i + 1]) : process.env.USERPROFILE || process.env.HOME || homedir();
  const check = argv.includes("--check");
  const items = plan(home);
  const bad = items.filter((x) => x.state !== "ok" && x.state !== "n/a");

  if (argv.includes("--hook")) {
    const routing = readRouting(REPO);
    const { missing, warnings } = missingPlugins(home, routing);
    // A plugin not found while a plugin source could not be read is UNKNOWN: never MISSING, never a FIX FIRST to enable
    // what may already be enabled (a Desktop manifest.json caught mid-rewrite, manager round 1, 2026-11-04).
    const unknown = missing.length > 0 && warnings.length > 0;
    const parts = [bad.length ? `bootstrap: ${bad.length} item(s) ${bad.map((x) => `${x.state} ${x.label.replace("~/.claude/", "")}`).join(", ")}` : "bootstrap ok"];
    parts.push(unknown ? `plugins UNKNOWN (${warnings.join("; ")})` : missing.length ? `plugins MISSING: ${missing.map((p) => p.name).join(", ")}` : `plugins ok (${(routing.required ?? []).length} required)`);
    const known = routing.knownConnectFailures?.servers?.length;
    if (known) parts.push(`known MCP connect failures: ${known} (as of ${routing.knownConnectFailures.asOf}, config/agent-os/required-plugins.json; not retried here)`);
    const fixes = [...(bad.length ? [`node "${fwd(join(REPO, "scripts", "agent-os", "bootstrap-machine.mjs"))}"`] : []), ...(unknown ? [] : missing.map((p) => `Nour: ${p.enable}`))];
    const ok = !fixes.length && !unknown;
    process.stdout.write(`[health] machine ${ok ? "ok | " : ""}${parts.join(" | ")}${fixes.length ? ` | FIX FIRST: ${fixes.map((f, n) => `(${n + 1}) ${f}`).join(" ")}` : ""}\n`);
    return 0;
  }
  if (check) {
    for (const x of items) process.stdout.write(`[bootstrap] ${x.state.padEnd(7)} ${x.label}\n`);
    process.stdout.write(`[bootstrap] ${bad.length ? `${bad.length} item(s) to fix: run without --check` : "clean"}\n`);
    return bad.length ? 1 : 0;
  }
  const refused = items.filter((x) => x.state === "REFUSE");
  if (refused.length) {
    for (const x of refused) process.stdout.write(`[bootstrap] REFUSE    ${x.label}\n`);
    process.stdout.write("[bootstrap] refused: nothing written. Fix the source file in the repo, then run again.\n");
    return 1;
  }
  for (const x of items) {
    if (x.state === "ok" || x.state === "n/a") { process.stdout.write(`[bootstrap] ${x.state.padEnd(9)} ${x.label}\n`); continue; }
    if (x.manual) { process.stdout.write(`[bootstrap] MISSING   ${x.label}\n`); continue; }
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
