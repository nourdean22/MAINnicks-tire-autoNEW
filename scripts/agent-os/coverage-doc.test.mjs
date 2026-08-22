/**
 * Number canary for docs/agent-audit/CONTROL-CANARY-COVERAGE.md.
 *
 * WHY THIS EXISTS — instance twelve, and the sharpest one in the catalogue.
 * That document argues no control ships without a canary. It shipped carrying roughly
 * fifteen hand-written derived numbers — check counts, test counts, chain-link counts,
 * line and byte counts, a coverage ratio — and NOTHING checked any of them. By its own
 * taxonomy it was an unproven control: a claim nobody verifies is a claim that rots.
 *
 * It rotted immediately, and in the most ordinary way possible. Every fix made during
 * the PR invalidated a number written earlier in the same PR: the check count moved
 * 123 -> 131 -> 133 -> 135 as assertions were added, and the doc kept the stale one.
 * A third adversarial review found six such numbers. A fourth would have found more,
 * because the fixes for the third would have invalidated others. That is an unbounded
 * proofreading loop, and proofreading is exactly the job a gate should be doing.
 *
 * So: recompute every derived number from the command or source that produces it, and
 * fail when the prose disagrees.
 *
 * HOW IT IS ITSELF PROVEN
 * `auditDoc()` is pure — it takes the document text and returns mismatches — so the
 * same code runs against a deliberately corrupted copy. One test asserts the real doc
 * is clean; another mutates a single number and asserts the audit catches THAT number.
 * A number-checking control that shipped unverified would refute its own thesis.
 *
 * Run:  node --test scripts/agent-os/coverage-doc.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DOC = join(REPO, "docs", "agent-audit", "CONTROL-CANARY-COVERAGE.md");

const readRepo = (rel) => readFileSync(join(REPO, rel), "utf8");
/** The gate's own line metric: a file ending in "\n" has N lines, not N+1. */
const lineCount = (text) => text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
/** Count `&&`-separated links in an npm script. */
const chainLinks = (pkgRel, script) =>
  JSON.parse(readRepo(pkgRel)).scripts[script].split("&&").length;

