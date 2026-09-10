/**
 * Procedures that can hand a caller a FABRICATED value when the database is gone.
 *
 * WHY THIS EXISTS (2026-09-10). server/adminReadsDontFabricateZero.test.ts
 * guards this class by HAND-ENUMERATING two functions. The class is far larger.
 * A gate is only as wide as its subject list, and a hand-written list of two
 * reports green about everything it never looked at.
 *
 * WHY IT WAS WIDENED (2026-09-10, later the same day). The first version of
 * this scanner read exactly one file:
 *
 *     const src = readFileSync(join(appRoot, "server", "db.ts"), "utf8");
 *
 * So the ratchet it fed was itself an instrument measuring something narrower
 * than its subject — ROS-103's shape inside the gate built to catch ROS-103.
 * It recorded 30 pairs while 46 more sat in files it never opened.
 *
 * That was not academic. `getDynamicArticleBySlug`
 * (server/content-generator.ts) returns `null` on a dead handle, the same value
 * it returns for a slug that genuinely has no article; BlogPost.tsx renders
 * that as "ARTICLE NOT FOUND", the prerenderer committed it at HTTP 200 for
 * sitemap-advertised URLs, and Google filed them as Soft 404s. Prerender
 * refresh run 34522396903 caught six blog routes doing it inside a 90-second
 * window. The scanner could not see the helper at all.
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
 * COMMENTS ARE STRIPPED BEFORE ANY MATCHING, and that is not tidiness. Measured
 * before it was added: `instagramAdmin.ts::getSwipeFileCorrelations` was
 * recorded as calling `getTopPosts` purely because a prose comment in its body
 * says "reusing the same getTopPosts() recentWinners" — a pair that does not
 * exist and could never be "fixed". The same hazard runs the other way on the
 * guard side: a comment quoting `!(await getDb())` would make an unguarded
 * procedure read as guarded. That one measured zero occurrences today, so it
 * was latent rather than live — both directions are closed here regardless,
 * because a latent false negative in a ratchet is a permanent blind spot.
 * Stripping also RAISED the helper count 98 -> 107: comment blocks were pushing
 * function bodies past the 1200-char window and hiding real fabrications.
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

/**
 * The dead-handle branch. THREE spellings, measured across server/: `db` 346
 * times, `d` 480, `database` 43. The original pattern matched only `!db`, which
 * happens to be the sole spelling inside db.ts (113 occurrences, zero `!d`) —
 * so the narrow subject list and the narrow variable name concealed each other.
 */
const DEAD_HANDLE = /if \(!(?:db|d|database)\)\s*(?:\{\s*)?return ([^\n;]{0,120})/;

/**
 * The ROS-083 guard, in BOTH accessor spellings. server/db.ts exports `getDb`
 * and `getDbTyped`; a guard written with the typed accessor is the same guard,
 * and matching only the untyped one would report a genuinely-guarded procedure
 * as unguarded — the exact false positive that makes a ratchet untrustworthy.
 */
const ROUTER_GUARD = /!\(await getDb(?:Typed)?\(\)\)/;

/**
 * Source with line and block comments removed, string-aware.
 *
 * Deliberately mirrors server/testUtils/sourceAssertions.ts `readCode`, whose
 * docstring records why the naive two-regex version is wrong: `//` inside
 * "https://..." reads as a line comment and silently truncates the rest of the
 * line, which fails in the dangerous direction for a negative assertion.
 *
 * KNOWN LIMITATION, MEASURED rather than assumed: like `readCode`, this does
 * not track REGEX literals, so a regex containing an escaped double-slash
 * (`/https:\/\//`) puts the scanner into line-comment mode and drops the rest
 * of that line — which for this scanner means a MISSED fabrication, the quiet
 * direction. Ten files under server/ contain that pattern. Measured against a
 * no-stripping control on 2026-09-10: stripping loses ZERO helpers and gains
 * NINE (comment blocks had been pushing bodies past the 1200-char window), so
 * it is strictly better here today. Re-measure that comparison before trusting
 * it after a large refactor; do not assume it stays zero.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === NL) { mode = "code"; out += c; }
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; i += 2; } else { i++; }
      continue;
    }
    // inside a string literal
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    out += c;
    if (c === mode) mode = "code";
    i++;
  }
  return out;
}

/** Tracked, non-test sources under a path. */
function trackedSources(appRoot, dir) {
  return execFileSync("git", ["ls-files", dir], {
    cwd: appRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split(NL)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."));
}

/**
 * Exported reads across ALL of server/ whose dead-handle branch returns a
 * value. Map name -> { returns, file }.
 *
 * Only `export async function` is matched, and that is measured rather than
 * assumed: zero non-async exported functions in server/ carry a dead-handle
 * return, because reaching the database is asynchronous here.
 */
export function fabricatingReads(appRoot) {
  const out = new Map();
  for (const rel of trackedSources(appRoot, "server")) {
    let src;
    try {
      src = readFileSync(join(appRoot, rel), "utf8");
    } catch {
      continue; // deleted-but-tracked
    }
    const code = stripComments(src);
    const fn = /export async function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]{0,1200}?)\n\}/g;
    let m;
    while ((m = fn.exec(code)) !== null) {
      const [, name, body] = m;
      const dead = DEAD_HANDLE.exec(body);
      if (!dead) continue;
      const ret = dead[1];
      if (ret.includes("available: false")) continue; // the honest shape
      if (FABRICATED.test(ret)) out.set(name, { returns: ret.trim().slice(0, 60), file: rel });
    }
  }
  return out;
}

