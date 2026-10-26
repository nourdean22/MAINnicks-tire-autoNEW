/**
 * plugin-index: the plugins THIS account and machine have enabled, read from the files the Claude Code harness writes.
 * Shared by skill-recall.mjs (plugin skills score beside repo and user skills) and bootstrap-machine.mjs (the required-
 * plugin health check). Job 2026-10-26-always-on-hardening.
 *
 * Two sources (verified 2026-10-26 on NattyNour; the Skill tool resolved `agentic-council:advocate-a11y-audit`):
 *   installed  <home>/.claude/plugins/installed_plugins.json  { plugins: { "<name>@<marketplace>": [{ installPath }] } },
 *              counted only when <home>/.claude/settings.json enabledPlugins["<name>@<marketplace>"] === true.
 *   synced     claude.ai account plugins: <home>/.claude/plugins/synced/<organizationUuid>_<accountUuid>/<dir>, ids from
 *              <home>/.claude.json oauthAccount; a dir counts only when it holds an `.in_use` marker (older generations
 *              and other accounts' buckets sit beside it and are not loaded).
 * A plugin's name is .claude-plugin/plugin.json `name`. Its skills are skills/<slug>/SKILL.md and commands/<slug>.md
 * (a leading underscore is an internal include, not a command); the Skill tool name is `<plugin>:<slug>`.
 *
 * Empty vs error: a home with no plugin files is a real none (no warning). Bad JSON, or an enabled plugin whose install
 * dir is gone, is a warning the caller prints; the readable rest is still returned.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`${basename(file)}: ${err.code || "unreadable"}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${basename(file)}: bad JSON`);
  }
}

const pluginName = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8")).name || null;
  } catch {
    return null;
  }
};

/** Claude Code's config dir: CLAUDE_CONFIG_DIR when set, else <home>/.claude (Codex 4380254412). */
export function configDir(home) {
  return process.env.CLAUDE_CONFIG_DIR ? resolve(process.env.CLAUDE_CONFIG_DIR) : join(home, ".claude");
}

/** The global config file: inside CLAUDE_CONFIG_DIR when it holds one, else <home>/.claude.json. */
export function globalConfigFile(home) {
  const inDir = join(configDir(home), ".claude.json");
  return process.env.CLAUDE_CONFIG_DIR && existsSync(inDir) ? inDir : join(home, ".claude.json");
}

/** The effective enabledPlugins map: user settings, then the project's settings.json, then settings.local.json, each
 * overriding the last, the merge Claude Code applies (Codex 4380254379; session-surface.mjs reads the same files). */
export function effectiveEnabled(home, projectDir) {
  const layers = [join(configDir(home), "settings.json")];
  if (projectDir) layers.push(join(projectDir, ".claude", "settings.json"), join(projectDir, ".claude", "settings.local.json"));
  return Object.assign({}, ...layers.map((f) => readJson(f)?.enabledPlugins ?? {}));
}

/** Enabled plugins: [{ name, dir, source, key? }] plus warnings. First source wins on a name seen twice. */
export function enabledPlugins(home, projectDir) {
  const warnings = [];
  const out = [];
  const seen = new Set();
  const add = (p) => { if (p.name && !seen.has(p.name)) { seen.add(p.name); out.push(p); } };

  try {
    const installed = readJson(join(configDir(home), "plugins", "installed_plugins.json"));
    const enabled = effectiveEnabled(home, projectDir);
    let gone = 0;
    for (const [key, list] of Object.entries(installed?.plugins ?? {})) {
      if (enabled[key] !== true) continue;
      const dir = Array.isArray(list) ? list[0]?.installPath : null;
      if (!dir || !existsSync(dir)) { gone += 1; continue; }
      add({ name: pluginName(dir) || key.split("@")[0], dir, source: "installed", key });
    }
    if (gone) warnings.push(`${gone} enabled plugin install dir(s) missing from the cache`);
  } catch (err) {
    warnings.push(`installed plugins unreadable (${err.message})`);
  }

  try {
    const acct = readJson(globalConfigFile(home))?.oauthAccount;
    if (acct?.organizationUuid && acct?.accountUuid) {
      const bucket = join(configDir(home), "plugins", "synced", `${acct.organizationUuid}_${acct.accountUuid}`);
      const dirs = existsSync(bucket) ? readdirSync(bucket, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")) : [];
      // Newest generation first when two are marked in use (dir~g2 before dir~g1 before dir).
      const gen = (n) => Number(/~g(\d+)$/.exec(n)?.[1] ?? 1);
      for (const e of dirs.sort((a, b) => gen(b.name) - gen(a.name))) {
        const dir = join(bucket, e.name);
        if (existsSync(join(dir, ".in_use"))) add({ name: pluginName(dir), dir, source: "synced" });
      }
    }
  } catch (err) {
    warnings.push(`account plugins unreadable (${err.message})`);
  }
  return { plugins: out, warnings };
}

/** Skill and command files of the enabled plugins, minus the routing config's rejects: [{ name, path, plugin }]. */
export function pluginSkillFiles(home, routing = {}, projectDir) {
  const { plugins, warnings } = enabledPlugins(home, projectDir);
  const reject = routing.reject ?? {};
  const rejectSkills = routing.rejectSkills ?? {};
  const files = [];
  for (const p of plugins) {
    if (reject[p.name]) continue;
    const seenSlug = new Set();
    const add = (slug, path) => {
      if (seenSlug.has(slug) || rejectSkills[`${p.name}:${slug}`]) return;
      seenSlug.add(slug);
      files.push({ name: `${p.name}:${slug}`, path, plugin: p.name });
    };
    // skills/ by default, plus the dirs plugin.json `skills` declares (a string or an array, relative to the plugin
    // root): each is a container of <slug>/SKILL.md, or itself one skill dir (Codex 4380254418; planetscale ships both).
    let declared = [];
    try { declared = [].concat(JSON.parse(readFileSync(join(p.dir, ".claude-plugin", "plugin.json"), "utf8")).skills ?? []); } catch { /* no manifest: default dir only */ }
    for (const rel of ["skills", ...declared.filter((x) => typeof x === "string")]) {
      const dir = resolve(p.dir, rel);
      if (!dir.startsWith(resolve(p.dir)) || !existsSync(dir)) continue; // a path outside the plugin is not followed
      if (existsSync(join(dir, "SKILL.md"))) { add(basename(dir), join(dir, "SKILL.md")); continue; }
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md"))) add(e.name, join(dir, e.name, "SKILL.md"));
      }
    }
    const cmds = join(p.dir, "commands");
    if (existsSync(cmds)) for (const e of readdirSync(cmds, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("_")) add(e.name.slice(0, -3), join(cmds, e.name));
    }
  }
  return { files: files.sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

/** mtime signature for a cache key: the files themselves, so an update in place is seen. */
export function signature(files) {
  return files.map((f) => { try { return `${f.name}:${statSync(f.path).mtimeMs}`; } catch { return `${f.name}:gone`; } }).join("\n");
}

export function readRouting(root) {
  return readJson(join(root, "config", "agent-os", "required-plugins.json")) ?? {};
}
