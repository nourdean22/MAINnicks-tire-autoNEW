import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function referencedDockerfile(root) {
  const configPath = join(root, ".devcontainer", "devcontainer.json");
  const config = JSON.parse(requireText(configPath));
  if (!config.build?.dockerfile) return null;
  return resolve(dirname(configPath), config.build.dockerfile);
}

function requireText(path) {
  return readFileSync(path, "utf8");
}

test("devcontainer build references a Dockerfile that exists", () => {
  const dockerfile = referencedDockerfile(repoRoot);
  assert.ok(dockerfile, "devcontainer.json must declare build.dockerfile");
  assert.ok(existsSync(dockerfile), `referenced Dockerfile is missing: ${dockerfile}`);
});

test("CANARY: a missing referenced Dockerfile is detected", (t) => {
  const root = mkdtempSync(join(tmpdir(), "devcontainer-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, ".devcontainer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "devcontainer.json"),
    JSON.stringify({ build: { dockerfile: "missing.Dockerfile" } }),
  );
  const dockerfile = referencedDockerfile(root);
  assert.equal(existsSync(dockerfile), false);
});

test("devcontainer Dockerfile pins the primary developer toolchain", () => {
  const dockerfile = referencedDockerfile(repoRoot);
  const text = readFileSync(dockerfile, "utf8");
  assert.match(text, /javascript-node:24-bookworm/);
  assert.match(text, /opencode-ai@1\.18\.27/);
  assert.match(text, /@ast-grep\/cli@0\.45\.2/);
  assert.match(text, /ripgrep/);
});
