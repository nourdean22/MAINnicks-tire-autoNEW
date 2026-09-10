/**
 * Admin procedures that can hand an operator a FABRICATED value.
 *
 * WHY THIS EXISTS (2026-09-10). server/adminReadsDontFabricateZero.test.ts
 * guards this class by HAND-ENUMERATING two functions — getCandidates and
 * getTechnicianReferrals. The class is far larger. Measured across server/:
 * 188 dead-handle returns fabricate a value against 7 that report
 * `available: false`. A gate is only as wide as its subject list, and a
 * hand-written list of two reports green about everything it never looked at.
 *
 * WHAT IT COUNTS, and why not the obvious thing. Counting fabricating HELPERS
 * would measure the wrong population and could never go down: this repo's
 * accepted fix (ROS-083) is a guard at the ROUTER — `if (!(await getDb()))
 * throw` — precisely because the `[]` is often load-bearing at the helper.
 * adminBundle.ts consumes getCallbackRequests inside a Promise.allSettled and
 * adminBundleTruth.test.ts pins that shape, so changing the helper to fix one
 * consumer breaks another. #2279 fixed two of these at the router and both
 * helpers still fabricate.
 *
 * So the unit here is the PAIR: a procedure whose body calls a fabricating read
 * and contains no dead-handle guard. That number goes down when a real fix
 * lands, at either layer, which is what makes it a usable ratchet.
 *
 * ONE MODULE, imported by both the gate and the regenerator — the fail-open
 * slice pair in this same directory drifted TWICE when each carried its own
 * copy of the scan.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const NL = String.fromCharCode(10);

/** Returns that mean "I made something up" rather than "the read failed". */
const FABRICATED = /^\s*(\[\]|\{[^}]*\}|0\b|null\b|false\b)/;

/** Exported db.ts reads whose dead-handle branch returns a value. */
export function fabricatingReads(appRoot) {
  const src = readFileSync(join(appRoot, "server", "db.ts"), "utf8");
  const out = new Map();
  const fn = /export async function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]{0,1200}?)\n\}/g;
  let m;
  while ((m = fn.exec(src)) !== null) {
    const [, name, body] = m;
    const dead = /if \(!db\)\s*(?:\{\s*)?return ([^\n;]{0,120})/.exec(body);
    if (!dead) continue;
    const ret = dead[1];
    if (ret.includes("available: false")) continue; // the honest shape
    if (FABRICATED.test(ret)) out.set(name, ret.trim().slice(0, 60));
  }
  return out;
}

/** Tracked, non-test router sources. */
function routerFiles(appRoot) {
  return execFileSync("git", ["ls-files", "server/routers"], {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split(NL)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."));
}

/**
 * The subject list: (procedure, helper) pairs where the procedure calls a
 * fabricating read with no guard in its own body. Sorted for a stable diff.
 */
export function scanFabricatedAdminReads(appRoot) {
  const fabricating = fabricatingReads(appRoot);
  const hits = [];

  for (const rel of routerFiles(appRoot)) {
    let src;
    try {
      src = readFileSync(join(appRoot, rel), "utf8");
    } catch {
      continue; // deleted-but-tracked
    }

    const decl = /^ {2}(\w+):\s*(admin|public|protected)Procedure/gm;
    const marks = [];
    let d;
    while ((d = decl.exec(src)) !== null) marks.push({ name: d[1], tier: d[2], at: d.index });

    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
      const body = src.slice(marks[i].at, end);
      // A dead-handle guard anywhere in the procedure counts — ROS-083's shape.
      if (/!\(await getDb\(\)\)/.test(body)) continue;
      for (const [name, ret] of fabricating) {
        const called = new RegExp("\\b" + name + "\\s*\\(");
        if (called.test(body)) {
          hits.push({
            file: rel,
            procedure: marks[i].name,
            tier: marks[i].tier,
            helper: name,
            returns: ret,
          });
        }
      }
    }
  }

  hits.sort((a, b) =>
    (a.file + "::" + a.procedure + "::" + a.helper).localeCompare(b.file + "::" + b.procedure + "::" + b.helper),
  );
  return hits;
}

/** Stable identity for baseline comparison. */
export const pairKey = (h) => `${h.file}::${h.procedure}::${h.helper}`;
