/**
 * Every `uses:` in .github/workflows/** must name a full commit SHA.
 *
 * WHY THIS EXISTS. On 2026-09-09 this repo had 40 action references across 11
 * workflow files and NOT ONE was pinned — every one rode a mutable tag
 * (`@v7`, `@v6`, `@v4`). A tag is a pointer the action's owner can move at any
 * time, so "we reviewed this action" is a statement about whatever the tag
 * pointed at on the day someone looked, not about what runs on the next push.
 *
 * That is not a theoretical exposure. In March 2025 every version tag of
 * tj-actions/changed-files from v1.0.0 through v45.0.7 was silently repointed
 * to one malicious commit that dumped CI secrets into public build logs
 * (CVE-2025-30066, ~23,000 repositories, CISA KEV-listed 2025-03-18). It
 * cascaded from the same tag-rewrite against reviewdog/action-setup
 * (CVE-2025-30154). A workflow pinned to a full SHA was STRUCTURALLY immune —
 * a SHA cannot be repointed without ceasing to be that SHA. Two of this repo's
 * five distinct actions are third-party (`pnpm/action-setup`,
 * `dorny/paths-filter`), i.e. exactly the class tj-actions belonged to.
 *
 * The 40 refs were pinned by hand that day. THIS FILE is what stops ref #41
 * from arriving unpinned tomorrow — a one-time cleanup with no gate behind it
 * is a cleanup that rots, which is the failure shape this repo keeps finding
 * in its own controls.
 *
 * SCOPE, stated so nobody reads it as broader than it is. This rule defends
 * against a MUTABLE REFERENCE. It does nothing about template injection or
 * cache poisoning — the Ultralytics compromise (Dec 2024) was an unquoted
 * branch name interpolated into a shell step behind `pull_request_target`, and
 * SHA-pinning would not have touched it. Do not let a green run here be read
 * as "the workflows are secure".
 *
 * HOW IT IS ITSELF PROVEN. `scanWorkflow()` is pure — text in, findings out —
 * so the same code runs against a deliberately corrupted copy of a real
 * workflow. One test asserts the live tree is clean; another unpins a single
 * ref and asserts THAT line is caught; a third asserts the scanner sees as
 * many refs as an independent counter does, so the "clean" verdict can never
 * come from a scanner that matched nothing at all.
 *
 * Run:  node --test scripts/agent-os/actionPinning.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WF_DIR = join(REPO, ".github", "workflows");

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Classify one `uses:` value.
 *
 * Local composite actions (`./.github/actions/x`) live in this repo and move
 * with the commit under test, so there is no mutable third-party pointer to
 * pin — they are exempt by nature, not by concession.
 */
function classify({ file, line, value, comment }) {
  const at = { file, line, value, comment };

  if (value.startsWith("./") || value.startsWith("../")) {
    return { ...at, kind: "local", ok: true };
  }
  if (value.startsWith("docker://")) {
    // A docker ref pins by image digest, a different mechanism with a
    // different syntax. Flagged rather than silently blessed.
    return {
      ...at,
      kind: "docker",
      ok: /@sha256:[0-9a-f]{64}$/.test(value),
      reason: "docker:// ref should carry an @sha256: digest",
    };
  }

  const cut = value.lastIndexOf("@");
  if (cut < 0) {
    return { ...at, kind: "action", ok: false, reason: "no ref at all — cannot be pinned" };
  }
  const ref = value.slice(cut + 1);

  if (!SHA_RE.test(ref)) {
    return {
      ...at,
      kind: "action",
      ok: false,
      reason: `mutable ref "${ref}" — pin to a full 40-char commit SHA`,
    };
  }
  if (!comment) {
    // A bare 40-char hex is unreadable and unreviewable. Dependabot has kept
    // this comment in sync natively since 2022-10-31, so requiring it costs
    // nothing and preserves the only human-legible signal of which version
    // is actually running.
    return {
      ...at,
      kind: "action",
      ok: false,
      reason: "SHA-pinned but missing the trailing version comment (` # v7`)",
    };
  }
  return { ...at, kind: "action", ok: true };
}

