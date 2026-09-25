import test from "node:test";
import assert from "node:assert/strict";
import { GIT_LOCAL_ENV_KEYS, prepareAgentChildEnv, stripGitLocalEnv } from "./gitLocalEnv.mjs";

test("stripGitLocalEnv removes every repository-local Git variable and preserves unrelated env", () => {
  const planted = { KEEP_ME: "yes", HTTPS_PROXY: "http://proxy.invalid" };
  for (const key of GIT_LOCAL_ENV_KEYS) planted[key] = "poison";
  const clean = stripGitLocalEnv(planted);
  for (const key of GIT_LOCAL_ENV_KEYS) {
    assert.equal(key in clean, false, `${key} leaked into a child process`);
  }
  assert.equal(clean.KEEP_ME, "yes");
  assert.equal(clean.HTTPS_PROXY, "http://proxy.invalid");
});

test("CANARY: without sanitization, a planted GIT_DIR remains visible", () => {
  const dirty = { GIT_DIR: "outer-repo", KEEP_ME: "yes" };
  assert.equal(dirty.GIT_DIR, "outer-repo");
  const clean = stripGitLocalEnv(dirty);
  assert.equal(clean.GIT_DIR, undefined);
});

test("prepareAgentChildEnv prefers Git Bash on Windows without duplicating it", () => {
  const source = {
    Path: "C:\\Windows\\System32;C:\\Program Files\\Git\\bin;C:\\Other",
    GIT_DIR: "outer-repo",
  };
  const clean = prepareAgentChildEnv(source, {
    platform: "win32",
    gitBashDir: "C:\\Program Files\\Git\\bin",
    exists: () => true,
  });
  assert.equal(clean.GIT_DIR, undefined);
  assert.equal(clean.Path, "C:\\Program Files\\Git\\bin;C:\\Windows\\System32;C:\\Other");
});

test("prepareAgentChildEnv leaves PATH unchanged when Git Bash is unavailable", () => {
  const source = { PATH: "C:\\Windows\\System32", GIT_WORK_TREE: "outer" };
  const clean = prepareAgentChildEnv(source, {
    platform: "win32",
    exists: () => false,
  });
  assert.equal(clean.GIT_WORK_TREE, undefined);
  assert.equal(clean.PATH, source.PATH);
});
