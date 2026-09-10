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
    let head;
    try {
      head = readFileSync(join(cwd, f), "utf8").slice(0, 400);
    } catch {
      continue; // deleted-but-tracked, or unreadable; not this gate's problem
    }
    if (/^\s*["']use client["']/m.test(head)) out.push(f);
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
