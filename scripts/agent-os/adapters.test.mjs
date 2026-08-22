/**
 * Canary suite for check-adapters.mjs.
 *
 * WHY THIS EXISTS
 * check-adapters.mjs carried 56 assertions and zero proof that any of them fire.
 * A gate nobody has broken is a gate nobody knows is connected — the failure class
 * catalogued in docs/agent-audit/CONTROL-CANARY-COVERAGE.md, of which this file's
 * own subject was instance #8. The pattern is lifted from policy.test.mjs, which
 * has asserted "every denyExample is actually blocked, by its own rule" since
 * agent-os v1; this generalises it to the adapter contract.
 *
 * HOW IT WORKS
 * Each case copies the real policy files into a throwaway tmpdir, breaks exactly
 * one thing, points the checker at it via AGENT_OS_ROOT, and asserts the checker
 * exits NON-ZERO with the expected message. The real repo files are never touched.
 * A positive control asserts the UNBROKEN copy still passes — without it, a checker
 * that always failed would score 100%.
 *
 * Run:  node --test scripts/agent-os/adapters.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const CHECKER = join(HERE, "check-adapters.mjs");

/**
 * Files the checker reads.
 *
 * THIS LIST IS NOT SELF-ENFORCING, and an earlier version of this comment claimed it
 * was. Only `requireFile` reports a MISSING path; `forbidLine` and `requireMatch` both
 * early-return on `!exists(p)`. So an assertion against a path absent from this list is
 * SILENTLY INERT in every fixture — and because `checks++` runs before the exists test,
 * the printed check count is identical either way, so the number cannot reveal the gap.
 * `.agents/frameworks/ciitty/SKILL.md` was missing here and took 5 forbidLine assertions
 * dark. When you add an assertion against a new file, add the path here too.
 */
const FIXTURE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CLAUDE-OPERATING-PROFILE.md",
  "AGENT-OPERATING-PROFILE.md",
  ".agents/frameworks/ciitty/SKILL.md",
  ".github/copilot-instructions.md",
  ".antigravityrules",
  "docs/ANTIGRAVITY-RULES.md",
  "docs/codebase-memory-mcp.md",
  "scripts/start-codebase-mcp.ps1",
  ".cursor/rules/repo-core.mdc",
  ".cursor/rules/nickstire.mdc",
  ".cursor/rules/statenour.mdc",
  "apps/nickstire/AGENTS.md",
  "apps/nickstire/CLAUDE.md",
  "apps/nickstire/DEPLOY.md",
  "apps/nickstire/docs/OPERATOR-DIRECTIVE.md",
  "apps/statenour/AGENTS.md",
  "apps/statenour/CLAUDE.md",
  "apps/worker/AGENTS.md",
  "apps/worker/CLAUDE.md",
];

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-os-canary-"));
  for (const rel of FIXTURE_FILES) {
    const src = join(REPO, rel);
    const dst = join(root, rel);
    mkdirSync(dirname(dst), { recursive: true });
    try {
      copyFileSync(src, dst);
    } catch {
      // A file the checker only conditionally reads may be absent; requireFile
      // will report it, which is itself a valid signal.
    }
  }
  return root;
}

