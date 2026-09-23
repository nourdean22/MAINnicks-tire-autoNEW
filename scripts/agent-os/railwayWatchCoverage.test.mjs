/**
 * Every Railway service must watch every path its build consumes.
 *
 * ★★★ THE DEFECT, MEASURED 2026-09-18 AGAINST LIVE RAILWAY.
 * `statenour-web` watched `["apps/statenour/**"]` and nothing else, while its
 * Dockerfile copies four workspace packages plus the lockfile. Editing
 * `packages/utils` changed what production WOULD build and did not cause
 * production to build it — the old image kept serving until some unrelated
 * `apps/statenour/**` commit happened to trigger a rebuild. `statenour-worker`
 * had the same gap on `packages/reel-engine`; `nicks-tire-auto` — the PUBLIC
 * site — had it on `@nour/{utils,gbp-publisher,meta-ads-architect}`.
 *
 * ★ This failure is worse than the one ADR-0014 recorded. That produced nine
 *   loud red deploys. This produces NOTHING: no failed build, no alert, no red
 *   dashboard — just an artifact that quietly does not match `main`. The only
 *   symptom is a fix that "didn't work" for reasons nobody can reproduce.
 *
 * ── WHY THIS LIVES IN scripts/agent-os/ AND NOT IN A VITEST SUITE ──────
 * It started as `apps/statenour/tests/deploy/`. Review caught that the worker
 * assertion could never fire on a worker-only diff: CI selects work with
 * `turbo --affected`, `@statenour/worker` has no `test` script, and nothing
 * draws an edge from a worker change to statenour's suite. A cross-service
 * invariant parked inside ONE service's tests is a gate that is absent exactly
 * when the other service changes — the "gate reachability" failure this
 * directory already has a test for (`gateReachability.test.mjs`).
 *
 * `agent-policy.yml` runs `verify.mjs` on EVERY pull request, Node-only, no
 * turbo and no affected-detection, and auto-discovers `*.test.mjs` here. So a
 * nickstire-only or worker-only PR runs this check. The workflow file is
 * deliberately NOT edited — per its own header, touching `.github/workflows/**`
 * flips test.yml's path filter into a ~50-minute full sweep.
 *
 * ── WHAT IS DERIVED, AND WHY NOT FROM THE DOCKERFILE ───────────────────
 * Required inputs come from `package.json` (workspace deps, transitively) and
 * from root `pnpm.patchedDependencies` — the CAUSES that `turbo prune` and the
 * frozen install actually read. The Dockerfile's `COPY` lines are a
 * hand-maintained echo of that; asserting against the echo would pass happily
 * on the day the two drift, which is exactly the day a package silently stops
 * deploying. A separate assertion catches the reverse drift.
 *
 * ⚠ COVERAGE, NOT EQUALITY. Extra patterns only cost an unnecessary rebuild; a
 * missing one is the bug. This gate can therefore only push toward deploying
 * more often, never less — the safe direction for a check whose failure mode is
 * "production quietly runs stale code".
 *
 * ── HOW IT IS ITSELF PROVEN ────────────────────────────────────────────
 * `covers()` and `missingPatterns()` are pure — text in, findings out — and the
 * fixtures below include the exact live misconfiguration, the helper-guarded
 * shapes, and the narrower-subtree case that an earlier version of `covers()`
 * wrongly accepted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Services that build from this monorepo and deploy from a Railway service. */
const SERVICES = [
  { app: "apps/statenour", label: "statenour-web", service: "statenour-web" },
  { app: "apps/worker", label: "statenour-worker", service: "statenour-worker" },
  // `label` is the pnpm package name; `service` is what Railway calls it. They
  // differ for nickstire, and reading railway.ts needs the Railway one.
  { app: "apps/nickstire", label: "nicks-tire-auto", service: "MAINnicks-tire-auto" },
];

/** Inputs every build reads regardless of app. */
const ALWAYS_REQUIRED = ["pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", "turbo.json"];

