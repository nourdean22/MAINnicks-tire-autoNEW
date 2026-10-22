/**
 * Canaries for the health-first Stop hook (scripts/agent-os/health-first.mjs, 2026-10-22, job manager-skill-best).
 *
 * The manager session of 2026-10-21/22 started with `[health] ... graphify DOWN ... | FIX FIRST: (1) ... (2) ...` and ran
 * neither fix for about a day. Drives the REAL script with Stop-hook stdin against fixture transcripts shaped like the real
 * SessionStart attachment (transcript 0900c49a, line 7). Blocks are asserted with the hook's own `[health-first]` line,
 * never a bare nonzero exit; each block case has a control that differs in one entry and must pass.
 *
 * Run: node --test scripts/agent-os/healthFirst.test.mjs   (pnpm agent:verify discovers it)
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "health-first.mjs");

let seq = 0;
const ts = () => new Date(Date.UTC(2026, 9, 22, 10, 0, seq++)).toISOString();
const FAIL_LINE =
  "[health] graph ok (0 behind origin/main) | graphify DOWN | claude ok | codex ok | vscode ok | hooks ok | task NOURCITY-Local-MCP FAILED -1073741510 | " +
  "FIX FIRST: (1) powershell -NoProfile -ExecutionPolicy Bypass -File C:/repo/scripts/local-mcp-servers.ps1 -Start " +
  "(2) powershell -NoProfile -ExecutionPolicy Bypass -File C:/repo/scripts/register-local-mcp-task.ps1 -RepoRoot C:/repo (then check its log)";
const OK_LINE = "[health] graph ok (3 behind origin/main) | graphify up | claude ok | codex ok | vscode ok | hooks ok";
const health = (content, source = "startup") => ({
  type: "attachment",
  timestamp: ts(),
  uuid: `h-${seq}`,
  attachment: { type: "hook_success", hookName: `SessionStart:${source}`, hookEvent: "SessionStart", content, stdout: `${content}\n`, exitCode: 0 },
});
const prompt = (text) => ({ type: "user", origin: { kind: "human" }, uuid: `u-${seq}`, timestamp: ts(), message: { role: "user", content: text } });
const use = (name, input = {}) => ({ type: "assistant", timestamp: ts(), message: { role: "assistant", content: [{ type: "tool_use", id: `t-${seq}`, name, input }] } });
const result = () => ({ type: "user", toolUseResult: { stdout: "ok" }, timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } });
const say = (text) => ({ type: "assistant", timestamp: ts(), message: { role: "assistant", content: [{ type: "text", text }] } });
const jsonl = (list) => list.map((e) => JSON.stringify(e)).join("\n") + "\n";

function fixture(list) {
  const dir = mkdtempSync(join(tmpdir(), "health-first-"));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, jsonl(list));
  return { dir: join(dir, "state"), transcript, session: "sess-1" };
}
function stop(fx, extra = {}) {
  const { raw, timing, ...rest } = extra;
  const payload = { session_id: fx.session, transcript_path: fx.transcript, hook_event_name: "Stop", stop_hook_active: false, ...rest };
  const env = { ...process.env, HEALTH_FIRST_DIR: fx.dir, ...(timing ? { HEALTH_FIRST_TIMING: "1" } : {}) };
  const r = spawnSync(process.execPath, [SCRIPT], { input: raw ?? JSON.stringify(payload), env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const TURN = () => [prompt("what's the status of the PRs?"), use("Bash", { command: "gh pr list" }), result(), say("Two PRs open.")];

test("a FIX FIRST line nothing acted on blocks the first stop once, naming the fixes", () => {
  const r = stop(fixture([health(FAIL_LINE), ...TURN()]));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /\[health-first\]/);
  assert.match(r.err, /local-mcp-servers\.ps1/);
  assert.match(r.err, /Health:/, "the block says how to decline the fix honestly");
  assert.equal(r.out, "");
});

test("control: running one of the named fixes (by script name, any runner) passes", () => {
  for (const tool of [
    use("PowerShell", { command: "powershell -NoProfile -ExecutionPolicy Bypass -File C:/repo/scripts/local-mcp-servers.ps1 -Start" }),
    use("Bash", { command: "cd /c/repo && powershell -File scripts/register-local-mcp-task.ps1 -RepoRoot ." }),
    use("mcp__terminal__run_in_terminal", { command: "& .\\scripts\\local-mcp-servers.ps1 -Start" }),
  ]) {
    const r = stop(fixture([health(FAIL_LINE), prompt("go"), tool, result(), say("Fixed.")]));
    assert.equal(r.code, 0, `${tool.message.content[0].name}: ${r.err}`);
  }
});

test("control: a reply line starting 'Health:' (fixed, or why not) passes, from the transcript or last_assistant_message", () => {
  const list = [health(FAIL_LINE), ...TURN().slice(0, -1), say("Two PRs open.\nHealth: not fixed, because a sibling session is restarting graphify now.")];
  assert.equal(stop(fixture(list)).code, 0);
  assert.equal(stop(fixture([health(FAIL_LINE), ...TURN()]), { last_assistant_message: "Two PRs open.\n**Health:** fixed, graphify up." }).code, 0);
  const mention = [health(FAIL_LINE), ...TURN().slice(0, -1), say("The health line said graphify was down.")];
  assert.equal(stop(fixture(mention)).code, 2, "mentioning health is not the Health: line");
});

test("no FIX FIRST: an ok line, an UNKNOWN line with no fix, or no health line at all is silent", () => {
  for (const list of [
    [health(OK_LINE), ...TURN()],
    [health("[health] graph UNKNOWN (timeout) | graphify up | hooks ok"), ...TURN()],
    TURN(),
  ]) {
    const r = stop(fixture(list));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "");
  }
});

test("one-shot per health line: the next stop goes through; a NEW FIX FIRST line (resume or compaction) is judged again", () => {
  const fx = fixture([health(FAIL_LINE), ...TURN()]);
  assert.equal(stop(fx).code, 2);
  assert.equal(stop(fx).code, 0, "the second stop for the same line goes through (no loop)");
  appendFileSync(fx.transcript, jsonl(TURN()));
  assert.equal(stop(fx).code, 0, "later turns are not re-blocked for a line already judged");
  appendFileSync(fx.transcript, jsonl([health(FAIL_LINE, "resume"), ...TURN()]));
  assert.equal(stop(fx).code, 2, "a fresh FIX FIRST after a resume is a new first task");
});

test("a fix run in an earlier turn of the same session still counts when the line is first judged", () => {
  const list = [health(FAIL_LINE), prompt("start"), use("PowerShell", { command: "scripts/local-mcp-servers.ps1 -Start" }), result(), say("ok"), ...TURN()];
  assert.equal(stop(fixture(list)).code, 0);
});

test("a tool call BEFORE the health line does not count as its fix", () => {
  const list = [use("PowerShell", { command: "scripts/local-mcp-servers.ps1 -Start" }), result(), health(FAIL_LINE, "compact"), ...TURN()];
  assert.equal(stop(fixture(list)).code, 2);
});

test("stop_hook_active always passes; it fails OPEN on garbage stdin, a missing transcript and an unwritable state dir", () => {
  const fx = fixture([health(FAIL_LINE), ...TURN()]);
  assert.equal(stop(fx, { stop_hook_active: true }).code, 0);
  for (const extra of [{ raw: "{not json" }, { raw: JSON.stringify({ transcript_path: fx.transcript }) }, { transcript_path: join(fx.dir, "nope.jsonl") }]) {
    assert.equal(stop(fx, extra).code, 0, JSON.stringify(extra));
  }
  assert.equal(stop({ ...fixture([health(FAIL_LINE), ...TURN()]), dir: fx.transcript }).code, 0, "a block it cannot remember would loop: never block blind");
});

test("incremental: after the first judgment only new bytes are read, so a 20 MB session stays fast", () => {
  const filler = say("z".repeat(4000));
  const fx = fixture([health(OK_LINE), ...Array.from({ length: 5000 }, () => filler), ...TURN()]);
  assert.equal(stop(fx).code, 0);
  appendFileSync(fx.transcript, jsonl(TURN()));
  const r = stop(fx, { timing: true });
  assert.equal(r.code, 0, r.err);
  const read = Number(r.err.match(/read (\d+) bytes/)?.[1]);
  assert.ok(read > 0 && read < 10_000, `the second stop read ${read} bytes; it must read only the appended turn`);
});

test("wiring: health-first.mjs is a configured Stop hook", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  const hit = settings.hooks.Stop.some((g) => g.hooks.some((h) => h.command.includes("scripts/agent-os/health-first.mjs")));
  assert.ok(hit, "health-first.mjs must be configured under Stop in .claude/settings.json");
});

// -- Skeptic pass 2026-10-22 (evals/skeptic.md of monorepo-manager) ----------------------------------------------------
test("skeptic: reading or grepping the fix is not running it; a bare 'Health: ok' is not a reason", () => {
  for (const tool of [use("Read", { file_path: "C:/repo/scripts/local-mcp-servers.ps1" }), use("Grep", { pattern: "local-mcp-servers.ps1" })]) {
    assert.equal(stop(fixture([health(FAIL_LINE), prompt("go"), tool, result(), say("Looked at it.")])).code, 2, tool.message.content[0].name);
  }
  assert.equal(stop(fixture([health(FAIL_LINE), ...TURN().slice(0, -1), say("Two PRs open.\nHealth: ok")])).code, 2, "'Health: ok' says nothing done");
});

test("skeptic: fixes that name no script are matched by what they say to do", () => {
  const wrongService =
    "[health] graphify WRONG SERVICE | FIX FIRST: (1) find the program on port 8765: Get-NetTCPConnection -LocalPort 8765 -State Listen; free the port or move graphify in config/agent-os/local-services.json";
  const run = use("PowerShell", { command: "Get-NetTCPConnection -LocalPort 8765 -State Listen | Select-Object OwningProcess" });
  assert.equal(stop(fixture([health(wrongService), prompt("go"), run, result(), say("Port held by pid 4242.")])).code, 0);
  const hooksBlocked =
    '[health] hooks BLOCKED graphify-session-context.ps1 | FIX FIRST: (1) add -ExecutionPolicy Bypass after "powershell -NoProfile" in the hook commands of graphify-session-context.ps1';
  const edit = use("Edit", { file_path: "C:/repo/.claude/settings.json", old_string: "powershell -NoProfile -File", new_string: "powershell -NoProfile -ExecutionPolicy Bypass -File" });
  assert.equal(stop(fixture([health(hooksBlocked), prompt("go"), edit, result(), say("Hook fixed.")])).code, 0);
  assert.equal(stop(fixture([health(hooksBlocked), ...TURN()])).code, 2, "control: the same line with no edit is still sent back");
});

test("a script fix is matched by its script, not by the Bypass flag every PowerShell call carries; a fix naming nothing takes any run", () => {
  const other = use("PowerShell", { command: "powershell -NoProfile -ExecutionPolicy Bypass -File C:/repo/scripts/something-else.ps1" });
  assert.equal(stop(fixture([health(FAIL_LINE), prompt("go"), other, result(), say("Ran a script.")])).code, 2, "an unrelated Bypass call is not the fix");
  const vague = "[health] graphify DOWN | FIX FIRST: (1) restart the graph service by hand";
  assert.equal(stop(fixture([health(vague), prompt("go"), use("Bash", { command: "echo restarting" }), result(), say("Done.")])).code, 0, "a fix that names nothing is acted on by any run");
  assert.equal(stop(fixture([health(vague), ...TURN().slice(0, 1), say("Two PRs open.")])).code, 2, "control: no run at all is still sent back");
});