/** Pure: workflow text -> one finding per `uses:` line. */
export function scanWorkflow(text, file = "<memory>") {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return; // a commented-out step is not a step
    const m = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(raw);
    if (!m) return;

    let value = m[1];
    let comment = null;
    // Split a trailing YAML comment. Requires whitespace before `#` so a `#`
    // inside the ref itself is not mistaken for one.
    const hash = value.search(/\s+#/);
    if (hash >= 0) {
      comment = value.slice(hash).replace(/^\s+#\s*/, "").trim() || null;
      value = value.slice(0, hash).trim();
    }
    value = value.replace(/^['"]|['"]$/g, "");
    out.push(classify({ file, line: i + 1, value, comment }));
  });
  return out;
}

const workflowFiles = () =>
  readdirSync(WF_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();

const scanTree = () =>
  workflowFiles().flatMap((f) => scanWorkflow(readFileSync(join(WF_DIR, f), "utf8"), f));

// ── The gate itself ────────────────────────────────────────────────────────

test("every workflow `uses:` is pinned to a full commit SHA", () => {
  const bad = scanTree().filter((f) => !f.ok);
  const detail = bad.map((f) => `  ${f.file}:${f.line}  ${f.value}  — ${f.reason}`).join("\n");
  assert.equal(bad.length, 0, `unpinned or unreadable action refs:\n${detail}`);
});

// ── Proof the scanner can see (positive controls) ──────────────────────────

test("POSITIVE CONTROL: the scanner sees every `uses:` an independent count finds", () => {
  // Without this, the clean verdict above would also be produced by a scanner
  // whose regex matched nothing — the blind-instrument shape this repo keeps
  // finding in its own gates, applied to this file.
  const independent = workflowFiles().reduce((n, f) => {
    const text = readFileSync(join(WF_DIR, f), "utf8");
    return (
      n +
      text
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l) && /^\s*(?:-\s*)?uses:\s*\S/.test(l)).length
    );
  }, 0);

  assert.ok(independent > 0, "no `uses:` lines found at all — the fixture set is wrong");
  assert.equal(scanTree().length, independent);
});

test("CANARY: unpinning one real ref is caught, on that exact line", () => {
  const file = workflowFiles().find((f) =>
    /uses:\s*\S+@[0-9a-f]{40}/.test(readFileSync(join(WF_DIR, f), "utf8")),
  );
  assert.ok(file, "no SHA-pinned ref anywhere to mutate — cannot prove the gate fires");

  const real = readFileSync(join(WF_DIR, file), "utf8");
  assert.equal(scanWorkflow(real, file).filter((f) => !f.ok).length, 0, `${file} starts clean`);

  const broken = real.replace(/(uses:\s*\S+)@[0-9a-f]{40}(\s*#[^\n]*)?/, "$1@v4");
  assert.notEqual(broken, real, "mutation did not apply — the fixture shape moved");

  const caught = scanWorkflow(broken, file).filter((f) => !f.ok);
  assert.equal(caught.length, 1);
  assert.match(caught[0].reason, /mutable ref "v4"/);
});

// ── Negative controls: none of these may fire ──────────────────────────────

test("SPARES a local composite action — it moves with the commit under test", () => {
  const f = scanWorkflow("      - uses: ./.github/actions/setup\n");
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "local");
  assert.equal(f[0].ok, true);
});

test("SPARES a commented-out step", () => {
  assert.equal(scanWorkflow("      # - uses: actions/checkout@v7\n").length, 0);
});

test("SPARES a quoted ref, and still reads the SHA through the quotes", () => {
  const sha = "a".repeat(40);
  const f = scanWorkflow(`      - uses: "actions/checkout@${sha}" # v7\n`);
  assert.equal(f[0].ok, true);
});

// ── Shapes that MUST fire ──────────────────────────────────────────────────

test("FIRES on a bare SHA with no version comment", () => {
  const f = scanWorkflow(`      - uses: actions/checkout@${"b".repeat(40)}\n`);
  assert.equal(f[0].ok, false);
  assert.match(f[0].reason, /missing the trailing version comment/);
});

test("FIRES on a branch ref and on a short SHA", () => {
  assert.equal(scanWorkflow("      - uses: foo/bar@main\n")[0].ok, false);
  assert.equal(scanWorkflow("      - uses: foo/bar@abc1234 # short\n")[0].ok, false);
});

test("FIRES on a reusable workflow pinned to a tag", () => {
  const f = scanWorkflow("    uses: owner/repo/.github/workflows/ci.yml@v2\n");
  assert.equal(f[0].ok, false);
  assert.match(f[0].reason, /mutable ref "v2"/);
});

test("FIRES on a docker ref with no digest", () => {
  assert.equal(scanWorkflow("      - uses: docker://alpine:3.20\n")[0].ok, false);
});
