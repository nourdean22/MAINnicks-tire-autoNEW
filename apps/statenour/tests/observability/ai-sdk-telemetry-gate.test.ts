/**
 * tests/observability/ai-sdk-telemetry-gate.test.ts · 2026-09-02
 *
 * Positive control on 2026-09-02, before the Langfuse pass: 20 of 22 AI SDK
 * call sites carried no `experimental_telemetry` at all — only nick-chat was
 * traced (one block, spread into stream-with-fallback), and /system's
 * "langfuse: true" would have vouched for the other twenty. Same defect shape as the prompt-fencing gates: one instrumented
 * site vouching for a whole surface.
 *
 * So: ENUMERATE every generateText / streamText / generateObject /
 * streamObject call under lib/ and app/, ASSERT each builds its block
 * through langfuseTelemetry() (or is allowlisted with a reason), and keep an
 * INVERSE check (the scanner must still see the surface) plus a MUTATION
 * CANARY (strip one block in memory → exactly that site goes bare).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CALL_RE = /\b(generateText|streamText|generateObject|streamObject)\(\{/;

/** Sites that deliberately carry no telemetry. Every entry needs a reason. */
const ALLOWLIST: Array<{ file: string; match: RegExp; reason: string }> = [
  {
    file: "lib/ai/structured.ts",
    match: /health|ready|ping|warm/i,
    reason: "1-token readiness probe with no user content; tracing it would only add noise traces",
  },
  {
    file: "app/api/system/observability-probe/route.ts",
    match: /experimental_telemetry:\s*telemetry,/,
    reason:
      "builds its block through langfuseTelemetry() into a local FIRST so the probe can refuse to burn a model call when telemetry is disabled (review finding on #2079); the handover is asserted in tests/api/observability-probe.test.ts",
  },
  {
    file: "lib/ai/stream-with-fallback.ts",
    match: /\.\.\.config,/,
    reason: "spreads the nick-chat config built by app/api/ai/chat/build-stream-config.ts, whose langfuseTelemetry block is pinned by tests/ai/chat/build-stream-config-telemetry.test.ts",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export interface Site {
  file: string;
  line: number;
  kind: string;
  /** The call's argument text up to the matching close brace. */
  body: string;
}

/** Extract every non-comment call site with its balanced argument body. */
export function scanSites(source: string, file: string): Site[] {
  const lines = source.split("\n");
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    const m = CALL_RE.exec(lines[i]);
    if (!m) continue;
    // Balanced-brace walk from the opening `{`.
    const start = source.split("\n").slice(0, i).join("\n").length + (i > 0 ? 1 : 0) + m.index + m[0].length - 1;
    let depth = 0;
    let end = start;
    for (let k = start; k < source.length; k++) {
      const ch = source[k];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    sites.push({ file, line: i + 1, kind: m[1], body: source.slice(start, end + 1) });
  }
  return sites;
}

export function isInstrumented(site: Site): boolean {
  return /experimental_telemetry\s*:\s*langfuseTelemetry\(/.test(site.body);
}

function allSites(): Site[] {
  const files = [...walk(join(APP_ROOT, "lib")), ...walk(join(APP_ROOT, "app"))];
  return files.flatMap((f) => scanSites(readFileSync(f, "utf8"), relative(APP_ROOT, f).replace(/\\/g, "/")));
}

function allowed(site: Site): string | null {
  const hit = ALLOWLIST.find((a) => a.file === site.file && a.match.test(site.body));
  return hit ? hit.reason : null;
}

describe("AI SDK telemetry gate · every model call is traced through langfuseTelemetry()", () => {
  const sites = allSites();

  it("inverse check: the scanner still sees the surface (>= 20 call sites under lib/ + app/)", () => {
    expect(sites.length, sites.map((s) => `${s.file}:${s.line}`).join("\n")).toBeGreaterThanOrEqual(20);
  });

  it("no bare call site: each generateText/streamText/generateObject/streamObject builds experimental_telemetry via langfuseTelemetry(), or is allowlisted with a reason", () => {
    const bare = sites.filter((s) => !isInstrumented(s) && !allowed(s)).map((s) => `${s.file}:${s.line} (${s.kind})`);
    expect(bare, "AI SDK calls with no Langfuse telemetry block").toEqual([]);
  });

  it("the allowlist only names sites that exist (an entry outliving its subject would vouch for nothing)", () => {
    for (const a of ALLOWLIST) {
      const hits = sites.filter((s) => s.file === a.file && a.match.test(s.body));
      expect(hits.length, `${a.file} /${a.match.source}/ matches no call site`).toBeGreaterThanOrEqual(1);
    }
  });

  it("trace names are kebab-case string literals and unique across the tree (provider defaults are templated per task type)", () => {
    const names = new Map<string, string[]>();
    for (const s of sites) {
      const m = /functionId:\s*"([^"]+)"/.exec(s.body);
      if (!m) continue;
      expect(m[1], `${s.file}:${s.line} functionId`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      names.set(m[1], [...(names.get(m[1]) ?? []), `${s.file}:${s.line}`]);
    }
    const dupes = [...names.entries()].filter(([, where]) => where.length > 1);
    expect(dupes, "two call sites sharing one trace name").toEqual([]);
    expect(names.size, "at least a dozen distinct literal trace names").toBeGreaterThanOrEqual(12);
  });

  it("MUTATION CANARY: stripping one telemetry block in memory makes exactly that site go bare", () => {
    const instrumented = sites.find((s) => isInstrumented(s) && s.file.endsWith("lib/intelligence/scoring.ts"));
    expect(instrumented, "scoring.ts is instrumented").toBeTruthy();
    const source = readFileSync(join(APP_ROOT, instrumented!.file), "utf8");
    const mutated = source.replace(/^\s*experimental_telemetry:\s*langfuseTelemetry\([^\n]*\n/m, "");
    expect(mutated).not.toBe(source);
    const before = scanSites(source, instrumented!.file).filter((s) => !isInstrumented(s)).length;
    const after = scanSites(mutated, instrumented!.file).filter((s) => !isInstrumented(s)).length;
    expect(before).toBe(0);
    expect(after).toBe(1);
  });
});
