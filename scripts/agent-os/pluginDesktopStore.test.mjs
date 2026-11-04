// Canary for plugin-index.mjs's third source (job 2026-11-03-platform-housekeeping): Claude Desktop delivers this
// account's claude.ai plugins to its OWN app data, not to ~/.claude/plugins/synced. Witnessed 2026-11-03 on NattyNour:
// the Skill tool's base directory for receipts-check:prove-fix was
//   %LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude\rpm\<accountUuid[0:8]>\<organizationUuid[0:8]>\plugin_<id>\
// listed in manifest.json beside it, while both synced buckets held no folder for agentic-council or receipts-check, so the
// [health] machine line printed a FALSE "plugins MISSING: agentic-council, receipts-check" and a FIX FIRST to enable them.
// Every arm runs the REAL consumer (bootstrap-machine.mjs --check --hook) against a fixture home and reads its plugin part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "bootstrap-machine.mjs");
const REQUIRED = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "required-plugins.json"), "utf8")).required;
const ACCOUNT = { accountUuid: "cf69bd8d-0000-4000-8000-000000000001", organizationUuid: "b684dacf-0000-4000-8000-000000000002" };
const SCRATCH = mkdtempSync(join(tmpdir(), "plugin-desktop-store-"));
test.after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const pluginDir = (dir, name) => write(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name }));
const synced = REQUIRED.filter((p) => p.source !== "installed");

/** A home with the machine-installed required plugins enabled and the account named; the account plugins are up to `layout`. */
function makeHome(label, layout) {
  const home = join(SCRATCH, label);
  const installed = { version: 2, plugins: {} };
  const enabledPlugins = {};
  for (const p of REQUIRED.filter((x) => x.source === "installed")) {
    const dir = join(home, ".claude", "plugins", "cache", "m", p.name, "1.0.0");
    pluginDir(dir, p.name);
    installed.plugins[p.key] = [{ scope: "user", installPath: dir }];
    enabledPlugins[p.key] = true;
  }
  write(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify(installed));
  write(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins }));
  write(join(home, ".claude.json"), JSON.stringify({ oauthAccount: ACCOUNT }));
  layout?.(home);
  return home;
}

/** Claude Desktop's store: <appData>/rpm/<acct8>/<org8>/manifest.json + plugin_<id>/ dirs. */
function desktopStore(appData, account, plugins, { listed = plugins, withDirs = plugins } = {}) {
  const bucket = join(appData, "rpm", account.accountUuid.slice(0, 8), account.organizationUuid.slice(0, 8));
  const id = (name) => `plugin_01${Buffer.from(name).toString("hex").slice(0, 20)}`;
  write(join(bucket, "manifest.json"), JSON.stringify({ lastUpdated: 1793746477222, plugins: listed.map((p) => ({ id: id(p.name), displayName: p.name, installedBy: "user", installationPreference: "available" })) }));
  for (const p of withDirs) pluginDir(join(bucket, id(p.name)), p.name);
}
const msix = (home) => join(home, "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
const plainInstall = (home) => join(home, "AppData", "Roaming", "Claude");

function pluginPart(home) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), CLAUDE_PROJECT_DIR: ROOT, HOME: home, USERPROFILE: home };
  const r = spawnSync(process.execPath, [SCRIPT, "--home", home, "--check", "--hook"], { encoding: "utf8", cwd: ROOT, env, timeout: 30000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { line: /plugins (ok \(\d+ required\)|MISSING: [^|]+|UNKNOWN \([^|]+\))/.exec(out)?.[0]?.trim() ?? `(no plugin part) ${out}`, out };
}
const MISSING_SYNCED = `plugins MISSING: ${synced.map((p) => p.name).join(", ")}`;

test("the required set still has account (non-installed) plugins, or this canary tests nothing", () => {
  assert.ok(synced.length >= 2, JSON.stringify(REQUIRED));
});

test("new layout (MSIX Desktop): the account plugins in the rpm store read ok", () => {
  const r = pluginPart(makeHome("msix", (h) => desktopStore(msix(h), ACCOUNT, synced)));
  assert.equal(r.line, `plugins ok (${REQUIRED.length} required)`, r.out);
});

test("new layout (plain Desktop install, %APPDATA%\\Claude): reads ok", () => {
  const r = pluginPart(makeHome("plain", (h) => desktopStore(plainInstall(h), ACCOUNT, synced)));
  assert.equal(r.line, `plugins ok (${REQUIRED.length} required)`, r.out);
});

test("old layout (~/.claude/plugins/synced/<org>_<acct>/<dir>/.in_use) still reads ok", () => {
  const r = pluginPart(makeHome("old", (h) => {
    for (const p of synced) {
      const dir = join(h, ".claude", "plugins", "synced", `${ACCOUNT.organizationUuid}_${ACCOUNT.accountUuid}`, `${p.name}~g2`);
      pluginDir(dir, p.name);
      write(join(dir, ".in_use"), "");
    }
  }));
  assert.equal(r.line, `plugins ok (${REQUIRED.length} required)`, r.out);
});

test("neither layout: the account plugins read MISSING", () => {
  assert.equal(pluginPart(makeHome("neither")).line, MISSING_SYNCED);
});

test("another account's rpm bucket is not this account's plugins: MISSING", () => {
  const other = { accountUuid: "f6e38864-0000-4000-8000-000000000003", organizationUuid: "db3cbe41-0000-4000-8000-000000000004" };
  assert.equal(pluginPart(makeHome("other-account", (h) => desktopStore(msix(h), other, synced))).line, MISSING_SYNCED);
});

// Manager round 1 (P2): bootstrap-machine dropped enabledPlugins' warnings, so a manifest caught mid-rewrite brought back
// the exact false "plugins MISSING ... FIX FIRST" this job removed. A failed read is UNKNOWN, and Nour is sent nowhere.
test("an unreadable Desktop manifest (caught mid-rewrite) reads plugins UNKNOWN, never MISSING, and asks Nour to enable nothing", () => {
  const r = pluginPart(makeHome("torn-manifest", (h) => {
    write(join(msix(h), "rpm", ACCOUNT.accountUuid.slice(0, 8), ACCOUNT.organizationUuid.slice(0, 8), "manifest.json"), "{");
  }));
  assert.match(r.line, /^plugins UNKNOWN \(.*manifest\.json: bad JSON.*\)$/, r.out);
  for (const p of synced) assert.ok(!r.out.includes(p.enable), `told Nour to enable ${p.name} on a failed read:\n${r.out}`);
});

test("a manifest entry whose folder is gone, and a folder the manifest does not list, both read MISSING", () => {
  const [a, b, ...rest] = synced;
  const r = pluginPart(makeHome("partial", (h) => desktopStore(msix(h), ACCOUNT, synced, { listed: [b, ...rest], withDirs: [a, ...rest] })));
  assert.equal(r.line, `plugins MISSING: ${[a, b].map((p) => p.name).join(", ")}`, r.out);
});
