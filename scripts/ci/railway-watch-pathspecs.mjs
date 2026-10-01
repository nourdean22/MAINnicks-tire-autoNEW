#!/usr/bin/env node
/**
 * Git pathspecs for the paths a Railway service redeploys on, read from its
 * `watchPatterns` in `.railway/railway.ts` (the only build/deploy config in the
 * repo since 2026-09-18).
 *
 * WHY. `.github/workflows/deploy-drift.yml` asks whether bdnick.info serves the
 * newest main commit that Railway should have deployed. It used to answer from
 * its own path list, which counted every `packages/**` change. statenour-web
 * watches four packages. On 2026-10-01 two nickstire-only commits touched
 * packages/meta-ads-architect (#2865, #2863); Railway correctly did not rebuild
 * statenour-web, and the observer reported DRIFT every 30 minutes from 18:20Z.
 * Reading the watch patterns makes the observer expect exactly what Railway
 * deploys on, and an edit to railway.ts moves both at once.
 *
 * SEMANTICS. Railway watch paths are gitignore-style
 * (docs.railway.com/builds/build-configuration), and production agrees on the
 * any-depth rule: e6eb59442f matched statenour-web's patterns only through
 * apps/nickstire/package.json, and statenour-web was serving it at 04:18Z on
 * 2026-09-23 (deploy-drift run 35817756035). So:
 *   - a pattern with no slash, or only a trailing one, matches at any depth
 *     (`package.json` -> `**\/package.json`);
 *   - a leading `/` anchors it at the repo root;
 *   - a trailing `/` names a directory, and a directory covers what is under it;
 *   - `!pattern` excludes.
 * Each becomes a `:(glob)` or `:(exclude,glob)` pathspec. Git's glob uses the
 * same rules: `*` stops at `/`, `**` crosses it, a matched directory includes
 * its contents.
 *
 * ORDER. gitignore lets a later pattern re-include what an earlier `!` removed;
 * a git exclude pathspec always wins. A list with a pattern after a negation is
 * therefore refused instead of translated into something narrower than what
 * Railway deploys on.
 *
 * DESIRED, NOT LIVE. railway.ts is the state the next `railway config apply`
 * writes. statenour-web's list has been the same in every version since the
 * 2026-09-18 apply. If an edit to it lands before the apply, the observer
 * expects the new list early: an added path reads as DRIFT (apply the plan), a
 * removed one only makes it expect less.
 *
 * FAILS CLOSED. An unknown service, an unreadable list, an empty pattern, a list
 * with no include, or the ordering above exits 1 with the reason. The caller
 * must treat that as a failed check, never as "no paths".
 *
 * Usage: node scripts/ci/railway-watch-pathspecs.mjs <service> [path/to/railway.ts]
 * Prints one pathspec per line.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The service's watchPatterns, or null when the file does not state them. */
export function watchPatterns(source, serviceName) {
  const start = source.indexOf("service(" + JSON.stringify(serviceName));
  if (start === -1) return null;
  // Only this service's own block, so the next service's list can never be read.
  const next = source.indexOf("service(", start + 1);
  const block = source.slice(start, next === -1 ? undefined : next);
  // Strings only: anything else in the array fails the match and returns null.
  const m = block.match(/watchPatterns:\s*\[((?:\s*"[^"]*"\s*,?)*)\s*\]/);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

/** One gitignore-style watch pattern as one git pathspec. */
export function toPathspec(pattern) {
  let body = String(pattern).trim();
  const negated = body.startsWith("!");
  if (negated) body = body.slice(1);
  body = body.replace(/\/+$/, "");
  const anchored = body.includes("/");
  body = body.replace(/^\/+/, "");
  if (!body) throw new Error(`empty watch pattern ${JSON.stringify(pattern)}`);
  if (!anchored) body = `**/${body}`;
  return `${negated ? ":(exclude,glob)" : ":(glob)"}${body}`;
}

export function toPathspecs(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("no watch patterns");
  }
  const firstNegation = patterns.findIndex((p) => String(p).trim().startsWith("!"));
  if (firstNegation !== -1) {
    const later = patterns.slice(firstNegation + 1).find((p) => !String(p).trim().startsWith("!"));
    if (later !== undefined) {
      throw new Error(
        `pattern ${JSON.stringify(later)} follows a negation; gitignore order can re-include ` +
          "what a git exclude pathspec always drops, so this list cannot be translated safely",
      );
    }
  }
  const specs = patterns.map(toPathspec);
  if (!specs.some((s) => s.startsWith(":(glob)"))) throw new Error("no include pattern");
  return specs;
}

function main(argv) {
  const [service, file = join(REPO, ".railway", "railway.ts")] = argv;
  if (!service) throw new Error("usage: railway-watch-pathspecs.mjs <service> [railway.ts]");
  const patterns = watchPatterns(readFileSync(file, "utf8"), service);
  if (patterns === null) throw new Error(`no watchPatterns for service ${JSON.stringify(service)} in ${file}`);
  process.stdout.write(toPathspecs(patterns).join("\n") + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`railway-watch-pathspecs: ${err.message}\n`);
    process.exit(1);
  }
}
