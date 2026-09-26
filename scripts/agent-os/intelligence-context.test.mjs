import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const kernelPath = join(ROOT, "docs", "agent-os", "NOUR-RUNTIME-KERNEL.md");
const kernel = readFileSync(kernelPath, "utf8");
const commandDoc = readFileSync(join(ROOT, "NOUR-COMMAND.md"), "utf8");

function configuredHook() {
  return (settings.hooks?.SessionStart ?? [])
    .flatMap((g) => g.hooks ?? [])
    .find((h) => h.type === "command" && h.command.includes("intelligence-context.mjs"));
}

test("canonical NOUR-COMMAND includes Universal Operator default", () => {
  assert.match(commandDoc, /^## Universal operator default$/m);
});
test("runtime kernel is compact and carries the required intelligence anchors", () => {
  assert.ok(Buffer.byteLength(kernel, "utf8") < 9000, "runtime kernel exceeded 9 KB context budget");
  for (const anchor of [
    "Ground truth first",
    "State and confidence",
    "Reuse and leverage",
    "Execute and falsify",
    "Completion contract",
  ]) assert.match(kernel, new RegExp(anchor));
});

test("SessionStart registers the intelligence hook with a cross-platform path", () => {
  const hook = configuredHook();
  assert.ok(hook, "intelligence-context.mjs is not registered on SessionStart");
  assert.doesNotMatch(hook.command, /\\scripts\\agent-os/, "node hook path must use forward slashes");
  assert.equal(hook.timeout, 10);
});
test("configured intelligence hook launches and emits an activation receipt", () => {
  const hook = configuredHook();
  const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  const command = process.platform === "win32"
    ? hook.command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT)
    : hook.command;
  const r = spawnSync(command, {
    shell: process.platform === "win32" ? true : "/bin/sh",
    cwd: ROOT, env, encoding: "utf8", timeout: 15000,
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\[nour-intelligence\] ACTIVE/);
  assert.match(r.stdout, /origin\/main\(local-ref\)=/);
  assert.match(r.stdout, /NOUR-RUNTIME-KERNEL\.md/);
});