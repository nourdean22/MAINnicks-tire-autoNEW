/**
 * Canary for prompt-sharpen.mjs (job 2026-10-31-prompt-sharpener, W1).
 *
 * Every probe runs the CONFIGURED UserPromptSubmit command string from .claude/settings.json, verbatim through a shell,
 * the way hookCommand.test.mjs does: a test that calls the script some other way proves the detector, not the wiring.
 * Fail-open is proven by BREAKING the hook (a planted throw, a planted hang) in a fixture copy run through the same
 * command string, next to an unbroken control in the same fixture shape that does print the block.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const EVAL = JSON.parse(readFileSync(join(HERE, "prompt-sharpen.eval.json"), "utf8"));

const submitHooks = (settings.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []);
const configured = submitHooks.find((h) => String(h.command).includes("prompt-sharpen.mjs"));

function runHook(command, stdin, { root = ROOT, env: extra = {}, timeout = 20000 } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  Object.assign(env, { CLAUDE_PROJECT_DIR: root }, extra);
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", root) : command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: stdin, encoding: "utf8", cwd: root, env, timeout });
  return { code: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** An asks dir holding one session's file, in operator-asks.mjs's own line format. */
function asksFixture(session, asks) {
  const dir = mkdtempSync(join(tmpdir(), "sharpen-asks-"));
  if (asks) {
    const lines = asks.map((t, i) => `- 2026-10-31T1${i}:00:00.000Z typed ${JSON.stringify(t)}`);
    writeFileSync(join(dir, `${session}.md`), `# Operator asks, session ${session}\n\n${lines.join("\n")}\n`);
  }
  return dir;
}

const SESSION = `sharpen-${process.pid}`;
const HISTORY = ["audit every open PR for missing receipts", "fix the three red checks", "post the ledger rows"];
const payload = (prompt, extra = {}) => JSON.stringify({ session_id: SESSION, hook_event_name: "UserPromptSubmit", prompt, ...extra });
const withHistory = () => ({ OPERATOR_ASKS_DIR: asksFixture(SESSION, HISTORY) });

test("the hook is configured on UserPromptSubmit with a short timeout", () => {
  assert.ok(configured, "prompt-sharpen.mjs is not a UserPromptSubmit hook in .claude/settings.json");
  assert.ok(!configured.command.includes("\\"), "a backslash path does not resolve on Linux");
  assert.ok(configured.timeout && configured.timeout <= 5, `timeout must be set and <= 5 s, got ${configured.timeout}`);
});

test("eval: 30 paraphrased asks, precision >= 0.8 and recall >= 0.7 (the scan found both classes)", async () => {
  const { detect } = await import("./prompt-sharpen.mjs");
  const rows = EVAL.prompts.map((p) => ({ ...p, got: Boolean(detect(p.text)) }));
  assert.equal(rows.length, 30);
  const pos = rows.filter((r) => r.needsSharpening).length;
  assert.ok(pos >= 10 && rows.length - pos >= 10, `need both classes, got ${pos} positive`);
  const tp = rows.filter((r) => r.needsSharpening && r.got).length;
  const fp = rows.filter((r) => !r.needsSharpening && r.got).length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp / pos;
  const misses = rows.filter((r) => r.needsSharpening !== r.got).map((r) => `${r.id} expected ${r.needsSharpening} got ${r.got}`);
  assert.ok(precision >= EVAL.bar.precision, `precision ${precision.toFixed(2)}; ${misses.join("; ")}`);
  assert.ok(recall >= EVAL.bar.recall, `recall ${recall.toFixed(2)}; ${misses.join("; ")}`);
});

test("positive control: a vague ask with session history prints one [sharpen] block naming the referent", () => {
  const r = runHook(configured.command, payload("what about the rest"), { env: withHistory() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\[sharpen\] /);
  assert.match(r.stdout, /post the ledger rows/, "the newest earlier ask must be offered as the referent");
  assert.match(r.stdout, /Likely intent: [\s\S]*Deliverable: [\s\S]*Unknowns: [\s\S]*Rewritten: /);
  assert.ok(Buffer.byteLength(r.stdout) < 1500, `block too long: ${Buffer.byteLength(r.stdout)} bytes`);
});

test("the current prompt is never offered as its own referent (operator-asks may record it first)", () => {
  const env = { OPERATOR_ASKS_DIR: asksFixture(SESSION, [...HISTORY, "what about the rest"]) };
  const r = runHook(configured.command, payload("what about the rest"), { env });
  assert.match(r.stdout, /1\) "post the ledger rows"/);
});

