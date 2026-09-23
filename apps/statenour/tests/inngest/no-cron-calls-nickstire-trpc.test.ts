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
 * cron did nothing. The fix is on the CALLER: no scheduled function may call
 * the cookie-only tRPC surface. The server still denies an unauthenticated
 * lead.list: pinned in apps/nickstire/server/features.test.ts
 * ("lead.list requires admin auth").
 *
 * Authenticated server-to-server surfaces: `/api/nour-os/query` (x-sync-key,
 * lib/nickstire/query.ts) and REST `/api/bridge/*` (x-bridge-key).
 */

const FUNCTIONS_DIR = path.join(process.cwd(), "lib/inngest/functions");

/** Files under lib/inngest/functions whose source calls the tRPC client. */
function trpcCallers(sources: Array<{ file: string; src: string }>): string[] {
  return sources
    .filter(({ src }) => /\bcallNickstire\s*\(/.test(src) || /agent-actions\/shop-actions/.test(src))
    .map(({ file }) => file);
}

function readFunctionSources() {
  return fs
    .readdirSync(FUNCTIONS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((file) => ({ file, src: fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8") }));
}

describe("scheduled functions never call nickstire's cookie-only tRPC", () => {
  it("the scanner flags a planted caller (positive control)", () => {
    const planted = [
      { file: "planted.ts", src: `const { callNickstire } = await import("@/lib/ai/agent-actions/shop-actions");\nawait callNickstire("lead.list", {});` },
      { file: "clean.ts", src: `import { queryNick } from "@/lib/nickstire/query";` },
    ];
    expect(trpcCallers(planted)).toEqual(["planted.ts"]);
  });

  it("the functions directory is actually scanned", () => {
    // A zero from an empty directory would be a silent green.
    expect(readFunctionSources().length).toBeGreaterThan(10);
  });

  it("no Inngest function imports or calls callNickstire", () => {
    expect(trpcCallers(readFunctionSources())).toEqual([]);
  });
});
