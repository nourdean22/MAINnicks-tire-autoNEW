/**
 * Shared root config must reach the gates that read it (2026-09-29).
 *
 * config/retired-claude-models.json is read by BOTH apps' retired-model gates
 * (apps/nickstire/server/retiredClaudeModelGate.test.ts and
 * apps/statenour/tests/repo/retired-claude-models-gate.test.ts). A PR that edited
 * ONLY that list reached neither: test.yml's path filters skipped the `node` job,
 * and even when it ran, `turbo --affected` selected only the root package
 * (measured on a synced branch: packages ['//'], 0 test tasks). A newly retired id
 * still used in code would then surface as a red main on the NEXT, unrelated PR.
 *
 * Rule: every FILE directly under config/ (the agent-os and adoption-gates
 * subdirectories have their own always-on workflows) is a turbo global dependency
 * and matches the nickstire, statenour and node filters in test.yml.
 * Lives here because agent-policy.yml runs this directory on every PR.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REQUIRED_FILTERS = ["nickstire", "statenour", "node"];

/** The filters: | block of test.yml as { name: globs[] }. */
export function parseFilters(yml) {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => /^\s*filters:\s*\|\s*$/.test(l));
  if (start < 0) return {};
  const filters = {};
  let blockIndent = null;
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (blockIndent === null) blockIndent = indent;
    if (indent < blockIndent) break;
    const name = line.match(/^\s*([A-Za-z0-9_-]+):\s*$/);
    if (name && indent === blockIndent) {
      current = name[1];
      filters[current] = [];
      continue;
    }
    const glob = line.match(/^\s*-\s*'([^']+)'\s*$/);
    if (glob && current) filters[current].push(glob[1]);
  }
  return filters;
}

/** paths-filter glob semantics for the shapes this repo uses: ** spans dirs, * does not. */
export function globMatches(glob, path) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`).test(path);
}

/** Every way the shared config files fail to reach their gates. */
export function findUnreached({ configFiles, globalDependencies, filters }) {
  const problems = [];
  for (const file of configFiles) {
    if (!globalDependencies.includes(file)) problems.push(`${file}: not in turbo.json globalDependencies`);
    for (const name of REQUIRED_FILTERS) {
      if (!(filters[name] ?? []).some((g) => globMatches(g, file))) problems.push(`${file}: not matched by test.yml filter '${name}'`);
    }
  }
  return problems;
}

function liveInputs() {
  const configFiles = readdirSync(join(REPO_ROOT, "config"))
    .filter((f) => statSync(join(REPO_ROOT, "config", f)).isFile())
    .map((f) => `config/${f}`);
  const turbo = JSON.parse(readFileSync(join(REPO_ROOT, "turbo.json"), "utf8"));
  const filters = parseFilters(readFileSync(join(REPO_ROOT, ".github", "workflows", "test.yml"), "utf8"));
  return { configFiles, globalDependencies: turbo.globalDependencies ?? [], filters };
}

test("the live repo: every top-level config/ file reaches both apps' CI and turbo --affected", () => {
  const inputs = liveInputs();
  assert.ok(inputs.configFiles.includes("config/retired-claude-models.json"), "the file this rule was written for is still here");
  for (const name of REQUIRED_FILTERS) assert.ok(inputs.filters[name]?.length, `test.yml filter '${name}' parsed with globs`);
  assert.deepEqual(findUnreached(inputs), []);
});

test("positive control: a planted top-level config file that reaches nothing is reported, once per missing link", () => {
  const problems = findUnreached({
    configFiles: ["config/planted.json"],
    globalDependencies: ["pnpm-lock.yaml"],
    filters: { nickstire: ["apps/nickstire/**"], statenour: ["apps/statenour/**"], node: ["apps/**"] },
  });
  assert.equal(problems.length, 4);
  assert.match(problems[0], /globalDependencies/);
});

test("the glob matcher keeps paths-filter semantics", () => {
  assert.ok(globMatches("apps/nickstire/**", "apps/nickstire/server/sms.ts"));
  assert.ok(!globMatches("apps/nickstire/**", "apps/statenour/lib/x.ts"));
  assert.ok(globMatches("apps/*/DEPLOY.md", "apps/worker/DEPLOY.md"));
  assert.ok(!globMatches("apps/*/DEPLOY.md", "apps/worker/docs/DEPLOY.md"));
  assert.ok(globMatches("config/retired-claude-models.json", "config/retired-claude-models.json"));
});