// Each arm pinned on its own through the configured hook (mutation run 2026-10-31: removing the "?" arm or the verb arm
// left the eval above the bar).
const FIRES = [
  ["a bare question mark", "?", /Likely intent: He is waiting on you/],
  ["huh", "HUH?", /Likely intent: He is waiting on you/],
  ["an open-scope phrase", "how about everything else", /Likely intent: Cover every remaining item of the earlier ask \("everything else"\)/],
  ["a bare vague verb", "improve", /Likely intent: Apply "improve"/],
  ["an unnamed plural set, shorthand spelled out", "u figure out whats going on with those", /Ask, shorthand spelled out: "you figure out what's going on with those"[\s\S]*Likely intent: "those" points at/],
];
for (const [name, prompt, want] of FIRES) {
  test(`fires: ${name}`, () => {
    const r = runHook(configured.command, payload(prompt), { env: withHistory() });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, want);
  });
}

const QUIET = [
  ["a short real go-ahead", "go"],
  ["a short approval with an object", "yes archive it"],
  ["a merge order with a number", "merge 3056 when green"],
  ["a status token", "status?"],
  ["a long clear ask that mentions the rest", "and lets go use the rest of the usage on this account because im switching to my other account with fresh usage"],
  ["an empty prompt", ""],
  ["whitespace only", "   \n "],
  ["a slash command", "/loop what about the rest"],
  ["machine text", "<task-notification> what about the rest"],
  ["private-tagged text", "<private>my secret thing</private> what about the rest"],
  ["an unclosed private tag", "what about <private>the rest"],
  // Layers pinned one by one (mutation run 2026-10-31: removing either guard left the eval green).
  ["a closed private tag mid-ask (the private guard alone, not the machine-text guard)", "what about the rest <private>x</private>"],
  ["a delegate go-ahead", "do it for me"],
  ["a go-ahead on a listed set (the first-object rule alone)", "do those"],
  ["an open-scope phrase that names its set (the named-set rule alone)", "also check on the rest of the sessions"],
  ["a 23-word ask with a bare 'the rest' (the length guard alone)", "finish the hook today, then what about the rest, but only after the board shows queue drained and you posted the eval table"],
  ["a report of what he did (the report guard alone)", "i already saved those"],
];
for (const [name, prompt] of QUIET) {
  test(`quiet: ${name} prints nothing, exit 0`, () => {
    const r = runHook(configured.command, payload(prompt), { env: withHistory() });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "");
  });
}

