/**
 * The native-dialog gate must SCAN every client source root, not just exist.
 *
 * WHY THIS FILE EXISTS (2026-09-10). `.github/workflows/adoption-gates.yml` runs
 * ast-grep with a hand-written list of directories, and that list had drifted
 * behind the codebase: `apps/statenour/hooks` (32 of 32 files "use client") and
 * `apps/statenour/lib` (9 more) were absent, so 41 client files sat outside a
 * gate the enforcement map describes as blocking native dialogs in BOTH PWAs'
 * CLIENT TREES.
 *
 * The workflow already has a good canary: it scans known-bad fixtures and
 * requires the run to fail AND to name the rule, so a config error cannot
 * masquerade as a catch. That canary proves the RULE fires. It cannot prove the
 * SCAN LIST points at the code — a gate is only as wide as its file list, and a
 * canary pair does not catch a missing directory. This asserts the SUBJECT.
 *
 * It is also the shape with history: `nickstire-ios-pwa-primitives` records that
 * the one `window.prompt` to survive five sweep waves lived in
 * `apps/statenour/features/`, "a source root OUTSIDE the {app,components,lib}
 * glob every earlier audit used". The lesson was learned about `features/` and
 * then re-made about `hooks/`.
 *
 * iOS PWA standalone silently suppresses window.prompt/alert/confirm — they
 * return null with no UI — so an ungated regression does not throw, it just
 * makes a button do nothing on the operator's actual phone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const REPO = join(import.meta.dirname, "..", "..");
const WORKFLOW = join(REPO, ".github", "workflows", "adoption-gates.yml");

/** The directories the dialog gate actually scans, read out of the workflow. */
function scannedRoots(workflowText) {
  const line = workflowText
    .split("\n")
    .find((l) => l.includes("ast-grep scan") && l.includes("sgconfig.yml") && !l.includes("fixtures"));
  assert.ok(line, "no ast-grep scan line found in adoption-gates.yml");
  // Everything after the config path is a target directory.
  const after = line.slice(line.indexOf("sgconfig.yml") + "sgconfig.yml".length);
  return after.trim().split(/\s+/).filter((p) => p.startsWith("apps/"));
}

