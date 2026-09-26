import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SOURCE_IGNORE = readFileSync(join(ROOT, ".gitignore"), "utf8");

const SECRET_PATHS = [
  "apps/statenour/local-agent/eufy-ws-config.json",
  "apps/statenour/local-agent/eufy-ws-config.local.json",
  "apps/statenour/local-agent/eufy-data/token.json",
];
const EXAMPLE_PATH = "apps/statenour/local-agent/eufy-ws-config.example.json";
const GUARD_LINES = new Set([
  "apps/statenour/local-agent/eufy-ws-config.json",
  "apps/statenour/local-agent/eufy-ws-config.local.json",
  "apps/statenour/local-agent/eufy-data/",
]);

function runGit(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function writeFixture(root, relativePath) {
  const full = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, "{}\n", "utf8");
}

function makeRepo(ignoreText) {
  const root = mkdtempSync(join(tmpdir(), "eufy-ignore-canary-"));
  const init = runGit(root, ["init", "-q"]);
  assert.equal(init.status, 0, init.stderr || "git init failed");
  writeFileSync(join(root, ".gitignore"), ignoreText, "utf8");
  for (const path of [...SECRET_PATHS, EXAMPLE_PATH]) writeFixture(root, path);
  return root;
}

function isIgnored(root, relativePath) {
  return runGit(root, ["check-ignore", "-q", "--no-index", "--", relativePath]).status === 0;
}

function assertGuardBehavior(root) {
  for (const path of SECRET_PATHS) {
    assert.equal(isIgnored(root, path), true, `${path} must be ignored`);
  }
  assert.equal(
    isIgnored(root, EXAMPLE_PATH),
    false,
    `${EXAMPLE_PATH} must stay trackable`,
  );
}

test("Eufy credential/session paths are ignored while the example remains trackable", () => {
  const root = makeRepo(SOURCE_IGNORE);
  try {
    assertGuardBehavior(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CANARY: removing the Eufy guard makes the behavioral assertion fail", () => {
  const mutated = SOURCE_IGNORE
    .split(/\r?\n/)
    .filter((line) => !GUARD_LINES.has(line.trim()))
    .join("\n");

  const root = makeRepo(mutated);
  try {
    assert.throws(
      () => assertGuardBehavior(root),
      /must be ignored/,
      "mutation must turn the guard red",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
