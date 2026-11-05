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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
const storeId = (name) => `plugin_01${Buffer.from(name).toString("hex").slice(0, 20)}`;
function desktopStore(appData, account, plugins, { listed = plugins, withDirs = plugins } = {}) {
  const bucket = join(appData, "rpm", account.accountUuid.slice(0, 8), account.organizationUuid.slice(0, 8));
  write(join(bucket, "manifest.json"), JSON.stringify({ lastUpdated: 1793746477222, plugins: listed.map((p) => ({ id: storeId(p.name), displayName: p.name, installedBy: "user", installationPreference: "available" })) }));
  for (const p of withDirs) pluginDir(join(bucket, storeId(p.name)), p.name);
}
const msix = (home) => join(home, "AppData", "Local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
const plainInstall = (home) => join(home, "AppData", "Roaming", "Claude");
const packageStore = (home, pkg) => join(home, "AppData", "Local", "Packages", pkg, "LocalCache", "Roaming", "Claude");
// The Microsoft Store build (witnessed 2026-11-05, shop PC MECHANICS, home "C:\Users\Nick's Tire"): the package folder is
// <publisher>.Claude_<hash> and holds NO rpm/; the store sits in %LOCALAPPDATA%\Claude-Data\<identity>\rpm\ instead, one
// identity dir per installed build (lowercase package-family name).
const STORE_PKG = "AnthropicPBC.Claude_fnn82j28hfe8t";
const claudeData = (home, identity) => join(home, "AppData", "Local", "Claude-Data", identity);
const CURRENT_ID = "anthropicpbc.claude_fnn82j28hfe8t";
const OLDER_ID = "claude_pzs8sxrjxfjjc";
const ago = (file, ms) => { const t = new Date(Date.now() - ms); utimesSync(file, t, t); };
const manifestIn = (appData, account) => join(appData, "rpm", account.accountUuid.slice(0, 8), account.organizationUuid.slice(0, 8), "manifest.json");

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

// Codex on PR 3543 (P2): every Claude_* package dir was unioned, first dir per name winning, so a stale package left by an
// MSIX upgrade could satisfy a required plugin Desktop no longer loads. One store counts: the newest manifest.json.
test("two Desktop packages: only the newest manifest counts, a plugin only the stale one lists reads MISSING, and a warning names the stale dir", async () => {
  const [gone, ...kept] = synced;
  const home = makeHome("two-packages", (h) => {
    const pkg = (name) => join(h, "AppData", "Local", "Packages", name, "LocalCache", "Roaming", "Claude");
    desktopStore(pkg("Claude_0ldpackage"), ACCOUNT, synced); // the stale package still lists every plugin
    const old = new Date(Date.now() - 7 * 24 * 3600_000);
    const oldManifest = join(pkg("Claude_0ldpackage"), "rpm", ACCOUNT.accountUuid.slice(0, 8), ACCOUNT.organizationUuid.slice(0, 8), "manifest.json");
    utimesSync(oldManifest, old, old);
    desktopStore(pkg("Claude_newpackage"), ACCOUNT, kept);
  });
  assert.equal(pluginPart(home).line, `plugins MISSING: ${gone.name}`);
  const { enabledPlugins } = await import("./plugin-index.mjs");
  const prev = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const { warnings, readErrors } = enabledPlugins(home);
    assert.ok(warnings.some((w) => w.includes("Claude_0ldpackage")), `no warning names the stale package: ${JSON.stringify(warnings)}`);
    assert.ok(!readErrors.some((w) => w.includes("Claude_0ldpackage")), "a stale package is not a failed read");
  } finally {
    if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test("a manifest entry whose folder is gone, and a folder the manifest does not list, both read MISSING", () => {
  const [a, b, ...rest] = synced;
  const r = pluginPart(makeHome("partial", (h) => desktopStore(msix(h), ACCOUNT, synced, { listed: [b, ...rest], withDirs: [a, ...rest] })));
  assert.equal(r.line, `plugins MISSING: ${[a, b].map((p) => p.name).join(", ")}`, r.out);
});

// Job 2026-11-02-nour-os-interconnect W10b. MECHANICS printed a false "plugins MISSING: agentic-council, receipts-check,
// desktop-commander" + FIX FIRST on every session: the reader knew only Packages\Claude_<hash>\...\rpm, and the Store
// build keeps its store in Claude-Data\<identity>\rpm (path facts from the MECHANICS session, 2026-11-05).
test("Store build, package folder <publisher>.Claude_<hash> holding the rpm store: reads ok", () => {
  const r = pluginPart(makeHome("store-package", (h) => desktopStore(packageStore(h, STORE_PKG), ACCOUNT, synced)));
  assert.equal(r.line, `plugins ok (${REQUIRED.length} required)`, r.out);
});

test("Store build, store in Claude-Data\\<identity>\\rpm beside an rpm-less package folder, home \"Nick's Tire\": reads ok", () => {
  const r = pluginPart(makeHome("claude-data/Nick's Tire", (h) => {
    mkdirSync(packageStore(h, STORE_PKG), { recursive: true }); // the real package folder: present, no rpm/ inside
    desktopStore(claudeData(h, CURRENT_ID), ACCOUNT, synced);
  }));
  assert.equal(r.line, `plugins ok (${REQUIRED.length} required)`, r.out);
});

test("control: home \"Nick's Tire\" with the plain Claude_<hash> package reads ok (the apostrophe and space are not the cause)", () => {
  const r = pluginPart(makeHome("plain-package/Nick's Tire", (h) => desktopStore(msix(h), ACCOUNT, synced)));
  assert.equal(r.line, `plugins ok (${REQUIRED.length} required)`, r.out);
});

// The gate's positive control: a plugin truly absent from the store the reader now finds must still read MISSING.
test("Claude-Data store whose manifest does not list one required plugin: that plugin reads MISSING, the rest ok", () => {
  const [gone, ...kept] = synced;
  const r = pluginPart(makeHome("claude-data-gap", (h) => desktopStore(claudeData(h, CURRENT_ID), ACCOUNT, kept, { withDirs: synced })));
  assert.equal(r.line, `plugins MISSING: ${gone.name}`, r.out);
});

// Two builds installed side by side: the newest manifest counts, whichever identity sorts first in the folder listing.
for (const [label, winner, stale] of [["stale identity sorts after", CURRENT_ID, OLDER_ID], ["stale identity sorts before", OLDER_ID, CURRENT_ID]]) {
  test(`two Claude-Data identities (${label}): only the newest manifest counts, a plugin only the stale one lists reads MISSING`, () => {
    const [gone, ...kept] = synced;
    const home = makeHome(`claude-data-two-${winner}`, (h) => {
      desktopStore(claudeData(h, stale), ACCOUNT, synced);
      ago(manifestIn(claudeData(h, stale), ACCOUNT), 7 * 24 * 3600_000);
      desktopStore(claudeData(h, winner), ACCOUNT, kept);
    });
    assert.equal(pluginPart(home).line, `plugins MISSING: ${gone.name}`);
  });
}

// Only rpm/<acct8>/<org8>/manifest.json of THIS account, listing the plugin, counts. Each decoy below is fully populated
// (a complete manifest or the plugin's own folder, newer than the real manifest), so a reader that looked wider would find
// the plugin the real manifest leaves out and print ok. One decoy per arm, so a failure names the guilty widening.
const claudeDataGap = (label, decoy) => {
  const [gone, ...kept] = synced;
  const home = makeHome(`claude-data-decoy-${label}/Nick's Tire`, (h) => {
    const store = claudeData(h, CURRENT_ID);
    desktopStore(store, ACCOUNT, kept);
    ago(manifestIn(store, ACCOUNT), 3600_000);
    decoy(store, gone);
  });
  assert.equal(pluginPart(home).line, `plugins MISSING: ${gone.name}`);
};
const bucketOf = (store, account) => join(store, "rpm", account.accountUuid.slice(0, 8), account.organizationUuid.slice(0, 8));

test("Claude-Data: another account's bucket, listed newer and complete, is not this account's plugins", () => {
  const other = { accountUuid: "f6e38864-0000-4000-8000-000000000003", organizationUuid: "db3cbe41-0000-4000-8000-000000000004" };
  claudeDataGap("other-account", (store) => desktopStore(store, other, synced));
});

test("Claude-Data: a .publish-manifest.json and a plugin folder the real manifest does not list are never read", () => {
  claudeDataGap("publish-manifest", (store, gone) => {
    write(join(bucketOf(store, ACCOUNT), ".publish-manifest.json"), JSON.stringify({ plugins: synced.map((p) => ({ id: storeId(p.name) })) }));
    pluginDir(join(bucketOf(store, ACCOUNT), storeId(gone.name)), gone.name);
  });
});

test("Claude-Data: a local-agent-mode-sessions\\skills-plugin manifest is never read", () => {
  claudeDataGap("skills-plugin", (store) => {
    const skills = join(store, "local-agent-mode-sessions", "skills-plugin", ACCOUNT.accountUuid.slice(0, 8), ACCOUNT.organizationUuid.slice(0, 8));
    write(join(skills, "manifest.json"), JSON.stringify({ plugins: synced.map((p) => ({ id: storeId(p.name) })) }));
    for (const p of synced) pluginDir(join(skills, storeId(p.name)), p.name);
  });
});

// Mention vs execution, in folder names: only <publisher>.Claude_<hash> / Claude_<hash> is a Desktop build.
for (const name of ["NotClaude_x", "Claude-Data", "claude_", "AnthropicPBC.NotClaude_x"]) {
  test(`look-alike folder "${name}" under Packages and under Claude-Data is not a Desktop store: MISSING`, () => {
    const home = makeHome(`lookalike-${name}`, (h) => {
      desktopStore(packageStore(h, name), ACCOUNT, synced);
      desktopStore(claudeData(h, name), ACCOUNT, synced);
    });
    assert.equal(pluginPart(home).line, MISSING_SYNCED);
  });
}
