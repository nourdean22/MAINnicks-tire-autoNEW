/** Canary for plugin-prune.mjs: verdicts per key, and --apply / --restore against a fixture home (never the real one). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, planPrune } from "./plugin-prune.mjs";

const policy = {
  required: [{ name: "desktop-commander" }],
  reject: { zoominfo: "wrong business", "desktop-commander": "never wins over required" },
  knownConnectFailures: { servers: ["plugin:telegram:telegram", "plugin:desktop-commander:desktop-commander"] },
};
const settings = () => ({
  model: "opus",
  enabledPlugins: {
    "zoominfo@claude-plugins-official": true, // rejected
    "telegram@claude-plugins-official": true, // dead server only: a failing server is not a reason by itself (prisma)
    "desktop-commander@claude-plugins-official": true, // required: kept even though rejected and dead
    "constructor@x": true, // an Object.prototype name must not read as rejected
    "langfuse@claude-plugins-official": true, // in use: kept
    "hunter@claude-plugins-official": false, // already off: untouched
  },
});

test("plan: only rejected plugins turn off; required, dead-server-only, unlisted and already-off ones do not", () => {
  assert.deepEqual(planPrune(settings(), policy).map((p) => p.key), ["zoominfo@claude-plugins-official"]);
});

test("the real policy file parses and names at least one plugin to reject (the scan locates its subject)", () => {
  const real = JSON.parse(readFileSync(new URL("../../config/agent-os/required-plugins.json", import.meta.url), "utf8"));
  const all = Object.fromEntries(Object.keys(real.reject).map((n) => [`${n}@x`, true]));
  assert.ok(planPrune({ enabledPlugins: all }, real).length >= 30);
});

test("--apply backs up, sets keys false (not deleted), keeps other settings; --restore undoes it", () => {
  const home = mkdtempSync(join(tmpdir(), "plugin-prune-home-"));
  const root = mkdtempSync(join(tmpdir(), "plugin-prune-root-"));
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(root, "config", "agent-os"), { recursive: true });
  writeFileSync(join(root, "config", "agent-os", "required-plugins.json"), JSON.stringify(policy));
  const file = join(home, ".claude", "settings.json");
  const before = JSON.stringify(settings(), null, 2);
  writeFileSync(file, before);

  assert.match(main([], { home, root }), /plan: 1 plugin/);
  assert.equal(readFileSync(file, "utf8"), before, "plan mode must not write");

  const out = main(["--apply"], { home, root, now: new Date("2026-11-01T00:00:00Z") });
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.enabledPlugins["zoominfo@claude-plugins-official"], false);
  assert.equal(after.enabledPlugins["telegram@claude-plugins-official"], true);
  assert.equal(after.enabledPlugins["desktop-commander@claude-plugins-official"], true);
  assert.equal(after.model, "opus");
  assert.equal(Object.keys(after.enabledPlugins).length, 6, "keys are set false, never deleted");

  const backup = out.match(/backup (\S+)/)[1];
  main(["--restore", backup], { home, root });
  assert.equal(readFileSync(file, "utf8"), before);
});
