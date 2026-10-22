// Canary for memory-recall.mjs, the UserPromptSubmit hook that names the agent-memory files a prompt should read
// first, the way skill-recall names skills and tool-recall names tools. Every control runs the REAL script as a child
// process against a PLANTED memory directory (the real one is machine-local, so CI never sees it), and the wiring test
// runs the CONFIGURED command string verbatim. Mutants are planted by copying the script to the OS temp dir with one
// rule changed and its skill-recall import pointed back at the real file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "memory-recall.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "memory-recall-test-"));
const MEM = join(SCRATCH, "memory");
mkdirSync(MEM);

const DAY = 86_400_000;
function note(file, name, description, { daysOld = 2 } = {}) {
  const path = join(MEM, file);
  writeFileSync(path, `---\nname: ${name}\ndescription: "${description}"\nmetadata:\n  type: project\n---\n\nBody text.\n`);
  const t = new Date(Date.now() - daysOld * DAY);
  utimesSync(path, t, t);
}

note("kafene-portal-client-decisions.md", "kafene-portal-client-decisions", "Kafene merchant portal client decisions: no installer networks, the one time code goes to the owner phone, a deep link button replaced the client");
note("harness-worktree-commit-path.md", "harness-worktree-commit-path", "How to commit and push from a harness worktree: hook free shared clone, no junction, never skip the hooks", { daysOld: 40 });
note("reel-ask-consistency-fix.md", "reel-ask-consistency-fix", "Reel caption ask refused at enqueue, the generator strips caption asks, assembly refusals do not burn attempts");
note("voice-receptionist-status.md", "voice-receptionist-status", "Voice receptionist prompt status for the Vapi assistant: coming now and tow texts go to the manager");
// Files that must NEVER be recalled: the index, the second-level index and a backup, each carrying the kafene words.
writeFileSync(join(MEM, "MEMORY.md"), "- [Kafene portal client](kafene-portal-client-decisions.md) kafene portal client index line\n<!-- INDEX-END -->\n");
writeFileSync(join(MEM, "settled-index.md"), "- [Kafene](kafene-portal-client-decisions.md) kafene portal client settled\n");
note("_bak_kafene-portal-client-decisions.md", "kafene-portal-client-decisions", "Kafene merchant portal client decisions backup copy");
// A file with no frontmatter: skipped quietly, never a crash.
writeFileSync(join(MEM, "no-frontmatter.md"), "kafene portal client just text, no frontmatter\n");

function run(args, { stdin, env = {}, script = SCRIPT, dir = MEM } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    input: stdin, encoding: "utf8", cwd: ROOT, timeout: 20000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, MEMORY_RECALL_DIR: dir, ...env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const lines = (out) => out.split(/\r?\n/).filter(Boolean);
const LINE = /^\[memory-recall\] read: (\S+\.md) \([^)]+\) .+ \[(\d+)d old\]$/;

const POSITIVE = [
  ["what did we decide about the kafene portal client", "kafene-portal-client-decisions.md"],
  ["how do I commit and push from a harness worktree", "harness-worktree-commit-path.md"],
  ["why does the reel generator strip the caption ask", "reel-ask-consistency-fix.md"],
];

for (const [prompt, file] of POSITIVE) {
  test(`--text "${prompt}" recalls ${file}`, () => {
    const r = run(["--text", prompt]);
    assert.equal(r.code, 0, r.err);
    const got = lines(r.out);
    assert.ok(got.length >= 1 && got.length <= 3, `expected 1-3 lines, got:\n${r.out}`);
    for (const l of got) assert.match(l, LINE);
    assert.ok(got.some((l) => l.startsWith(`[memory-recall] read: ${file} (`)), `${file} missing from:\n${r.out}`);
  });
}

