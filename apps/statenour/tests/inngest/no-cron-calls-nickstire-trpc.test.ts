import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Q-35 · Sentry NICKSTIRE-2 ("You do not have required permission", ×174 in
 * 14 days, every event at 08:00 UTC with no browser). The caller was the
 * statenour Inngest cron `audit-todays-leads` (`0 8 * * *`), which asked
 * nickstire's tRPC `lead.list` for leads through `callNickstire`.
 *
 * That call can never succeed: `lead.list` is adminProcedure and nickstire's
 * tRPC derives `ctx.user` ONLY from the `app_session_id` cookie, so the Bearer
 * key `callNickstire` sends is ignored (lib/ai/agent-actions/shop-actions.ts
 * header has the full trace). The server correctly denied it every day and the
 * cron did nothing. The fix is on the CALLER: no scheduled function may reach
 * the cookie-only tRPC client, directly or through any helper it imports. The
 * server still denies an unauthenticated lead.list: pinned in
 * apps/nickstire/server/features.test.ts ("lead.list requires admin auth").
 *
 * The guard walks the IMPORT GRAPH (static `from`, dynamic `import()`,
 * `require()`), not the function file's text: a cron that delegates to a helper
 * outside lib/inngest/functions would pass a text scan (Codex review on #2644).
 *
 * Authenticated server-to-server surfaces: `/api/nour-os/query` (x-sync-key,
 * lib/nickstire/query.ts) and REST `/api/bridge/*` (x-bridge-key).
 */

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, "lib/inngest/functions");
const TRPC_CLIENT = path.join(ROOT, "lib/ai/agent-actions/shop-actions.ts");

type ReadFile = (abs: string) => string | undefined;

const diskRead: ReadFile = (abs) => (fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, "utf-8") : undefined);

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm;

/** Resolve a first-party specifier to a file, or undefined for packages / misses. */
function resolve(spec: string, fromFile: string, read: ReadFile): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return undefined;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (read(candidate) !== undefined) return candidate;
  }
  return undefined;
}

/** The import chain from `entry` to `target`, or null when target is unreachable. */
function importChain(entry: string, target: string, read: ReadFile): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: string[][] = [[entry]];
  while (queue.length) {
    const chain = queue.shift()!;
    const file = chain[chain.length - 1];
    if (file === target) return chain;
    const src = read(file) ?? "";
    for (const m of src.matchAll(SPECIFIER)) {
      const next = resolve(m[1], file, read);
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  return null;
}

function functionFiles(): string[] {
  return fs
    .readdirSync(FUNCTIONS_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => path.join(FUNCTIONS_DIR, f));
}

describe("scheduled functions never reach nickstire's cookie-only tRPC client", () => {
  it("catches a DELEGATED call through a helper outside lib/inngest (positive control)", () => {
    // The cron file never names the client; the helper reaches it by dynamic import.
    const cron = path.join(FUNCTIONS_DIR, "planted-cron.ts");
    const helper = path.join(ROOT, "lib/services/planted-helper.ts");
    const virtual: Record<string, string> = {
      [cron]: `import { fetchLeads } from "@/lib/services/planted-helper";\nexport const f = () => fetchLeads();`,
      [helper]: `export async function fetchLeads() {\n  const { callNickstire } = await import("../ai/agent-actions/shop-actions");\n  return callNickstire("lead.list", {});\n}`,
      [TRPC_CLIENT]: "export async function callNickstire() {}",
    };
    const read: ReadFile = (abs) => virtual[abs];
    expect(virtual[cron]).not.toMatch(/callNickstire|shop-actions/); // a text scan would pass this file
    expect(importChain(cron, TRPC_CLIENT, read)).toEqual([cron, helper, TRPC_CLIENT]);
  });

  it("does not flag a function on the authenticated query client (negative control)", () => {
    const cron = path.join(FUNCTIONS_DIR, "planted-clean.ts");
    const virtual: Record<string, string> = {
      [cron]: `import { queryNick } from "@/lib/nickstire/query";`,
      [path.join(ROOT, "lib/nickstire/query.ts")]: "export async function queryNick() {}",
    };
    expect(importChain(cron, TRPC_CLIENT, (abs) => virtual[abs])).toBeNull();
  });

  it("the real graph is actually walked (a zero from an empty scan would be a silent green)", () => {
    expect(functionFiles().length).toBeGreaterThan(10);
    expect(diskRead(TRPC_CLIENT)).toMatch(/export async function callNickstire/);
    // The walker must traverse real first-party imports, not stop at the entry file.
    const index = path.join(FUNCTIONS_DIR, "index.ts");
    expect(importChain(index, path.join(FUNCTIONS_DIR, "approval-sweeper.ts"), diskRead)).not.toBeNull();
  });

  it("no Inngest function reaches callNickstire, directly or transitively", () => {
    const offenders = functionFiles()
      .map((f) => importChain(f, TRPC_CLIENT, diskRead))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map((p) => path.relative(ROOT, p)).join(" -> "));
    expect(offenders).toEqual([]);
  });
});