/** Run the checker against a fixture root. Returns { code, out }. */
function runChecker(root) {
  try {
    const out = execFileSync(process.execPath, [CHECKER], {
      env: { ...process.env, AGENT_OS_ROOT: root },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function edit(root, rel, fn) {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, "utf8")), "utf8");
}

/**
 * Assert that breaking `rel` in the described way makes the checker fail.
 * `expect` is a substring of the denial the checker must emit — asserting the
 * MESSAGE, not merely the exit code, so a failure for an unrelated reason
 * cannot masquerade as this canary passing.
 */
function canary(name, rel, breakIt, expect) {
  test(`fires: ${name}`, () => {
    const root = makeFixture();
    try {
      edit(root, rel, breakIt);
      const { code, out } = runChecker(root);
      assert.notEqual(code, 0, `checker PASSED on a broken ${rel} — the assertion is inert`);
      assert.ok(out.includes(expect), `expected a denial containing ${JSON.stringify(expect)}, got:\n${out}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// ── Positive control ─────────────────────────────────────────────────────────
// Without this, a checker that failed unconditionally would pass every canary.
test("positive control: an UNBROKEN fixture passes", () => {
  const root = makeFixture();
  try {
    const { code, out } = runChecker(root);
    assert.equal(code, 0, `unbroken fixture should pass, got:\n${out}`);
    assert.match(out, /parity: OK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── The seven controls, each proven by breaking it ───────────────────────────

canary(
  "root CLAUDE.md must IMPORT the profile, not link it",
  "CLAUDE.md",
  (s) => s.replace(/^@CLAUDE-OPERATING-PROFILE\.md$/m, "see [profile](./CLAUDE-OPERATING-PROFILE.md)"),
  "must IMPORT the profile",
);

canary(
  "an app adapter must IMPORT its AGENTS.md, not link it",
  "apps/worker/CLAUDE.md",
  (s) => s.replace(/^@AGENTS\.md$/m, "see [AGENTS.md](./AGENTS.md)"),
  "must IMPORT its app AGENTS.md",
);

canary(
  "root CLAUDE.md must import the canonical policy",
  "CLAUDE.md",
  (s) => s.replace(/^@AGENTS\.md$/m, "(policy lives in AGENTS.md)"),
  "must IMPORT the canonical policy",
);

canary(
  "the relocated profile must still contain its moved sections",
  "CLAUDE-OPERATING-PROFILE.md",
  (s) => s.replace(/^SKILL DISCOVERY$/m, "SKILL DISCOVERY REMOVED-FOR-TEST"),
  "SKILL DISCOVERY",
);

canary(
  "the moved subagent block must keep its load-bearing rule",
  "CLAUDE-OPERATING-PROFILE.md",
  (s) => s.replace("INHERIT THE STANCE", "(removed)"),
  "INHERIT THE STANCE",
);

canary(
  "a required canonical section cannot vanish from root AGENTS.md",
  "AGENTS.md",
  (s) => s.replace("## Verify gates", "## Verifying things"),
  "## Verify gates",
);

canary(
  "line caps are real — a fat adapter is rejected",
  "CLAUDE.md",
  (s) => s + "\n".repeat(400),
  "FAT",
);

canary(
  "a stale claim cannot come back",
  "apps/statenour/AGENTS.md",
  (s) => s + "\nDeploy by running push-main.sh from your home directory.\n",
  "push-main.sh",
);

// ── Gaps found by adversarial review, 2026-08-22 ─────────────────────────────
// The eight canaries above all exercise requireMatch / requireThin / forbidLine's
// POSITIVE path. Three real holes remained: requireFile's MISSING branch had no
// canary at all (neuter it to `return true` and every test above still passed while
// ~21 existence assertions went dark); forbidLine's `unless` exemption — the
// subtlest logic in the checker — was never exercised; and the ciitty framework
// file was absent from FIXTURE_FILES, so its 5 assertions were inert here.

test("fires: a required canonical file cannot simply vanish", () => {
  const root = makeFixture();
  try {
    rmSync(join(root, "GEMINI.md"), { force: true });
    const { code, out } = runChecker(root);
    assert.notEqual(code, 0, "checker PASSED with GEMINI.md deleted — requireFile is inert");
    assert.ok(out.includes("MISSING"), `expected a MISSING denial, got:\n${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The mirror of "a stale claim cannot come back": a claim EXPLICITLY marked retired
// must be spared, including when the marker sits on the previous line (prose wraps).
// If this exemption broke, every corrected historical note in the policy files would
// start failing the gate — and the pressure would be to delete the correction.
// Appends to apps/worker/AGENTS.md (135/200) not apps/statenour/AGENTS.md (194/200),
// so a FAT violation can never be what makes this pass or fail.
test("spares: a stale string explicitly marked RETIRED is allowed through", () => {
  const root = makeFixture();
  try {
    edit(root, "apps/worker/AGENTS.md", (s) =>
      s + "\n> **Retired 2026-08-03 — no longer the flow:**\n> deploy used to run push-main.sh from home.\n");
    const { code, out } = runChecker(root);
    assert.equal(code, 0, `a properly-marked retirement must NOT fail the gate, got:\n${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

canary(
  "assertions against the ciitty framework file are live, not inert",
  ".agents/frameworks/ciitty/SKILL.md",
  (s) => s + "\nRun the hook via .husky/pre-commit.\n",
  "husky is retired",
);

// ── The cap boundary, in both directions ─────────────────────────────────────
// `lineCount` used to count the trailing empty string after a file's final newline,
// charging every newline-terminated file one phantom line — so `cap N` silently meant
// `cap N-1`. Correcting it is what lets root AGENTS.md sit at exactly 200, so the
// boundary is proved rather than trusted. Uses GEMINI.md (35 lines, cap 40): it has
// headroom, and padding with blank lines leaves its other assertions satisfied, so
// neither direction can pass or fail for an unrelated reason.
// ── The anti-reflow gate, proved in both directions ──────────────────────────
// forbidLongLine exists because a line cap is gameable: reflowing wrapped bullets
// into one long line buys lines and costs the same bytes. Both directions matter —
// a prose line over the limit must FAIL, and a wide markdown table row must be SPARED,
// or the gate would force the Enforcement map to be wrapped into uselessness.
// Both run against apps/worker/CLAUDE.md (33 lines, cap 80 — 47 spare), NOT AGENTS.md.
// AGENTS.md now sits at exactly 200/200, so appending even two lines there trips FAT and
// the test would pass or fail for a reason other than the one under test. That is the
// same "fails for the wrong reason" trap the review probed for, and the first draft of
// these two walked straight into it.
canary(
  "a reflowed 200-char prose line is rejected",
  "apps/worker/CLAUDE.md",
  (s) => s + "\n" + "x".repeat(200) + "\n",
  "never reflow to beat a line cap",
);

test("spares: a wide markdown TABLE row is allowed through", () => {
  const root = makeFixture();
  try {
    // A REAL row: three pipes, two columns. The first draft used a single-column
    // "| ...text... |" — only two pipes — and the strict exemption correctly rejected
    // it as prose wearing a pipe. The gate was right and the fixture was unrealistic.
    edit(root, "apps/worker/CLAUDE.md", (s) =>
      s + "\n| " + "wide cell ".repeat(16) + " | " + "second column ".repeat(10) + " |\n");
    const { code, out } = runChecker(root);
    assert.equal(code, 0, `a >300-char table row must NOT trip the length gate, got:\n${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── The exemption list cannot silently drift ─────────────────────────────────
// A line cap without a length check is evadable by reflow, so every requireThin-capped
// file that is CLEAN at 140 must be length-checked. The first version of that list
// silently skipped two clean files while its comment claimed completeness. Nothing
// caught it, because a missing entry produces no output at all — the classic
// silently-inert shape. This asserts the invariant instead of trusting the comment.
test("invariant: every capped file that is clean at 140 is length-checked", () => {
  const src = readFileSync(join(HERE, "check-adapters.mjs"), "utf8");

  const capped = new Map();
  for (const m of src.matchAll(/requireThin\("([^"]+)",\s*(\d+)\)/g)) capped.set(m[1], +m[2]);
  for (const m of src.matchAll(/requireThin\(`([^`]+)`,\s*(\d+)\)/g)) {
    const t = m[1];
    if (t.includes("${app}")) for (const a of ["nickstire", "statenour", "worker"]) capped.set(t.replace("${app}", a), +m[2]);
    else if (t.includes("${rule}")) for (const r of ["repo-core", "nickstire", "statenour"]) capped.set(t.replace("${rule}", r), +m[2]);
    else capped.set(t, +m[2]);
  }
  assert.ok(capped.size >= 9, `expected to find the requireThin call sites, found ${capped.size}`);

  const block = src.slice(src.indexOf("forbidLongLine(f, 140)") - 1200, src.indexOf("forbidLongLine(f, 140)"));
  const enforced = new Set([...block.matchAll(/^\s*"([^"]+)",$/gm)].map((m) => m[1]));
  assert.ok(enforced.size >= 8, `expected the forbidLongLine list, found ${enforced.size}`);

  const missed = [];
  for (const [file] of capped) {
    if (enforced.has(file)) continue;
    let worst = 0;
    try {
      for (const l of readFileSync(join(REPO, file), "utf8").split(/\r?\n/)) {
        if (!l.trimStart().startsWith("|") && l.length > worst) worst = l.length;
      }
    } catch {
      continue; // absent file is requireFile's problem, not this invariant's
    }
    if (worst <= 140) missed.push(`${file} (worst ${worst})`);
  }
  assert.deepEqual(
    missed,
    [],
    `capped AND clean at 140, but not length-checked — each is an open reflow path:\n  ${missed.join("\n  ")}`,
  );
});

const GEMINI_CAP = 40;
const countLines = (s) => s.split(/\r?\n/).length - (s.endsWith("\n") ? 1 : 0);
const padTo = (s, n) => {
  const body = s.endsWith("\n") ? s : s + "\n";
  const need = n - countLines(body);
  assert.ok(need >= 0, `fixture already exceeds ${n} lines — pick a file with headroom`);
  return body + "\n".repeat(need);
};

test("boundary: exactly `cap` lines PASSES", () => {
  const root = makeFixture();
  try {
    edit(root, "GEMINI.md", (s) => padTo(s, GEMINI_CAP));
    const { code, out } = runChecker(root);
    assert.equal(code, 0, `exactly ${GEMINI_CAP} lines must pass, got:\n${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("boundary: cap + 1 FAILS, and reports the exact count", () => {
  const root = makeFixture();
  try {
    edit(root, "GEMINI.md", (s) => padTo(s, GEMINI_CAP + 1));
    const { code, out } = runChecker(root);
    assert.notEqual(code, 0, `${GEMINI_CAP + 1} lines must fail — the cap is off by one`);
    assert.ok(
      out.includes(`is ${GEMINI_CAP + 1} lines (cap ${GEMINI_CAP})`),
      `expected an exact off-by-one report, got:\n${out}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