/** Every tracked file that declares itself a client component. */
function clientFiles(cwd = REPO) {
  const tracked = execFileSync("git", ["ls-files", "apps/statenour", "apps/nickstire"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f));

  const out = [];
  for (const f of tracked) {
    let text;
    try {
      text = readFileSync(join(cwd, f), "utf8");
    } catch {
      continue; // deleted-but-tracked, or unreadable; not this gate's problem
    }
    // THE WHOLE FILE, not a 400-char head (fixed 2026-09-10, hours after this
    // gate shipped with that window). The directive must precede all code, but
    // COMMENTS may precede IT — and this repo writes long doc comments, so 9
    // client files carry "use client" past char 400, two of them in the very
    // roots this gate was widened to cover. A detector with a truncated window,
    // guarding against a scan list with a truncated root set.
    //
    // Over-counting is the SAFE error here: a false positive demands broader
    // coverage, a false negative silently exempts a file. So this matches the
    // directive at any line start rather than trying to prove it is the first
    // statement.
    if (/^[ 	]*["']use client["']\s*;?\s*$/m.test(text)) out.push(f);
  }
  return out;
}

const covered = (file, roots) => roots.some((r) => file === r || file.startsWith(r.replace(/\/$/, "") + "/"));

test("every 'use client' file lives under a directory the dialog gate scans", () => {
  const roots = scannedRoots(readFileSync(WORKFLOW, "utf8"));
  const files = clientFiles();

  // Positive control FIRST. If this repo somehow reported zero client files,
  // the assertion below would pass vacuously and this gate would be a decoration
  // — the exact failure mode it was written to catch in something else.
  assert.ok(
    files.length > 50,
    `expected many "use client" files, found ${files.length} — the detector is broken, not the repo`,
  );
  assert.ok(roots.length >= 4, `expected several scanned roots, got ${JSON.stringify(roots)}`);

  const uncovered = files.filter((f) => !covered(f, roots));
  const byRoot = [...new Set(uncovered.map((f) => f.split("/").slice(0, 3).join("/")))];

  assert.deepEqual(
    uncovered,
    [],
    `${uncovered.length} "use client" file(s) are OUTSIDE the native-dialog gate's scan list.\n` +
      `Ungated roots: ${byRoot.join(", ")}\n` +
      `Scanned: ${roots.join(" ")}\n` +
      `Add the missing directories to the ast-grep scan line in .github/workflows/adoption-gates.yml.\n` +
      `iOS PWA standalone suppresses window.prompt/alert/confirm silently, so a regression here\n` +
      `does not throw — it makes a control do nothing on the operator's phone.`,
  );
});

test("the coverage check FAILS when a client root is dropped from the scan list", () => {
  // The mutation arm. Without it, the test above passes for a checker that
  // reports nothing — a green that means "found no problems" and a green that
  // means "looked nowhere" are indistinguishable from outside.
  const dir = mkdtempSync(join(tmpdir(), "dialog-gate-"));
  try {
    const clientFile = join(dir, "apps", "statenour", "hooks", "use-thing.ts");
    mkdirSync(dirname(clientFile), { recursive: true });
    writeFileSync(clientFile, '"use client";\nexport const useThing = () => 1;\n');

    const roots = ["apps/statenour/app", "apps/statenour/components"]; // hooks deliberately absent
    const planted = "apps/statenour/hooks/use-thing.ts";
    assert.equal(covered(planted, roots), false, "a file under an unscanned root must read as UNCOVERED");

    // ...and the same file IS covered once its root is listed, so the check is
    // not simply returning false for everything.
    assert.equal(covered(planted, [...roots, "apps/statenour/hooks"]), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the detector sees a directive behind a long doc comment", () => {
  // THE ARM THAT WOULD HAVE CAUGHT THE ORIGINAL. This gate first shipped
  // reading only the first 400 characters of each file. The "use client"
  // directive must precede all CODE, but comments may precede IT, and this repo
  // writes long doc comments: 9 tracked client files carry the directive past
  // char 400 - two of them under apps/statenour/hooks and apps/statenour/lib,
  // the exact roots the gate had just been widened to cover. A truncated
  // detector guarding against a truncated scan list.
  const dir = mkdtempSync(join(tmpdir(), "late-directive-"));
  try {
    // Built without backslash escapes on purpose: this file is edited through
    // shells that collapse them, which broke this very fixture once.
    const nl = String.fromCharCode(10);
    const f = join(dir, "late.ts");
    const header = ["/**", ...Array(60).fill(" * padding"), " */"].join(nl) + nl;
    assert.ok(header.length > 400, "fixture must actually exceed the old window");
    writeFileSync(f, header + ['"use client";', "export const x = 1;", ""].join(nl));

    const text = readFileSync(f, "utf8");
    const DIRECTIVE = /^[ 	]*["']use client["']\s*;?\s*$/m;

    assert.equal(DIRECTIVE.test(text), true, "whole-file read must find the late directive");
    assert.equal(
      DIRECTIVE.test(text.slice(0, 400)),
      false,
      "and the OLD 400-char window must miss it - otherwise this arm proves nothing",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the live repo actually contains such files - the arm is not hypothetical", () => {
  // Without this, the fixture arm above could pass forever against a codebase
  // where the case never occurs, which is a control that examines nothing.
  const late = clientFiles().filter((f) => {
    const t = readFileSync(join(REPO, f), "utf8");
    const i = t.search(/["']use client["']/);
    return i >= 400;
  });
  assert.ok(
    late.length > 0,
    "expected at least one real file with a late 'use client'; if this is now zero the " +
      "fixture arm is the only coverage left and this assertion should be retired deliberately",
  );
});
