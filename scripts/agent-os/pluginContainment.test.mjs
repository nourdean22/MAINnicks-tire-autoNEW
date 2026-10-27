// Canary for plugin-index.mjs: a plugin.json `skills` entry may not lead outside the plugin directory (bug hunt 2026-10-27).
// The guard was `dir.startsWith(resolve(p.dir))`, a string-prefix test: a sibling directory whose name starts with the
// plugin's own name (<cache>/p-other next to <cache>/p) passed it, so one plugin could index another plugin's, or any
// neighbouring folder's, SKILL.md files under its own name. Fixture home only; CLAUDE_CONFIG_DIR is pinned to it so the
// real ~/.claude is never read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRATCH = mkdtempSync(join(tmpdir(), "plugin-contain-test-"));
const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const skill = (dir, slug) => write(join(dir, slug, "SKILL.md"), `---\nname: ${slug}\ndescription: "fixture ${slug}"\n---\n`);

const home = join(SCRATCH, "home");
const claude = join(home, ".claude");
process.env.CLAUDE_CONFIG_DIR = claude;
const cache = join(claude, "plugins", "cache");
const plugin = join(cache, "p");
const sibling = join(cache, "p-other"); // shares the plugin dir's name as a string prefix, but is not inside it

write(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "p", skills: ["./skills", "../p-other/skills", "../../outside"] }));
skill(join(plugin, "skills"), "inside");
skill(join(sibling, "skills"), "sibling-skill");
write(join(claude, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "p@m": [{ scope: "user", installPath: plugin }] } }));
write(join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "p@m": true } }));

const { pluginSkillFiles } = await import("./plugin-index.mjs");
const names = pluginSkillFiles(home, {}, undefined).files.map((f) => f.name);

test("positive control: the plugin's own skill is indexed (the scanner located its subject)", () => {
  assert.ok(names.includes("p:inside"), `names: ${names.join(", ")}`);
});

test("a declared skills dir that is a string-prefix sibling of the plugin dir is not followed", () => {
  assert.ok(!names.includes("p:sibling-skill"), `sibling indexed under the plugin: ${names.join(", ")}`);
});