test("quiet: a missing asks file prints nothing for a vague ask (no referent, no guess)", () => {
  const r = runHook(configured.command, payload("what about the rest"), { env: { OPERATOR_ASKS_DIR: asksFixture(SESSION, null) } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("quiet: malformed stdin, no session id, a non-string prompt", () => {
  for (const stdin of ["{not json", "", JSON.stringify({ prompt: "what about the rest" }), JSON.stringify({ session_id: SESSION, prompt: 42 })]) {
    const r = runHook(configured.command, stdin, { env: withHistory() });
    assert.equal(r.code, 0, `${stdin}: ${r.stderr}`);
    assert.equal(r.stdout, "", stdin);
  }
});

test("redacted asks are never shown as referents", () => {
  const env = { OPERATOR_ASKS_DIR: asksFixture(SESSION, ["fix the three red checks", "[private: redacted] and that one"]) };
  const r = runHook(configured.command, payload("what about the rest"), { env });
  assert.doesNotMatch(r.stdout, /private/i);
  assert.match(r.stdout, /fix the three red checks/);
});

/** A fixture checkout holding the hook's files, one of them mutated at an anchor that must occur exactly once. */
function fixtureRoot(mutate, { dropDependency = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sharpen-root-"));
  mkdirSync(join(root, "scripts", "agent-os"), { recursive: true });
  if (!dropDependency) copyFileSync(join(HERE, "operator-asks.mjs"), join(root, "scripts", "agent-os", "operator-asks.mjs"));
  let src = readFileSync(join(HERE, "prompt-sharpen.mjs"), "utf8");
  if (mutate) {
    const anchor = "export function buildBlock(";
    assert.equal(src.split(anchor).length - 1, 1, "mutation anchor must occur exactly once");
    // The planted body runs when the block is built, i.e. only after a real detection: the original body is kept, renamed.
    src = src.replace(anchor, `export function buildBlock(...a) { ${mutate} }\nexport function buildBlockUnused(`);
  }
  writeFileSync(join(root, "scripts", "agent-os", "prompt-sharpen.mjs"), src);
  return root;
}

test("control: the unbroken fixture copy prints the block (the fixture shape works)", () => {
  const r = runHook(configured.command, payload("what about the rest"), { root: fixtureRoot(null), env: withHistory() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\[sharpen\] /);
});

test("BREAKS: a thrown error inside the hook prints nothing on stdout and exits 0", () => {
  const root = fixtureRoot('throw new Error("planted by promptSharpen.test.mjs");');
  const r = runHook(configured.command, payload("what about the rest"), { root, env: withHistory() });
  assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /planted by promptSharpen/, "the failure must be the planted one, not some other error");
});

test("BREAKS: a hang inside the hook is killed by the timeout with nothing on stdout", () => {
  const root = fixtureRoot("for (;;) {}");
  const r = runHook(configured.command, payload("what about the rest"), { root, env: withHistory(), timeout: 2500 });
  assert.equal(r.stdout, "");
  assert.ok(r.signal || r.code !== 0, "the planted hang must actually hang (killed by the spawn timeout)");
});

test("BREAKS: a missing dependency (operator-asks.mjs absent) prints nothing on stdout and exits 0", () => {
  const r = runHook(configured.command, payload("what about the rest"), { root: fixtureRoot(null, { dropDependency: true }), env: withHistory() });
  assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /operator-asks/, "the failure must be the missing dependency");
});

test("--scope global is silent in a project whose settings already run the hook", () => {
  const r = runHook(`${configured.command} --scope global`, payload("what about the rest"), { env: withHistory() });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("bootstrap-machine carries a --scope global UserPromptSubmit entry for the hook", async () => {
  const { plan } = await import("./bootstrap-machine.mjs");
  const home = mkdtempSync(join(tmpdir(), "sharpen-home-"));
  const item = plan(home).find((x) => /UserPromptSubmit prompt-sharpen\.mjs/.test(x.label));
  assert.ok(item, "no bootstrap item for prompt-sharpen.mjs");
  assert.equal(item.state, "MISSING");
  item.apply();
  const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  const cmd = s.hooks.UserPromptSubmit.flatMap((g) => g.hooks).find((h) => h.command.includes("prompt-sharpen.mjs"))?.command;
  assert.match(cmd, /prompt-sharpen\.mjs" --scope global$/);
  assert.equal(plan(home).find((x) => /UserPromptSubmit prompt-sharpen\.mjs/.test(x.label)).state, "ok", "a second run changes nothing");
});

// The acceptance is what the hook ADDS to a prompt. Every node .mjs hook pays the same process floor (100-200 ms on this
// machine under load, measured 2026-10-31), so the bar is checked against a trivial ESM hook spawned the same way, in
// alternation, plus the hook's own in-process work time.
test("speed: the hook adds under 150 ms (median) over a trivial node hook, and its own work is under 150 ms p95", () => {
  const env = { ...process.env, ...withHistory(), CLAUDE_PROJECT_DIR: ROOT, PROMPT_SHARPEN_TIMING: "1" };
  const floorScript = join(mkdtempSync(join(tmpdir(), "sharpen-floor-")), "floor.mjs");
  writeFileSync(floorScript, 'import { readFileSync } from "node:fs";\nreadFileSync(0, "utf8");\n');
  const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
  const hook = [];
  const floor = [];
  const work = [];
  for (let i = 0; i < 25; i++) {
    let t0 = performance.now();
    const r = spawnSync(process.execPath, [join(HERE, "prompt-sharpen.mjs")], { input: payload("what about the rest"), encoding: "utf8", env });
    hook.push(performance.now() - t0);
    assert.match(r.stdout, /^\[sharpen\] /);
    work.push(Number(r.stderr.match(/work ([\d.]+) ms/)?.[1]));
    t0 = performance.now();
    spawnSync(process.execPath, [floorScript], { input: payload("what about the rest"), encoding: "utf8", env });
    floor.push(performance.now() - t0);
  }
  // The difference of two p95s under load is noise (seen -214 to +103 ms on one run each): the added cost is compared at
  // the median, the hook's own work at p95.
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const added = median(hook) - median(floor);
  process.stdout.write(`# prompt-sharpen: process p95 ${Math.round(p95(hook))} ms, floor p95 ${Math.round(p95(floor))} ms, added median ${Math.round(added)} ms, work p95 ${p95(work).toFixed(1)} ms (n=25)\n`);
  assert.ok(work.every(Number.isFinite), "the timing line must be read from every run");
  assert.ok(p95(work) < 150, `work p95 ${p95(work)} ms`);
  assert.ok(added < 150, `added median ${Math.round(added)} ms`);
});
