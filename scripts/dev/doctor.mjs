import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isWindows = process.platform === "win32";

function run(command, args = []) {
  const out = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: isWindows,
    timeout: 15000,
  });
  return {
    ok: out.status === 0,
    text: String(out.stdout || out.stderr || "").trim().split(/\r?\n/)[0],
  };
}

function report(kind, name, detail) {
  console.log(`${kind.padEnd(4)} ${name.padEnd(18)} ${detail || ""}`);
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const requiredNode = 24;
let failed = false;

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= requiredNode) report("PASS", "node", process.version);
else {
  report("FAIL", "node", `${process.version}; need 24+`);
  failed = true;
}

for (const [name, cmd, args] of [
  ["git", "git", ["--version"]],
  ["corepack", "corepack", ["--version"]],
  ["pnpm(project)", "corepack", ["pnpm", "--version"]],
]) {
  const result = run(cmd, args);
  report(result.ok ? "PASS" : "FAIL", name, result.text || "missing");
  if (!result.ok) failed = true;
}

report("INFO", "packageManager", pkg.packageManager || "unset");
const branch = run("git", ["branch", "--show-current"]);
const origin = run("git", ["rev-parse", "origin/main"]);
report(branch.ok ? "PASS" : "WARN", "branch", branch.text);
report(origin.ok ? "PASS" : "WARN", "origin/main", origin.text);

for (const [name, cmd, args] of [
  ["gh", "gh", ["--version"]],
  ["rg", "rg", ["--version"]],
  ["ollama", "ollama", ["--version"]],
  ["docker", "docker", ["--version"]],
  ["tailscale", "tailscale", ["version"]],
]) {
  const result = run(cmd, args);
  report(result.ok ? "PASS" : "WARN", name, result.text || "not installed");
}

const openCodePath = isWindows
  ? resolve(process.env.APPDATA || "", "npm/node_modules/opencode-ai/bin/opencode.exe")
  : "opencode";
const openCode = isWindows && existsSync(openCodePath)
  ? run(openCodePath, ["--version"])
  : run("opencode", ["--version"]);
report(openCode.ok ? "PASS" : "WARN", "opencode", openCode.text || "not installed");

const goosePath = isWindows
  ? resolve(process.env.LOCALAPPDATA || "", "Programs/goose/bin/goose.exe")
  : "goose";
const goose = isWindows && existsSync(goosePath)
  ? run(goosePath, ["--version"])
  : run("goose", ["--version"]);
report(goose.ok ? "PASS" : "WARN", "goose", goose.text || "not installed");

report("INFO", "ast-grep",
  "CI pin: @ast-grep/cli@0.45.2 (adoption-gates.yml)");

for (const rel of [".env", "camera-bridge/.env.local"]) {
  const present = existsSync(resolve(root, rel));
  report(present ? "INFO" : "WARN", rel, present ? "present (contents not read)" : "absent");
}

const dirty = run("git", ["status", "--porcelain"]);
report(dirty.ok ? "INFO" : "WARN", "working-tree",
  dirty.ok && !dirty.text ? "clean" : "has changes or unavailable");

console.log(failed ? "DOCTOR_RESULT=FAIL" : "DOCTOR_RESULT=PASS");
process.exit(failed ? 1 : 0);