/**
 * Does `pattern` cause `required` to be watched?
 *
 * ⚠⚠ A PATTERN NARROWER THAN THE REQUIRED PATH DOES NOT COUNT, and an earlier
 * version of this function got that wrong. It accepted
 * `packages/utils/src/**` as coverage for `packages/utils`, because it also
 * returned true when the pattern's prefix was a DESCENDANT of the requirement.
 * A config watching only `src/**` misses `packages/utils/package.json`,
 * `tsconfig.json` and its build scripts — all real build inputs — so the gate
 * would have passed a materially broken configuration. Only a prefix EQUAL TO
 * or an ANCESTOR of the requirement is coverage.
 */
export function covers(pattern, required) {
  // A negation EXCLUDES; it can never be what makes a path watched.
  if (String(pattern).startsWith("!")) return false;
  if (pattern === "**" || pattern === "**/*") return true;
  const prefix = String(pattern).replace(/\/\*\*(\/\*)?$/, "").replace(/\/$/, "");
  if (prefix === required) return true;
  return required.startsWith(`${prefix}/`);
}

export function missingPatterns(required, patterns) {
  return required.filter((r) => !patterns.some((p) => covers(p, r)));
}

/** package name -> directory, for every workspace package. */
function packageDirs() {
  const out = new Map();
  for (const d of readdirSync(join(REPO, "packages"))) {
    const manifest = join(REPO, "packages", d, "package.json");
    if (!existsSync(manifest)) continue;
    out.set(readJson(manifest).name, `packages/${d}`);
  }
  return out;
}

/** Transitive workspace-package closure for an app, as directories. */
export function workspaceClosure(appDir) {
  const byName = packageDirs();
  const seen = new Set();
  const depsOf = (p) => {
    const m = readJson(join(REPO, p, "package.json"));
    const deps = { ...(m.dependencies ?? {}), ...(m.devDependencies ?? {}) };
    return Object.entries(deps)
      .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
      .map(([k]) => k);
  };
  const stack = depsOf(appDir);
  while (stack.length > 0) {
    const name = stack.pop();
    const dir = byName.get(name);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    stack.push(...depsOf(dir));
  }
  return [...seen].sort();
}

/**
 * Patch files the frozen install applies, from root `pnpm.patchedDependencies`.
 *
 * ⚠ DERIVED, NOT HARD-CODED. Both the statenour and worker Dockerfiles
 * explicitly `COPY apps/nickstire/patches` before their frozen install, so a
 * patch edit changes all three images. Nothing watched that path. Reading it
 * from the manifest means adding a second patch cannot reopen the hole.
 */
export function patchInputs() {
  const root = readJson(join(REPO, "package.json"));
  const patched = root?.pnpm?.patchedDependencies ?? {};
  return [...new Set(Object.values(patched).map((p) => String(p).replace(/\\/g, "/")))].sort();
}

/**
 * Watch patterns this service declares in `.railway/railway.ts`, or null.
 *
 * THE SOURCE OF TRUTH MOVED (2026-09-18). railway.json / railway.toml is
 * deprecated with a HARD CUTOFF of 2026-12-01; the effective config now lives in
 * `.railway/railway.ts` (Railway Infrastructure as Code, applied 2026-09-18).
 *
 * This gate used to read ONLY apps/<app>/railway.json and assert it existed.
 * Both halves became wrong the moment the migration landed: deleting the legacy
 * files -- the documented final step of the handover -- would have turned this
 * gate RED, while dropping a `packages/**` entry from railway.ts would have left
 * it GREEN as production silently stopped redeploying on that package. A gate
 * that reads the file which no longer decides anything is not a gate.
 *
 * Parsed with a regex rather than imported: railway.ts imports `railway/iac`,
 * which is not a dependency of this repo, so importing it would fail the gate
 * for an unrelated reason. A parse miss returns null and the caller REFUSES --
 * it never degrades quietly to "no patterns required".
 */
