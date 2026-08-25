/**
 * Canaries for the memory-index SessionStart HOOK — the wiring, not the script.
 *
 * `memoryIndex.test.mjs` proves the guard's LOGIC. It cannot prove the guard is
 * ever INVOKED, and a passing suite around an uninvoked guard is shape 1 — the
 * unwired control. That gap was stated in the install doc for a day; this file
 * closes it.
 *
 * WHAT MAKES THIS DIFFERENT FROM A HARD-CODED WIRING TEST. Every behavioural
 * case below runs THE COMMAND STRING TAKEN FROM `.claude/settings.json`, with
 * `${CLAUDE_PROJECT_DIR}` resolved the way the harness resolves it — not a
 * command this file invents. So it catches the failure that matters: someone
 * edits the hook into something that no longer detects an oversized index. A
 * test asserting a hard-coded command would pass happily while the configured
 * one was broken, which is asserting presence instead of behaviour.
 *
 * FIXTURES, NOT THE REAL INDEX (Stated Rule 9). The oversized case is a
 * synthetic directory with an injected `--limit`, so it depends on no live
 * byte count and no machine-local path. The real index is never read here: it
 * lives outside the repo, does not exist on CI, and its size legitimately
 * changes hour to hour — exactly the temporary datum a canary must not bind to.
 *
 * THE SENTINEL, NOT A BYTE COUNT. The truncation case asserts the guard reacts
 * to a MISSING INDEX-END marker. An earlier draft of the sentinel itself
 * embedded "21.2 KB / 87%", a self-staling number inside the anti-staleness
 * marker; nothing here reintroduces a size literal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS = join(ROOT, ".claude", "settings.json");
const SENTINEL = "<!-- INDEX-END -->";

/** The hook entry as actually configured, or null. */
function configuredHook() {
  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const groups = settings?.hooks?.SessionStart ?? [];
  for (const g of groups) {
    for (const h of g.hooks ?? []) {
      if (String(h.command ?? "").includes("check-memory-index")) return h;
    }
  }
  return null;
}

/**
 * Resolve `${CLAUDE_PROJECT_DIR}` and split into argv, honouring quotes.
 *
 * SEPARATORS ARE NORMALISED, and the reason matters. The configured command
 * uses Windows backslashes — as does the graphify hook beside it — because the
 * operator's machine is Windows. Run verbatim on a Linux CI runner, a
 * backslash path is one filename containing backslashes, so the first CI run of
 * this file failed with MODULE_NOT_FOUND while the hook was perfectly correct
 * on the machine it runs on.
 *
 * Normalising is a HARNESS concern, not a weakened assertion: the claim under
 * test is "the configured script detects an oversized index", not "this path
 * string parses on every OS". To keep it from masking a genuinely wrong path,
 * the resolved script is existence-checked below — a typo'd path still fails,
 * it just fails saying so instead of saying MODULE_NOT_FOUND.
 */
function resolveArgv(command) {
  const expanded = command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT);
  return (expanded.match(/"[^"]*"|\S+/g) ?? [])
    .map((t) => t.replace(/^"|"$/g, ""))
    .map((t) => (t.includes("\\") ? t.replaceAll("\\", "/") : t));
}

/** Run the CONFIGURED command with extra args against a scratch memory dir. */
function runConfigured(files, extraArgs = []) {
  const hook = configuredHook();
  assert.ok(hook, "no check-memory-index hook is configured in .claude/settings.json");
  const [bin, ...args] = resolveArgv(hook.command);
  // The normalisation above must not hide a wrong path: assert the script the
  // hook points at actually exists, so a typo fails as a typo rather than as an
  // opaque MODULE_NOT_FOUND from inside node.
  const scriptArg = args.find((a) => a.endsWith(".mjs"));
  assert.ok(scriptArg, `configured hook names no .mjs script: ${hook.command}`);
  assert.ok(existsSync(scriptArg), `configured hook points at a missing script: ${scriptArg}`);
  const dir = mkdtempSync(join(tmpdir(), "memory-hook-"));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const r = spawnSync(bin, [...args, "--dir", dir, ...extraArgs], { encoding: "utf8", cwd: ROOT });
    if (r.error) assert.fail(`configured hook command failed to launch: ${r.error.message}`);
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const healthy = {
  "MEMORY.md": `# Memory index\n\n- [alpha](alpha.md) - a\n${SENTINEL}\n`,
  "alpha.md": "a\n",
};

test("the hook is REGISTERED on SessionStart", () => {
  /*
   * A policy assertion, deliberately. Its subject is `.claude/settings.json`,
   * which is version-controlled, so this is a parity check between "the repo
   * says this guard runs" and "it is wired" — the correct response to a failure
   * is to reinstall the hook.
   *
   * If the hook is ever removed ON PURPOSE, delete this test in the same commit.
   * A canary left standing over a deliberate removal is the failure mode Stated
   * Rule 9 records, and it is how the doc-claim redundancy canary died.
   */
  const hook = configuredHook();
  assert.ok(hook, "check-memory-index is not wired into SessionStart in .claude/settings.json");
  assert.equal(hook.type, "command");
  assert.match(hook.command, /\$\{CLAUDE_PROJECT_DIR\}/, "hook must use ${CLAUDE_PROJECT_DIR}, not an absolute path");
  assert.ok((hook.timeout ?? 0) > 0, "hook needs a timeout so a hang cannot stall every session start");
});

test("BREAKS: the CONFIGURED command reports an oversized index", () => {
  // The behavioural half. --limit is injected so the fixture owns its own
  // threshold and this never depends on the production READ_LIMIT.
  const { code, out } = runConfigured(healthy, ["--limit", "50"]);
  assert.equal(code, 1, `the configured hook did not fail on an oversized index:\n${out}`);
  assert.match(out, /read limit/);
  assert.match(out, /settled-index\.md/, "the alarm must name the remedy, not just the problem");
});

test("BREAKS: the CONFIGURED command reports a missing sentinel", () => {
  // THE SENTINEL is the truncation signal — not a byte count. A file can be
  // well under the limit and still have been truncated in the reader.
  const { code, out } = runConfigured({
    ...healthy,
    "MEMORY.md": healthy["MEMORY.md"].replace(SENTINEL + "\n", ""),
  });
  assert.equal(code, 1, `the configured hook did not fail on a missing sentinel:\n${out}`);
  assert.match(out, /sentinel is not the last thing/);
});

test("positive control: the CONFIGURED command is silent and green on a healthy index", () => {
  // Without this, the two BREAKS cases above are satisfied by a hook that fails
  // on everything — including every real session start, which is how a noisy
  // guard gets uninstalled within a day.
  const { code, out } = runConfigured(healthy);
  assert.equal(code, 0, `a healthy fixture did not pass:\n${out}`);
  assert.doesNotMatch(out, /problem\(s\)/);
  // --quiet is part of the configured command: a clean start must stay clean.
  assert.doesNotMatch(out, /all reachable, sentinel present/, "--quiet must suppress the healthy line at session start");
});