/** Every number the document asserts, paired with the source of truth for it. */
function truth() {
  const checkerOut = execFileSync(process.execPath, [join(HERE, "check-adapters.mjs")], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const suite = readRepo("scripts/agent-os/adapters.test.mjs");
  const policy = JSON.parse(readRepo("config/agent-os/policy.json"));
  const lefthook = readRepo("lefthook.yml");
  const preCommit = lefthook.slice(lefthook.indexOf("pre-commit:"), lefthook.indexOf("pre-push:"));

  return {
    checkerChecks: Number(/\((\d+) checks/.exec(checkerOut)[1]),
    suiteTests:
      (suite.match(/^canary\(/gm) || []).length + (suite.match(/^test\(/gm) || []).length,
    policyRules: policy.rules.length,
    denyExamples: policy.rules.reduce((n, r) => n + (r.denyExamples || []).length, 0),
    verifyHardLinks: chainLinks("apps/statenour/package.json", "verify:hard"),
    nickVerifyLinks: chainLinks("apps/nickstire/package.json", "verify"),
    preCommitCmds: (preCommit.match(/^ {4}[a-z0-9-]+:/gm) || []).length,
    agentsLines: lineCount(readRepo("AGENTS.md")),
  };
}

/**
 * Audit the document's derived numbers against `t`. Pure: takes text, returns
 * mismatches. That is what lets the corrupted-copy canary below reuse it.
 */
export function auditDoc(text, t) {
  const bad = [];
  const claim = (label, re, actual, { all = false } = {}) => {
    const found = [...text.matchAll(re)].map((m) => Number(m[1].replace(/,/g, "")));
    if (found.length === 0) {
      bad.push(`${label}: the document no longer states this number (pattern ${re}) — update the audit or restore the claim`);
      return;
    }
    for (const v of all ? found : [found[0]]) {
      if (v !== actual) bad.push(`${label}: document says ${v}, actual is ${actual}`);
    }
  };

  // One capture group per pattern — an alternation with two groups yields an undefined
  // m[1] on the second branch, which is how the first draft of this file crashed.
  claim("check-adapters check count", /(\d+) checks/g, t.checkerChecks, { all: true });
  claim("adapters.test.mjs test count", /(\d+) tests:/g, t.suiteTests, { all: true });
  // "**20** rules" and "autonomous-action rules" are deliberately NOT matched: the
  // emphasis markers and the missing digit keep them out of this pattern.
  claim("policy.json rules", /(\d+) rules[,/ ]/g, t.policyRules, { all: true });
  claim("policy.json denyExamples", /(\d+) denyExamples/g, t.denyExamples, { all: true });
  claim("statenour verify:hard links", /`verify:hard` \((\d+) links/g, t.verifyHardLinks);
  claim("nickstire verify links", /nickstire `verify` — \d+ of (\d+) links/g, t.nickVerifyLinks);
  claim("root AGENTS.md line count", /\*\*(\d+) lines, the same cap/g, t.agentsLines);

  // Table arithmetic: the Controls and With-a-canary columns must sum to the Total row.
  const rows = [];
  let total = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const c = line.replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    if (c.length < 3) continue;
    const a = /^\*{0,2}(\d+)\*{0,2}$/.exec(c[1]);
    const b = /^\*{0,2}(\d+)\*{0,2}$/.exec(c[2]);
    if (!a || !b) continue;
    if (/total/i.test(c[0])) total = [Number(a[1]), Number(b[1])];
    else rows.push([Number(a[1]), Number(b[1])]);
  }
  if (!total) {
    bad.push("coverage table: no Total row found");
  } else {
    const sum = rows.reduce((s, r) => [s[0] + r[0], s[1] + r[1]], [0, 0]);
    if (sum[0] !== total[0]) bad.push(`coverage table Controls: rows sum to ${sum[0]}, Total says ${total[0]}`);
    if (sum[1] !== total[1]) bad.push(`coverage table Canaries: rows sum to ${sum[1]}, Total says ${total[1]}`);
    const pct = (total[1] / total[0]) * 100;
    const stated = /\*\*([\d.]+) ?%\*\*/.exec(text);
    if (!stated) bad.push("coverage table: the percentage is no longer stated");
    else if (Math.abs(Number(stated[1]) - pct) > 0.05) {
      bad.push(`coverage ratio: document says ${stated[1]}%, ${total[1]}/${total[0]} is ${pct.toFixed(1)}%`);
    }
  }
  return bad;
}

// ── The audit ────────────────────────────────────────────────────────────────
test("every derived number in the coverage doc matches its source", () => {
  const bad = auditDoc(readFileSync(DOC, "utf8"), truth());
  assert.deepEqual(bad, [], `the document's numbers have drifted from what produces them:\n  ${bad.join("\n  ")}`);
});

// ── Proof the audit fires ────────────────────────────────────────────────────
// Without these, an auditDoc() that silently returned [] would score a perfect pass —
// which is precisely the failure mode this file exists to catch, applied to itself.
test("fires: a single corrupted number is caught", () => {
  const t = truth();
  const text = readFileSync(DOC, "utf8");
  const wrong = t.checkerChecks + 7;
  const corrupted = text.replace(`${t.checkerChecks} checks`, `${wrong} checks`);
  assert.notEqual(corrupted, text, "fixture setup failed: the check count is not in the document");

  const bad = auditDoc(corrupted, t);
  assert.ok(bad.length > 0, "audit PASSED on a document with a wrong check count — it is inert");
  assert.ok(
    bad.some((b) => b.includes("check count") && b.includes(String(wrong))),
    `expected the audit to name the corrupted number, got:\n  ${bad.join("\n  ")}`,
  );
});

test("fires: a broken table total is caught", () => {
  const t = truth();
  const text = readFileSync(DOC, "utf8");
  const corrupted = text.replace(/\| \*\*Total\*\* \| \*\*(\d+)\*\*/, (m, n) => m.replace(n, String(Number(n) + 3)));
  assert.notEqual(corrupted, text, "fixture setup failed: no Total row matched");

  const bad = auditDoc(corrupted, t);
  assert.ok(
    bad.some((b) => b.includes("Controls: rows sum to")),
    `expected an arithmetic mismatch, got:\n  ${bad.join("\n  ")}`,
  );
});

test("fires: a number silently deleted from the doc is caught", () => {
  const t = truth();
  const text = readFileSync(DOC, "utf8");
  const corrupted = text.replace(new RegExp(`${t.policyRules} rules`, "g"), "several rules");
  assert.notEqual(corrupted, text, "fixture setup failed: the rule count is not in the document");

  const bad = auditDoc(corrupted, t);
  assert.ok(
    bad.some((b) => b.includes("policy.json rules") && b.includes("no longer states")),
    `deleting a claim must fail too, else the fix for a wrong number is to delete it. Got:\n  ${bad.join("\n  ")}`,
  );
});
