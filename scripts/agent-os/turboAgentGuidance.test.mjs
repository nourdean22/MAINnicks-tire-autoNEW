/**
 * turbo must not write its "agent rules" block into the root AGENTS.md.
 *
 * WHY THIS FILE EXISTS (2026-10-09). turbo 2.11 maintains a managed block in
 * the repository-root AGENTS.md ("<!-- BEGIN:turborepo-agent-rules -->",
 * "This is NOT the Turborepo you know") before any repository-scoped command,
 * whenever it detects an AI agent. Every agent session runs turbo (the
 * lefthook pre-push `build:affected`, `pnpm ci:affected`), so every session
 * ended with an uncommitted AGENTS.md edit: 11 lines that push the canonical
 * policy past its 200-line cap (`pnpm agent:parity`), one whole-tree `git add`
 * away from being committed. Reproduced in a cloud session: one
 * `turbo run build --dry=json` wrote the block.
 *
 * The opt-out is `"agentGuidance": false` in the root turbo.json (root-only;
 * it does not delete a block already written). Two arms:
 *   - STATIC, always: the root turbo.json opts out and AGENTS.md carries no
 *     managed block. This is the arm CI's agent-policy job can run (it has no
 *     pnpm install and no turbo).
 *   - BEHAVIOUR, wherever turbo is installed: the real binary runs against a
 *     scratch repo with this repo's setting and must leave AGENTS.md
 *     byte-identical, and a CONTROL with the setting removed must write the
 *     block, so a turbo that stops detecting agents (or renames the option)
 *     shows up as a failing control instead of a quiet green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MARKER = "turborepo-agent-rules";

/** What this file enforces on a turbo.json + AGENTS.md pair; [] = compliant. */
function guidanceProblems(turboJson, agentsMd) {
  const problems = [];
  if (turboJson.agentGuidance !== false) problems.push("turbo.json does not set agentGuidance: false");
  if (agentsMd.includes(MARKER)) problems.push("AGENTS.md carries turbo's managed block");
  return problems;
}

test("STATIC: the root turbo.json opts out and AGENTS.md carries no turbo block", () => {
  const turboJson = JSON.parse(readFileSync(join(ROOT, "turbo.json"), "utf8"));
  const agentsMd = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  assert.deepEqual(guidanceProblems(turboJson, agentsMd), []);
});

test("STATIC CONTROL: a turbo.json without the opt-out, or an AGENTS.md with the block, is reported", () => {
  // Fixed fixtures, not the repo's files, so this control holds whatever the repo says.
  const compliant = { tasks: { build: {} }, agentGuidance: false };
  assert.deepEqual(guidanceProblems(compliant, "# policy\n"), []);
  assert.deepEqual(guidanceProblems({ tasks: { build: {} } }, "# policy\n"), ["turbo.json does not set agentGuidance: false"]);
  assert.deepEqual(guidanceProblems({ ...compliant, agentGuidance: true }, "# policy\n"), ["turbo.json does not set agentGuidance: false"]);
  assert.deepEqual(guidanceProblems(compliant, `# policy\n<!-- BEGIN:${MARKER} -->\n`), ["AGENTS.md carries turbo's managed block"]);
});

/** The installed turbo binary, or null where none is installed (CI's agent-policy job). */
function turboBin() {
  try {
    const pkg = createRequire(join(ROOT, "package.json")).resolve("turbo/package.json");
    const bin = join(dirname(pkg), "bin", "turbo");
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/** Run turbo in a scratch repo carrying `agentGuidance` (undefined = omitted); return its AGENTS.md after. */
function agentsMdAfterTurbo(bin, agentGuidance) {
  const dir = mkdtempSync(join(tmpdir(), "turbo-guidance-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "turbo-guidance-canary", private: true, packageManager: "pnpm@10.4.1" }));
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(dir, "AGENTS.md"), "# sentinel\n");
    const turboJson = { tasks: { build: {} }, ...(agentGuidance === undefined ? {} : { agentGuidance }) };
    writeFileSync(join(dir, "turbo.json"), JSON.stringify(turboJson));
    // An agent session's environment, minus any inherited GIT_* (guard-red-team rule 6).
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    Object.assign(env, { AI_AGENT: "claude-code", CLAUDECODE: "1", TURBO_TELEMETRY_DISABLED: "1" });
    const r = spawnSync(bin, ["run", "build", "--dry=json"], { cwd: dir, env, encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, `turbo exited ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
    return readFileSync(join(dir, "AGENTS.md"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("BEHAVIOUR: with this repo's setting the installed turbo leaves AGENTS.md untouched; CONTROL: without it, turbo writes the block", (t) => {
  const bin = turboBin();
  if (!bin) {
    t.skip("no turbo installed here (CI's agent-policy job runs without pnpm install); the STATIC arm still ran");
    return;
  }
  const repoSetting = JSON.parse(readFileSync(join(ROOT, "turbo.json"), "utf8")).agentGuidance;
  assert.equal(agentsMdAfterTurbo(bin, repoSetting), "# sentinel\n");
  // CONTROL: the instrument fires. If this stops writing the block, turbo no
  // longer detects this environment as an agent (or the option moved), and the
  // arm above is proving nothing.
  assert.match(agentsMdAfterTurbo(bin, undefined), new RegExp(MARKER));
});