/**
 * The subject list: (procedure, helper) pairs where the procedure calls a
 * fabricating read with no guard in its own body. Sorted for a stable diff.
 */
export function scanFabricatedAdminReads(appRoot) {
  const fabricating = fabricatingReads(appRoot);
  const hits = [];

  for (const rel of trackedSources(appRoot, "server/routers")) {
    let src;
    try {
      src = readFileSync(join(appRoot, rel), "utf8");
    } catch {
      continue; // deleted-but-tracked
    }
    const code = stripComments(src);

    // The `db` prefix matters and MUST stay in this pattern. dbAdminProcedure
    // is adminProcedure that has already refused on a dead handle, so it is
    // GUARDED — but if the declaration regex simply failed to match it, the
    // procedure would drop out of the scan entirely and its pair would vanish
    // from the ratchet. Invisible and fixed look identical in a count, and only
    // one of them is true. So: still recognised as a procedure, then skipped
    // for the right reason, below.
    const decl = /^ {2}(\w+):\s*(db)?(Admin|admin|Public|public|Protected|protected)Procedure/gm;
    const marks = [];
    let d;
    while ((d = decl.exec(code)) !== null) {
      marks.push({
        name: d[1],
        tier: d[3].toLowerCase(),
        guardedByBuilder: d[2] === "db",
        at: d.index,
      });
    }

    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].at : code.length;
      const body = code.slice(marks[i].at, end);
      // Declared with a db-prefixed builder: the middleware already threw.
      if (marks[i].guardedByBuilder) continue;
      // A dead-handle guard anywhere in the procedure counts — ROS-083's shape.
      if (ROUTER_GUARD.test(body)) continue;
      for (const [name, info] of fabricating) {
        const called = new RegExp("\\b" + name + "\\s*\\(");
        if (called.test(body)) {
          hits.push({
            file: rel,
            procedure: marks[i].name,
            tier: marks[i].tier,
            helper: name,
            helperFile: info.file,
            returns: info.returns,
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

/**
 * How many procedures the router walk actually SAW, guarded or not.
 *
 * The positive control for a ratchet whose population has reached zero. Once
 * every pair is guarded, "0 pairs" is the correct answer AND the answer a
 * completely broken scanner returns — a decl regex that matched nothing, a
 * git ls-files that returned nothing, a rename that silently dropped every
 * router. This number is what separates them: it stays in the hundreds whether
 * or not anything is still unguarded.
 */
export function scannedProcedureCount(appRoot) {
  let n = 0;
  for (const rel of trackedSources(appRoot, "server/routers")) {
    let src;
    try {
      src = readFileSync(join(appRoot, rel), "utf8");
    } catch {
      continue;
    }
    const decl = /^ {2}(\w+):\s*(db)?(Admin|admin|Public|public|Protected|protected)Procedure/gm;
    while (decl.exec(stripComments(src)) !== null) n++;
  }
  return n;
}

/** Stable identity for baseline comparison. */
export const pairKey = (h) => `${h.file}::${h.procedure}::${h.helper}`;