test("nonsense recalls NOTHING (zero bytes) and exits 0", () => {
  const r = run(["--text", "asdf qwerty"]);
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

// Near miss: two words that sit only in a description body (never in a file name) and are too common to carry weight.
// It must score above zero and under the floor, so it is the control that dies when the floor is removed.
// Measured 2026-10-22 against memory-recall.mjs (--json): the three positive prompts score 14.6, 15.9 and 13.8, this one
// scores 2.2 (kafene note, body words only), "asdf qwerty" scores nothing, and the floor is skill-recall's 7.5.
const NEAR_MISS = "owner phone";

test("near miss: body-only hits under the floor recall nothing", () => {
  const r = run(["--text", NEAR_MISS]);
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("the index, the second-level index, backups and frontmatter-less files are never recalled", () => {
  const r = run(["--text", "kafene portal client decisions index settled backup copy no frontmatter"]);
  assert.equal(r.code, 0, r.err);
  const files = lines(r.out).map((l) => LINE.exec(l)?.[1]);
  assert.deepEqual(files, ["kafene-portal-client-decisions.md"], `unexpected recall:\n${r.out}`);
});

test("at most 3 lines even when every note matches", () => {
  const r = run(["--text", "kafene portal client commit push harness worktree reel caption ask enqueue voice receptionist vapi tow"]);
  assert.equal(r.code, 0);
  assert.equal(lines(r.out).length, 3, r.out);
});

test("each line carries the note's age so a stale memory reads as stale", () => {
  const r = run(["--text", POSITIVE[1][0]]);
  assert.match(r.out, /^\[memory-recall\] read: harness-worktree-commit-path\.md \([^)]+\) .+ \[40d old\]$/m);
  const k = run(["--text", POSITIVE[0][0]]);
  assert.match(k.out, /^\[memory-recall\] read: kafene-portal-client-decisions\.md \([^)]+\) .+ \[2d old\]$/m);
});

test("hook mode: stdin JSON with a prompt field prints the same match", () => {
  const r = run([], { stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: POSITIVE[0][0] }) });
  assert.equal(r.code, 0);
  assert.match(r.out, /^\[memory-recall\] read: kafene-portal-client-decisions\.md \(/m);
});

test("no memory directory (a cloud session, another machine) prints nothing and exits 0", () => {
  const r = run(["--text", POSITIVE[0][0]], { dir: join(SCRATCH, "does-not-exist") });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("a memory path that is a FILE prints exactly one off line and exits 0", () => {
  const r = run(["--text", POSITIVE[0][0]], { dir: join(MEM, "MEMORY.md") });
  assert.equal(r.code, 0);
  const got = lines(r.out);
  assert.equal(got.length, 1, r.out);
  assert.match(got[0], /^\[memory-recall\] off: .+/);
});

test("garbage stdin fails open: one off line, exit 0 (exit 2 would veto the prompt)", () => {
  const r = run([], { stdin: "not json" });
  assert.equal(r.code, 0);
  assert.match(r.out, /^\[memory-recall\] off: /);
});

test("--json reports the index size and the picked files", () => {
  const r = run(["--text", POSITIVE[0][0], "--json"]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.count, 4, "four planted notes carry a description; the index, backup and bare file do not count");
  assert.equal(j.picked[0].name, "kafene-portal-client-decisions");
});

function configured() {
  const hooks = (SETTINGS.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []);
  return { hooks, at: hooks.findIndex((h) => h.command?.includes("memory-recall.mjs")), tool: hooks.findIndex((h) => h.command?.includes("tool-recall.mjs")) };
}

test("settings: UserPromptSubmit runs memory-recall right after tool-recall, forward slashes", () => {
  const { hooks, at, tool } = configured();
  assert.ok(at >= 0, "memory-recall.mjs is not registered on UserPromptSubmit");
  assert.equal(at, tool + 1, "memory-recall must run right after tool-recall");
  assert.doesNotMatch(hooks[at].command, /\\/);
  assert.match(hooks[at].command, /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/memory-recall\.mjs"$/);
});

test("the CONFIGURED command runs verbatim through a shell and recalls the planted note", () => {
  const { hooks, at } = configured();
  assert.ok(at >= 0, "memory-recall.mjs is not registered on UserPromptSubmit");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  env.MEMORY_RECALL_DIR = MEM;
  const cmd = process.platform === "win32" ? hooks[at].command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : hooks[at].command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ prompt: POSITIVE[0][0] }), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[memory-recall\] read: kafene-portal-client-decisions\.md \(/m);
});

// Consumer check on the machine that has the real directory: the default resolution (no env override) must find it
// from a harness worktree, not only from the primary checkout. Skipped where no memory directory exists.
test("default resolution finds this machine's real memory directory when there is one", (t) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--text", "memory", "--json"], {
    encoding: "utf8", cwd: ROOT, timeout: 20000,
    env: Object.fromEntries(Object.entries({ ...process.env, CLAUDE_PROJECT_DIR: ROOT }).filter(([k]) => k !== "MEMORY_RECALL_DIR" && !k.startsWith("GIT_"))),
  });
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout.trim()) return t.skip("no memory directory on this machine");
  const j = JSON.parse(r.stdout);
  assert.ok(existsSync(j.dir), `resolved a directory that does not exist: ${j.dir}`);
  assert.ok(j.count > 0, `the real directory resolved but indexed 0 notes: ${j.dir}`);
});

/** A mutant copy in the temp dir; its skill-recall import is pointed at the real file. */
function mutant(label, from, to) {
  const src = readFileSync(SCRIPT, "utf8");
  assert.equal(src.split(from).length - 1, 1, `mutation anchor must occur exactly once: ${from}`);
  const file = join(SCRATCH, `${label}.mjs`);
  writeFileSync(file, src.replace(from, to).replace('"./skill-recall.mjs"', JSON.stringify(pathToFileURL(join(HERE, "skill-recall.mjs")).href)));
  return (args) => run(args, { script: file });
}

test("MUTANT no-floor: dropping the FLOOR check makes the near miss print (the control is not silent)", () => {
  const m = mutant("no-floor", "r.score >= FLOOR", "r.score > 0");
  assert.equal(m(["--text", POSITIVE[0][0]]).code, 0, "mutant must still run");
  assert.notEqual(m(["--text", NEAR_MISS]).out, "", "the near-miss control did not kill the no-floor mutant");
});

test("MUTANT no-backup-skip: indexing _bak_ copies makes the backup show up (the exclusion is real)", () => {
  const m = mutant("no-bak-skip", 'f.startsWith("_bak_")', "false");
  const files = lines(m(["--text", "kafene portal client decisions backup copy"]).out).map((l) => LINE.exec(l)?.[1]);
  assert.ok(files.includes("_bak_kafene-portal-client-decisions.md"), `mutant did not surface the backup:\n${files}`);
});

test("MUTANT no-line-cap: raising MAX_LINES makes the cap control print more than 3 lines", () => {
  const m = mutant("no-cap", "const MAX_LINES = 3;", "const MAX_LINES = 30;");
  const out = m(["--text", "kafene portal client commit push harness worktree reel caption ask enqueue voice receptionist vapi tow"]).out;
  assert.ok(lines(out).length > 3, `mutant still capped at 3:\n${out}`);
});