export function iacWatchPatterns(serviceName) {
  const p = join(REPO, ".railway", "railway.ts");
  if (!existsSync(p)) return null;
  const src = readFileSync(p, "utf8");
  const start = src.indexOf("service(" + JSON.stringify(serviceName));
  if (start === -1) return null;
  // Bound the slice to this service's own block, so the NEXT service's
  // patterns can never be read as this one's.
  const next = src.indexOf("service(", start + 10);
  const block = src.slice(start, next === -1 ? undefined : next);
  // Strings only, so a `]` inside a pattern (a character class) cannot end the
  // array early and hide every later entry. Anything else fails to parse -> null.
  const m = block.match(/watchPatterns:\s*\[((?:\s*"[^"]*"\s*,?)*)\s*\]/);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * ── NEGATIONS · `!pattern` entries that stop doc-only commits redeploying ──
 *
 * Measured 2026-09-22/23: the shop server deployed 32 times in 13.5 hours and 8
 * of those were documentation-only commits, because `apps/nickstire/**` watches
 * everything. Each deploy restarts ~118 in-process scheduled jobs and the SMS
 * queue. Railway watch paths are gitignore-style and a `!` line after an
 * include excludes (docs.railway.com/builds/build-configuration).
 *
 * ⚠⚠ A NEGATION IS THE ONE EDIT THAT MOVES THIS GATE TOWARD DEPLOYING LESS, so
 * it is only allowed where an input has been PROVEN not to be one. Every path
 * inside an app is treated as a build/runtime input unless NON_INPUTS below
 * names it, with the evidence. A negation that could exclude any required path
 * (a declared input, a workspace package, a patch, a root manifest) fails.
 *
 * `keep` lists sub-paths of a non-input that ARE inputs and must stay watched.
 * nickstire's `docs/reel-packs` is the live example: the server reads it at
 * RUNTIME (server/services/reelPackRegistry.ts -> approvedReelPackRotation.ts
 * -> cron/jobs/dailyReelPost.ts), so a pack edit must redeploy. That is why
 * the IaC file negates each other docs/ subdirectory by name instead of
 * `!apps/nickstire/docs/**` plus a re-include: git cannot re-include a file
 * whose parent directory is excluded, and Railway does not document otherwise.
 *
 * Evidence (2026-09-23, grep of every non-doc tracked file in the app for a
 * `docs/` path, a `"docs"` path segment, `?raw`, `import.meta.glob`, and
 * readFile/readdir of `.md`): outside reel-packs, `apps/nickstire/docs/**` is
 * read only by tests (*.test.ts) and dev scripts (scripts/*.mjs), never by
 * `vite build`, the esbuild server bundle, `scripts/build-maybe-prerender.mjs`
 * or server code; `.remember/` is read by nothing. apps/worker's three .md files
 * are read by nothing and its Dockerfile copies no .md individually.
 * NOT excluded: `apps/statenour/docs/**`. The server reads it at runtime
 * (app/api/cron/subtask-usage-audit reads docs/adr/0017, lib/services/
 * system-change-digest.ts and lib/evals/memory-eval-report.ts read the
 * memory-eval grounding docs), so it has no entry here.
 */
export const NON_INPUTS = {
  "MAINnicks-tire-auto": { ".remember": [], docs: ["reel-packs"] },
  "statenour-worker": { "AGENTS.md": [], "CLAUDE.md": [], "DEPLOY.md": [] },
};

/** Every top-level path of the app, minus proven non-inputs (plus their `keep`s). */
export function appInputs(app, service) {
  const nonInputs = NON_INPUTS[service] ?? {};
  const out = [];
  for (const child of readdirSync(join(REPO, app))) {
    if (Object.hasOwn(nonInputs, child)) out.push(...nonInputs[child].map((k) => `${app}/${child}/${k}`));
    else out.push(`${app}/${child}`);
  }
  return out.sort();
}

const segmentRe = (seg) =>
  new RegExp(
    "^" +
      seg
        .replace(/[.+^${}()|\\]/g, "\\$&")
        .replace(/\[!/g, "[^")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]") +
      "$",
  );

/**
 * Could the negation `negation` stop a change under `required` from deploying?
 *
 * Deliberately conservative, in gitignore terms:
 *  - a pattern with no inner `/` matches at ANY depth (`!*.md` is `!**\/*.md`);
 *  - matching an ANCESTOR of `required` excludes all of it (git excludes the
 *    directory's contents);
 *  - matching something INSIDE `required` is a partial exclusion, also a fail,
 *    unless `required` is a file (`isFile`), which has nothing inside it.
 */
export function negationExcludes(negation, required, isFile = false) {
  let body = String(negation).replace(/^!/, "").replace(/\/$/, "");
  body = body.startsWith("/") ? body.slice(1) : body.includes("/") ? body : `**/${body}`;
  const n = body.split("/");
  const r = required.split("/");
  const walk = (i, j) => {
    if (i === n.length) return true;
    if (j === r.length) return !isFile;
    if (n[i] === "**") return walk(i + 1, j) || walk(i, j + 1);
    return segmentRe(n[i]).test(r[j]) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

/** `{ negation, required }` for every required path some negation could exclude. */
export function excludedInputs(required, patterns, isFile = () => false) {
  const out = [];
  for (const neg of patterns.filter((p) => String(p).startsWith("!"))) {
    for (const r of required) if (negationExcludes(neg, r, isFile(r))) out.push({ negation: neg, required: r });
  }
  return out;
}

/**
 * Negations that no EARLIER include covers. Railway: "negations will only work
 * if you include files in a preceding rule" — so such a line silently does
 * nothing. Harmless, but it means the fix it was written for is not live.
 */
export function inertNegations(patterns) {
  return patterns.filter((p, k) => {
    if (!String(p).startsWith("!")) return false;
    const segs = p.slice(1).replace(/^\//, "").split("/");
    const firstGlob = segs.findIndex((s) => /[*?[]/.test(s));
    const prefix = segs.slice(0, firstGlob === -1 ? segs.length : firstGlob).join("/");
    return !patterns.slice(0, k).some((inc) => covers(inc, prefix));
  });
}

const isRepoFile = (rel) => {
  try {
    return statSync(join(REPO, rel)).isFile();
  } catch {
    return false; // absent: treat as a directory, the stricter reading
  }
};

for (const { app, label, service } of SERVICES) {
  test(`${label}: no negation excludes a build or runtime input`, () => {
    const patterns = iacWatchPatterns(service);
    assert.ok(patterns && patterns.length > 0, `could not read ${service} watchPatterns from .railway/railway.ts`);

    for (const [child, keeps] of Object.entries(NON_INPUTS[service] ?? {})) {
      for (const k of keeps) {
        assert.ok(
          existsSync(join(REPO, app, child, k)),
          `NON_INPUTS keeps ${app}/${child}/${k}, which no longer exists. It moved, so the runtime ` +
            `input it protected is now unprotected. Find its new path and keep that instead.`,
        );
      }
    }

    // Any tree this service watches OUTSIDE its own app (e.g. the worker's
    // apps/statenour/lib) is assumed to be an input: nothing proves otherwise.
    const watchedElsewhere = patterns
      .filter((p) => !p.startsWith("!"))
      .map((p) => p.replace(/\/\*\*(\/\*)?$/, "").replace(/\/$/, ""))
      .filter((p) => !/[*?[]/.test(p) && p !== app && !p.startsWith(`${app}/`));
    const required = [...new Set([
      ...appInputs(app, service),
      ...watchedElsewhere,
      ...workspaceClosure(app),
      ...patchInputs(),
      ...ALWAYS_REQUIRED,
    ])];
    const hits = excludedInputs(required, patterns, isRepoFile);
    assert.deepEqual(
      hits,
      [],
      `${label}: these negations could stop a change to a real input from redeploying, so production ` +
        `would keep serving the old build:\n` +
        hits.map((h) => `    - ${h.negation}  excludes  ${h.required}`).join("\n") +
        `\nOnly negate paths listed in NON_INPUTS (scripts/agent-os/railwayWatchCoverage.test.mjs), with evidence.`,
    );

    assert.deepEqual(inertNegations(patterns), [], `${label}: negation(s) with no preceding include do nothing`);
  });
}

for (const { app, label, service } of SERVICES) {
  test(`${label} watches everything its build consumes`, () => {
    const iac = iacWatchPatterns(service);
    const cfgPath = join(REPO, app, "railway.json");
    const legacy = existsSync(cfgPath) ? (readJson(cfgPath)?.build?.watchPatterns ?? null) : null;

    assert.ok(
      (iac && iac.length > 0) || (legacy && legacy.length > 0),
      `${service} declares watchPatterns in NEITHER .railway/railway.ts NOR ${app}/railway.json. ` +
        `Railway then falls back to the dashboard setting, which is invisible to code review and ` +
        `was measured WRONG on 2026-09-18: 1 pattern live against 10 in the repo.`,
    );

    // Both present = mid-migration. They MUST agree, because which one wins
    // depends on the 2026-12-01 cutoff rather than on anything in this repo.
    if (iac && legacy) {
      assert.deepEqual(
        [...iac].sort(),
        [...legacy].sort(),
        `${service}: .railway/railway.ts and ${app}/railway.json declare DIFFERENT watchPatterns. ` +
          `Until 2026-12-01 the JSON wins at deploy time and the .ts wins afterwards, so this is a ` +
          `dated time bomb, not a preference.`,
      );
    }

    const patterns = iac ?? legacy;

    const required = [app, ...workspaceClosure(app), ...patchInputs(), ...ALWAYS_REQUIRED];
    const missing = missingPatterns(required, patterns);
    assert.deepEqual(
      missing,
      [],
      `${label} builds from these paths but does not watch them, so changing one would NOT ` +
        `redeploy it and production would keep serving the old build:\n` +
        missing.map((m) => `    - ${m}`).join("\n"),
    );
  });
}

test("a Dockerfile's copied packages are a subset of the declared closure", () => {
  // Reverse drift: a COPY added without a matching workspace dependency would
  // be in the image but absent from the closure this gate derives — silently
  // unwatched while the gate still passed.
  for (const { app, label } of SERVICES) {
    const df = join(REPO, app, "Dockerfile");
    if (!existsSync(df)) continue; // nickstire builds via RAILPACK, no Dockerfile
    const copied = [...readFileSync(df, "utf8").matchAll(/\/repo\/(packages\/[a-z0-9-]+)\//g)].map(
      (m) => m[1],
    );
    const closure = new Set(workspaceClosure(app));
    const strays = [...new Set(copied)].filter((p) => !closure.has(p));
    assert.deepEqual(
      strays,
      [],
      `${label}: Dockerfile copies ${strays.join(", ")} but package.json declares no workspace ` +
        `dependency on it — the closure this gate derives would miss it.`,
    );
  }
});

// ── MUTATION FIXTURES · a coverage check that can only pass proves nothing ──

test("MUTATION · detects the exact live misconfiguration measured 2026-09-18", () => {
  assert.deepEqual(missingPatterns(["apps/statenour", "packages/utils", "pnpm-lock.yaml"], ["apps/statenour/**"]), [
    "packages/utils",
    "pnpm-lock.yaml",
  ]);
});

test("MUTATION · a pattern NARROWER than the requirement is not coverage", () => {
  // The hole review found: `packages/utils/src/**` misses package.json,
  // tsconfig.json and the build scripts, all of which change the image.
  assert.equal(covers("packages/utils/src/**", "packages/utils"), false);
  assert.deepEqual(missingPatterns(["packages/utils"], ["packages/utils/src/**"]), ["packages/utils"]);
});

test("MUTATION · equal and ancestor prefixes ARE coverage", () => {
  assert.equal(covers("packages/utils/**", "packages/utils"), true);
  assert.equal(covers("packages/**", "packages/utils"), true);
  assert.equal(covers("apps/nickstire/**", "apps/nickstire/patches/wouter@3.7.1.patch"), true);
});

test("MUTATION · a DIFFERENT package is not coverage", () => {
  assert.equal(covers("packages/lenses/**", "packages/utils"), false);
});

test("MUTATION · an empty pattern list covers nothing", () => {
  assert.deepEqual(missingPatterns(["apps/statenour"], []), ["apps/statenour"]);
});

test("patchInputs is derived from the manifest and is non-empty today", () => {
  const p = patchInputs();
  assert.ok(
    p.length > 0 && p.every((x) => x.endsWith(".patch")),
    `expected patch paths from root pnpm.patchedDependencies, got ${JSON.stringify(p)}`,
  );
});

// ── NEGATION FIXTURES · a negation gate that cannot go red would bless any exclusion ──

test("MUTATION · negating a workspace package is caught", () => {
  const hits = excludedInputs(["packages/utils", "apps/nickstire/server"], ["apps/nickstire/**", "packages/utils/**", "!packages/utils/**"]);
  assert.deepEqual(hits, [{ negation: "!packages/utils/**", required: "packages/utils" }]);
});

test("MUTATION · a blanket docs negation is caught when a runtime input lives inside docs", () => {
  assert.equal(negationExcludes("!apps/nickstire/docs/**", "apps/nickstire/docs/reel-packs"), true);
  assert.equal(negationExcludes("!apps/nickstire/docs/*", "apps/nickstire/docs/reel-packs"), true);
  assert.equal(negationExcludes("!apps/nickstire/**", "apps/nickstire/server"), true);
  assert.equal(negationExcludes("!apps/nickstire/docs/audits/**", "apps/nickstire/docs/reel-packs"), false);
  assert.equal(negationExcludes("!apps/nickstire/docs/*.md", "apps/nickstire/docs/reel-packs"), false);
});

test("MUTATION · an ancestor, a descendant, and an unanchored basename all count as excluding", () => {
  assert.equal(negationExcludes("!packages/**", "packages/utils"), true); // ancestor
  assert.equal(negationExcludes("!packages/utils/src/**", "packages/utils"), true); // partial
  assert.equal(negationExcludes("!*.json", "package.json", true), true); // any depth
  assert.equal(negationExcludes("!*.md", "apps/nickstire/README.md", true), true);
  assert.equal(negationExcludes("!apps/worker/AGENTS.md", "package.json", true), false);
  assert.equal(negationExcludes("!packages/utils/README.md", "pnpm-lock.yaml", true), false);
});

test("MUTATION · a negation with no preceding include is reported as inert", () => {
  assert.deepEqual(inertNegations(["!apps/nickstire/docs/**", "apps/nickstire/**"]), ["!apps/nickstire/docs/**"]);
  assert.deepEqual(inertNegations(["apps/nickstire/**", "!apps/nickstire/docs/*.md"]), []);
});

test("MUTATION · a character class cannot truncate the parsed pattern list", () => {
  assert.equal(negationExcludes("!packages/[u]tils/**", "packages/utils"), true);
  assert.equal(negationExcludes("!packages/[!u]tils/**", "packages/utils"), false);
  assert.equal(negationExcludes("!packages/[!x]tils/**", "packages/utils"), true);
});

test("MUTATION · a negation never counts as coverage", () => {
  assert.deepEqual(missingPatterns(["packages/utils"], ["!packages/utils/**"]), ["packages/utils"]);
});
