import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCollisions,
  contextPointers,
  parseWorktrees,
} from "./bootstrap.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = resolve(ROOT, "scripts/agent-os/bootstrap.mjs");

test("bootstrap emits machine-readable local state without network", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--json", "--no-fetch", "--no-remote"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const report = JSON.parse(r.stdout);
  assert.equal(report.generator, "scripts/agent-os/bootstrap.mjs@1");
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(report.git.head, /^[0-9a-f]{40}$/);
  assert.match(report.git.originMain, /^[0-9a-f]{40}$/);
  assert.equal(report.remote.status, "skipped");
  assert.ok(Array.isArray(report.worktrees));
  assert.ok(report.readNext.includes("AGENTS.md"));
  assert.ok(report.readNext.includes("NOUR-COMMAND.md"));
  assert.ok(report.warnings.some((x) => x.includes("origin/main was not refreshed")));
});

test("context routing loads only the app-specific truth relevant to changed paths", () => {
  const statenour = contextPointers(["apps/statenour/lib/foo.ts"], "chore/x");
  assert.ok(statenour.includes("apps/statenour/AGENTS.md"));
  assert.ok(statenour.includes("apps/statenour/docs/CURRENT-TRUTH.md"));
  assert.ok(!statenour.includes("apps/nickstire/AGENTS.md"));

  const nick = contextPointers(["apps/nickstire/server/foo.ts"], "chore/x");
  assert.ok(nick.includes("apps/nickstire/AGENTS.md"));
  assert.ok(nick.includes("apps/nickstire/PROTECTED-CORE.md"));
  assert.ok(!nick.includes("apps/statenour/AGENTS.md"));

  const agentOs = contextPointers(["scripts/agent-os/bootstrap.mjs"], "chore/x");
  assert.ok(agentOs.includes("docs/agent-os/README.md"));
});

test("collision classification ignores the current branch and reports exact cross-PR file overlap", () => {
  const collisions = classifyCollisions(
    ["scripts/agent-os/bootstrap.mjs", "package.json"],
    "chore/mine",
    [
      {
        number: 1,
        title: "mine",
        headRefName: "chore/mine",
        files: ["scripts/agent-os/bootstrap.mjs"],
      },
      {
        number: 2,
        title: "other",
        headRefName: "chore/other",
        files: ["package.json", "docs/x.md"],
      },
      {
        number: 3,
        title: "unrelated",
        headRefName: "chore/unrelated",
        files: ["apps/statenour/lib/x.ts"],
      },
    ],
  );
  assert.deepEqual(collisions, [
    {
      pr: 2,
      title: "other",
      headRefName: "chore/other",
      exactFiles: ["package.json"],
      state: "ACTIVE_OTHER_OWNER",
    },
  ]);
});

test("worktree parser preserves path, branch and detached state", () => {
  const rows = parseWorktrees([
    "worktree C:/repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree C:/repo/.worktrees/agent",
    "HEAD 2222222222222222222222222222222222222222",
    "detached",
    "",
  ].join("\n"));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].branch, "main");
  assert.equal(rows[1].detached, true);
});
