/**
 * Meta tools — introspection + sandboxed exec + browser automation.
 *
 * Includes: toolHealth · getCronStatus · runCode ·
 * runPython · browser_*. The "tools about tools" + things that don't
 * fit elsewhere.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// BDN-201 · lazy memo for searchTools: computing ~180 zod→JSON-schema
// conversions per call is wasteful — the catalog is static per process,
// so build the name→schema index once.
let schemaIndexMemo: Map<string, { name: string; description?: string; inputSchema?: unknown }> | null = null;
async function getSchemaIndex(): Promise<NonNullable<typeof schemaIndexMemo>> {
  if (!schemaIndexMemo) {
    const { computeToolSchemas } = await import("@/lib/ai/tools/schema-digest");
    const entries = computeToolSchemas() as Array<{ name: string; description?: string; inputSchema?: unknown }>;
    schemaIndexMemo = new Map(entries.map((e) => [e.name, e]));
  }
  return schemaIndexMemo;
}

// ── Sandbox for MODEL-WRITTEN JavaScript (runCode, queryData) ─────────────
// node:vm is NOT a security boundary: any host-realm object or function the
// context can reach hands over the host Function constructor, and with it
// process.env, fetch and process.getBuiltinModule (S3/S9 red team, 2026-10-10;
// pinned in tests/ai/code-sandbox-escape.test.ts). So the context holds ONLY
// its own ECMAScript built-ins, data crosses as JSON text, and the host reads
// nothing from it but string own properties (no sandbox getter or trap runs on
// the host). Each line below closes a path verified on Node 24:
//   - codeGeneration off: no eval / Function / wasm, in any realm reached.
//   - microtaskMode afterEvaluate: awaits drain INSIDE the timeout; on the
//     host's queue an await loop would block the whole server.
//   - `import` refused before compiling: import() rejects with a HOST-realm
//     error, and the keyword cannot be spelled with escapes.
//   - Symbol.for deleted: the host logs an unhandled rejection with
//     util.inspect, which passes its own inspect function to a
//     Symbol.for('nodejs.util.inspect.custom') method.
//   - FinalizationRegistry deleted: its callbacks run later, outside the timeout.
const SANDBOX_PRELUDE = `
delete Symbol.for; delete Symbol.keyFor; delete globalThis.FinalizationRegistry;
const __logs = [];
globalThis.console = { log: (...a) => { __logs.push(a.map(String).join(" ")); } };
const __finish = (run) => new Promise((resolve) => resolve(run())).then(
  (v) => { globalThis.__out = JSON.stringify({ ok: true, value: v === undefined ? null : v, logs: __logs }); },
  (e) => {
    let m = "error";
    try { m = String(e instanceof Error ? e.message : e); } catch {}
    globalThis.__out = JSON.stringify({ ok: false, error: m, logs: __logs });
  },
).catch(() => { globalThis.__out = JSON.stringify({ ok: false, error: "the result is not JSON-serializable", logs: __logs }); });
`;

type SandboxOutcome = { ok: true; value: unknown; logs: string[] } | { ok: false; error: string };

/** null when the code may run; otherwise the refusal to return to the model. */
function sandboxRefusal(code: string): string | null {
  return /\bimport\b/.test(code)
    ? "`import` is not available in this sandbox (no modules, network or filesystem). Remove the word import, comments included."
    : null;
}

/** Runs `script` in a fresh host-free context; returns the string globals it left behind. */
async function runSandboxed(script: string, timeoutMs: number): Promise<{ out?: string; pending?: string; timedOut: boolean }> {
  const vm = await import("node:vm");
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: "afterEvaluate",
  });
  const compiled = new vm.Script(script); // a SyntaxError here is host-realm, safe to report
  const started = Date.now();
  try {
    compiled.runInContext(context, { timeout: timeoutMs });
  } catch {
    // Deliberately unread: a thrown value may be a sandbox object whose getters
    // would run on the host, outside the timeout. The outcome is read below.
  }
  const readString = (key: string) => {
    const d = Object.getOwnPropertyDescriptor(context, key);
    return typeof d?.value === "string" ? d.value : undefined;
  };
  return { out: readString("__out"), pending: readString("__pending"), timedOut: Date.now() - started >= timeoutMs };
}

function readSandboxOutcome(run: { out?: string; timedOut: boolean }, timeoutMs: number): SandboxOutcome {
  if (run.out === undefined) {
    return {
      ok: false,
      error: run.timedOut
        ? `the code exceeded its ${timeoutMs}ms compute limit`
        : "the code did not finish (it threw outside its body or awaited something that never settles)",
    };
  }
  if (run.out.length > 1_000_000) return { ok: false, error: "the result is larger than 1 MB" };
  try {
    const r = JSON.parse(run.out) as { ok?: unknown; value?: unknown; error?: unknown; logs?: unknown };
    if (r.ok === true) return { ok: true, value: r.value ?? null, logs: Array.isArray(r.logs) ? r.logs.map(String) : [] };
    return { ok: false, error: String(r.error ?? "error") };
  } catch {
    return { ok: false, error: "the sandbox returned unreadable output" };
  }
}

const RUN_CODE_HELPERS = `
const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
const sum = (arr) => arr.reduce((s, v) => s + v, 0);
const min = (arr) => Math.min(...arr);
const max = (arr) => Math.max(...arr);
const pct = (part, whole) => whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
const delta = (curr, prev) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10;
`;

/**
 * queryData's in-sandbox api. It cannot hold a host function, so it records
 * every (name, args) it has no answer for and parks that await forever; the
 * host runs those reads and replays the code with the answers injected as
 * JSON. The host re-checks every name: this in-sandbox whitelist is only for
 * a fast, clear error.
 */
function queryDataApi(whitelist: readonly string[], answers: Record<string, unknown>): string {
  return `
const __answers = JSON.parse(${JSON.stringify(JSON.stringify(answers))});
const __asked = [];
globalThis.api = Object.freeze({
  tools: Object.freeze(${JSON.stringify(whitelist)}),
  call(name, args = {}) {
    name = String(name);
    if (!api.tools.includes(name)) {
      return Promise.reject(new Error("api.call: '" + name + "' is not in the read-only whitelist: " + api.tools.join(", ")));
    }
    const key = JSON.stringify([name, args]);
    if (Object.prototype.hasOwnProperty.call(__answers, key)) {
      const a = __answers[key];
      return "error" in a ? Promise.reject(new Error(a.error)) : Promise.resolve(a.value);
    }
    __asked.push(key);
    globalThis.__pending = JSON.stringify(__asked);
    return new Promise(() => {});
  },
});
`;
}

export const metaTools = {

  toolHealth: tool({
    description: "Check the health of Nick's tools and their dependencies. Shows which tools are operational, degraded, or down. Use when Nour asks about system health, tool status, or 'is everything working?'",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        // Check database
        const dbStart = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        const dbLatency = Date.now() - dbStart;

        // v10.0.179 · check the ACTUAL env vars each integration
        // uses. Pre-fix `bridge` checked STATENOUR_SYNC_KEY, but the
        // bridge tools (queryNickstire, getShopSnapshot, etc.) use
        // NICKS_ADMIN_URL + BRIDGE_API_KEY. So toolHealth would
        // report bridge=ok while every bridge tool was returning
        // { error: "Bridge not configured" } silently.
        const envChecks = {
          anthropic: { present: !!process.env.ANTHROPIC_API_KEY, var: "ANTHROPIC_API_KEY" },
          telegram: { present: !!process.env.TELEGRAM_BOT_TOKEN, var: "TELEGRAM_BOT_TOKEN" },
          github: { present: !!process.env.GITHUB_TOKEN, var: "GITHUB_TOKEN" },
          google: { present: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY, var: "GOOGLE_SERVICE_ACCOUNT_KEY" },
          voice: { present: !!process.env.HUGGINGFACE_API_KEY, var: "HUGGINGFACE_API_KEY" },
          bridge: {
            present: !!(process.env.NICKS_ADMIN_URL && process.env.BRIDGE_API_KEY),
            var: "NICKS_ADMIN_URL + BRIDGE_API_KEY",
          },
          browser: {
            present: !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID),
            var: "BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID",
          },
        };

        const missing = Object.entries(envChecks).filter(([, v]) => !v.present).map(([k]) => k);
        const present = Object.entries(envChecks).filter(([, v]) => v.present).map(([k]) => k);

        // v10.0.179 · derive count from the catalog instead of
        // hardcoding it. The catalog is the single source of truth
        // and it stays in sync with nourTools via the contract test
        // in tests/ai/tool-contract.test.ts.
        const { TOOL_CATALOG } = await import("@/lib/ai/tools/catalog");

        return {
          status: missing.length > 2 ? "degraded" : "operational",
          database: { status: dbLatency < 500 ? "ok" : "slow", latencyMs: dbLatency },
          services: {
            operational: present,
            missing,
          },
          toolCount: TOOL_CATALOG.length,
          recommendation: missing.length > 0
            ? `Set these env vars to unlock full power: ${missing.join(", ")}`
            : "All systems operational. Full arsenal available.",
        };
      } catch (e) {
        return { status: "error", error: String(e) };
      }
    },
  }),

  getCronStatus: tool({
    description: "Get status and health of all cron jobs",
    inputSchema: z.object({}),
    execute: async () => {
      const { getCronStatus } = await import("@/lib/services/cron-manager");
      return getCronStatus();
    },
  }),

  // ── SPECIALIZED MODEL TOOLS ──

  runCode: tool({
    description: "Execute JavaScript in a sandbox. Use for calculations, data analysis, projections, formatting. Has the JavaScript built-ins plus helpers avg, sum, min, max, pct, delta. No network, filesystem or modules (code containing the word import is refused). 5s limit. The code runs as a function body: use `return <value>` for the result, which comes back as JSON; console.log lines come back as logs.",
    inputSchema: z.object({
      code: z.string().describe("JavaScript function body. Use `return <value>` for the result; without a return the result is null."),
      description: z.string().optional().describe("What this code does"),
    }),
    execute: async ({ code, description }) => {
      try {
        const refused = sandboxRefusal(code);
        if (refused) return { success: false, error: refused };
        const run = await runSandboxed(`${SANDBOX_PRELUDE}${RUN_CODE_HELPERS}\n__finish(function () {\n${code}\n});`, 5000);
        const res = readSandboxOutcome(run, 5000);
        if (!res.ok) return { success: false, error: res.error };
        return { success: true, result: res.value, logs: res.logs.length > 0 ? res.logs : undefined, description };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // IMAGE ANALYSIS — Process photos, screenshots, receipts
  // ═══════════════════════════════════════════════════════════

  runPython: tool({
    description:
      "ALWAYS CALL THIS TOOL when the operator asks you to RUN, EXECUTE, COMPUTE, CALCULATE, or PLOT anything in Python. Do not paste back Python code as a code block · ACTUALLY RUN IT. Returns stdout, stderr, and matplotlib charts as base64 PNGs. Available libraries: numpy, pandas, matplotlib, scipy, requests. No network access by default. 60s timeout. If E2B_API_KEY is missing the tool returns code='missing_api_key' · surface that error to the operator instead of pretending to execute.",
    inputSchema: z.object({
      code: z
        .string()
        .min(1)
        .max(20_000)
        .describe(
          "Python code to execute. Print results with `print()` so they appear in stdout. To return charts, use matplotlib `plt.show()` (they come back as base64 PNGs in the `charts` field).",
        ),
    }),
    execute: async ({ code }) => {
      // v10.0.529.4 D-2 fix · daily quota guard. E2B free tier is 100
      // runs/day · without this a prompt-injection loop could exhaust
      // it. Default cap 100 matches the free-tier ceiling.
      const { checkAndIncrementToolQuota } = await import("@/lib/ai/tool-quota");
      const quota = await checkAndIncrementToolQuota("runPython");
      if (!quota.ok) {
        return {
          ok: false,
          code: "quota_exceeded",
          error: `runPython daily quota exhausted (${quota.count}/${quota.cap}). Resets at ${quota.resetAt}.`,
          stdout: "",
          stderr: "",
          charts: [],
        };
      }
      const { runPython } = await import("@/lib/integrations/e2b");
      return await runPython(code);
    },
  }),

  // 2026-07-22 · browseAndDo — the ONE dependable high-level browser workflow.
  // Session + plan/do loop + permission gate + receipt in a single call, so the
  // chat model no longer hand-coordinates browser_navigate/act/extract. The
  // low-level tools below stay available for debugging / surgical steps.
  browseAndDo: tool({
    description:
      "Run a COMPLETE browser task autonomously: opens a cloud browser, plans + executes the steps (navigate, click, type, read), and returns a structured receipt with a session replay URL. THE preferred tool whenever Nour asks Nick to do something on a website ('go check X', 'find Y on site Z', 'fill the form but don't submit'). permission: 'read' = look only · 'draft' (default) = interact but STOP before any consequential submission (submit/send/purchase/delete) · 'execute' = allowed to fire the final action. Costs real money per step — keep goals specific.",
    inputSchema: z.object({
      goal: z.string().min(8).describe("Specific, self-contained description of what to accomplish, including the site if known."),
      startUrl: z.string().url().optional().describe("URL to open first (skips one planning step)."),
      permission: z.enum(["read", "draft", "execute"]).default("draft").describe("Action permission. Use 'execute' ONLY when Nour explicitly authorized the final consequential action."),
      maxSteps: z.number().int().min(1).max(10).optional().describe("Step cap · default 6."),
      keepSessionOpen: z.boolean().optional().describe("Leave the session open (live-view) instead of closing it at the end."),
    }),
    execute: async ({ goal, startUrl, permission: requested, maxSteps, keepSessionOpen }) => {
      const { browseAndDo } = await import("@/lib/ai/browser/browse-and-do");
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      // 2026-10-10 (audit 07-SN-03): the MODEL picked `permission`, so a
      // Draft turn could fire a final submit/purchase. Clamp it to the turn:
      // never above draft unless the turn is Execute, never above read in a
      // Read turn. An approved re-execution (guardian bypass) is the owner's
      // own key on this exact payload and keeps it. The chat route publishes
      // actionPermission on the TurnContext; a turn without one (null, a
      // non-chat scope) reads as Draft here (the safe direction).
      const { currentTurn } = await import("@/lib/agent/turn-context");
      const { guardianBypassStorage } = await import("@/lib/tools/guardian");
      const order = ["read", "draft", "execute"] as const;
      const turnPermission = (currentTurn() as { actionPermission?: unknown } | null)?.actionPermission;
      const ceiling =
        guardianBypassStorage.getStore() === true || turnPermission === "execute"
          ? "execute"
          : turnPermission === "read"
            ? "read"
            : "draft";
      // An unknown value (a raw approval payload skips the schema) reads as
      // the tool's own default, draft, before the clamp.
      const asked = order.indexOf(requested as (typeof order)[number]);
      const permission = order[Math.min(asked === -1 ? 1 : asked, order.indexOf(ceiling))];
      const r = await browseAndDo({ goal, startUrl, permission, maxSteps, keepSessionOpen });
      // Page-derived text is untrusted — fence everything read off the web
      // before it re-enters the model's context.
      return {
        ...r,
        summary: fenceContent("browseAndDo", "external_web", r.summary),
        steps: r.steps.map((s) => ({ ...s, info: fenceContent("browseAndDo", "external_web", s.info) })),
      };
    },
  }),

  browser_do: tool({
    description:
      "LOW-LEVEL: start a live cloud browser session (headless Chrome) and return its id + live-view URL — you then drive it manually with browser_navigate. For complete tasks ('go check X online', 'pull data from Z') PREFER browseAndDo, which runs the whole workflow in one call. Use this only for surgical multi-tool control or debugging.",
    inputSchema: z.object({
      goal: z
        .string()
        .min(4)
        .describe("Plain-English description of what the browser agent should accomplish. Will be stored on the session for later reference."),
      keepAlive: z
        .boolean()
        .optional()
        .describe("If true (default), session stays open even when idle so Nour can watch. Close it manually via /api/browser/session DELETE."),
    }),
    execute: async ({ goal, keepAlive = true }) => {
      const { createSession, isConfigured } = await import("@/lib/integrations/browserbase");
      if (!isConfigured()) {
        return {
          ok: false,
          configured: false,
          message:
            "Browser agent unavailable — Browserbase isn't configured. Sign up at browserbase.com (2 min) and drop BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID into Vercel env to light this up.",
          docs: "docs/NICKSTIRE-QUERY-CONTRACT.md doesn't cover this yet; see docs/BUSINESS-LANDSCAPE.md Tools Inventory.",
        };
      }
      const res = await createSession({ keepAlive });
      if (!res.ok) {
        return {
          ok: false,
          configured: true,
          message: `Couldn't create session: ${res.error}`,
          code: res.code,
        };
      }
      return {
        ok: true,
        configured: true,
        goal,
        session: {
          id: res.data.id,
          liveViewUrl: res.data.liveViewUrl,
          connectUrl: res.data.connectUrl,
          createdAt: res.data.createdAt,
          expiresAt: res.data.expiresAt,
        },
        nextSteps: [
          "Open liveViewUrl to watch Nick navigate in real time.",
          "Then: call browser_navigate to load a URL.",
          "When done: DELETE /api/browser/session?id=<id> to release.",
        ],
      };
    },
  }),

  // v11.1 G1 · browser_navigate — navigate an open session to a URL.
  // Requires an active session (use browser_do first). Lazy-loads
  // Stagehand; returns a structured not_installed error if the driver
  // dep isn't on disk yet.
  browser_navigate: tool({
    description:
      "Navigate the active cloud browser session to a URL. Requires a sessionId from a prior browser_do call. Returns the final resolved URL + page title. Use this to reach a specific page.",
    inputSchema: z.object({
      sessionId: z.string().min(6).describe("Session id from a prior browser_do call."),
      url: z.string().url().describe("Full URL to navigate to (including https://)."),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle"])
        .optional()
        .describe("When to consider navigation complete. Default: networkidle."),
    }),
    execute: async ({ sessionId, url, waitUntil }) => {
      const { navigate } = await import("@/lib/integrations/stagehand");
      const res = await navigate({ sessionId, url, waitUntil });
      if (!res.ok) {
        return { ok: false, code: res.code, error: res.error, hint: res.hint };
      }
      return { ok: true, ...res.data };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // 2026-08-13 · BDN-201/207 · mid-turn tool RECOVERY + read-only
  // data sandbox. The pruner (chat-mode.ts) sends ≤NICK_TOOL_BUDGET
  // tools per turn; when it guesses wrong the model previously hit a
  // dead end ("tool unavailable" turns, see prepare-tools.ts 2026-07-15
  // note). searchTools finds what the pruner dropped; invokeTool runs
  // it — READ-SAFE TOOLS ONLY, fail-closed via capability-registry.
  // Side-effecting tools stay unreachable through this lane by design:
  // they must be loaded by the pruner/forces so every existing gate
  // (approval, read-mode strip, guardian) applies unchanged.
  // ═══════════════════════════════════════════════════════════

  searchTools: tool({
    description:
      "Find tools that are NOT currently loaded this turn. Use when you need a capability you don't see in your available tools — search by what you want to do (e.g. 'sleep data', 'github commits', 'customer lookup'). Returns matching tool names + schemas. Read-only tools can then be run via invokeTool; write tools require asking the operator to rephrase so the tool loads normally. Example: {\"query\":\"habit streaks\"}",
    inputSchema: z.object({
      query: z.string().min(2).describe("What you want to do, plain words. Matched against tool names, categories and descriptions."),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ query, limit }) => {
      const { TOOL_CATALOG, getToolRiskClass } = await import("@/lib/ai/tools/catalog");
      const { isReadSafeTool } = await import("@/lib/ai/capability-registry");
      const schemas = await getSchemaIndex();
      // 2026-09-02 · review P1. The filter used to keep every 2-char token
      // and the scorer substring-matches, so "on" out of a query like
      // "best thriller shows on streaming" hit inside dozens of unrelated
      // names and descriptions -- ~145 results, none of them the web-search
      // tool. That made the semantic fallback below UNREACHABLE for exactly
      // the query class it was written for, because `scored` was never
      // empty. A 3-char floor plus stop-words restores meaning to a hit.
      const STOP_WORDS = new Set([
        "the", "and", "for", "with", "that", "this", "from", "are", "was",
        "you", "your", "its", "out", "how", "what", "when", "who", "why", "can",
        "get", "all", "any", "not", "but", "into", "about", "best", "top", "new",
        "now", "right", "some", "more", "most", "please", "need", "want", "show",
        "give", "tell", "find", "make", "does", "did", "has", "have", "had",
      ]);
      const tokens = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
      // `score` is present on lexical hits and absent on semantic ones -- the
// merge below carries both shapes in one list, and the weak-evidence
// trigger reads scored[0]?.score.
      type Hit = { meta: (typeof TOOL_CATALOG)[number]; name: string; score?: number };
      let matchedBy: "keyword" | "semantic" | "hybrid" = "keyword";
      let scored: Hit[] = TOOL_CATALOG.map((meta) => {
        const name = meta.name;
        const hay = `${name} ${meta.category} ${schemas.get(name)?.description ?? ""}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (name.toLowerCase().includes(t)) score += 3;
          if (hay.includes(t)) score += 1;
        }
        return { meta, name, score };
      })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // SEMANTIC FALLBACK.
      // The pass above scores by TOKEN OVERLAP against name + category +
      // description, then drops everything with score 0. So a query
      // sharing no words with the catalog returns NOTHING -- which is
      // precisely the miss that makes this recovery lane necessary. The
      // pruner that dropped the tool already ranks semantically
      // (chat-mode.ts tier 5); the recovery lane did not, so a semantic
      // gap defeated BOTH the primary selector and its fallback, and the
      // model correctly concluded the capability did not exist.
      // ("best thriller shows on streaming" shares no token with
      // arsenalWebSearch, its category, or its description.)
      //
      // Only fires when keyword matching found nothing: embedUserMessage
      // is a provider call, and paying for it when the cheap path already
      // answered would tax every recovery. Degrades silently to the empty
      // keyword result if the cache is cold or the embedding call fails --
      // both already possible today, so this can only add hits.
      // Trigger on WEAK evidence, not just zero. A score of 3+ means the
      // query matched a tool NAME; anything less is description/category
      // substring noise, which is how the pruner's own miss reaches here.
      const strongestLexical = scored[0]?.score ?? 0;
      if (scored.length === 0 || strongestLexical < 3) {
        try {
          const { isToolEmbeddingCacheWarm, embedUserMessage, rankToolsBySimilarity } =
            await import("@/lib/ai/tool-embeddings");
          if (isToolEmbeddingCacheWarm()) {
            const queryEmbedding = await embedUserMessage(query);
            if (queryEmbedding.length > 0) {
              const byName = new Map(TOOL_CATALOG.map((m) => [m.name, m]));
              // 0.25 mirrors the live floor the pruner passes at
              // chat-mode.ts:582 (NOT rankToolsBySimilarity's 0.3
              // default) so the recovery lane is never stricter than the
              // selector it exists to backstop.
              const ranked = rankToolsBySimilarity(queryEmbedding, limit, 0.25);
              const hits = ranked
                .map(([name]) => ({ meta: byName.get(name), name }))
                .filter((h): h is Hit => Boolean(h.meta));
              if (hits.length > 0) {
                // MERGE rather than replace: a weak lexical hit can still
                // be the right tool, and dropping it to make room for a
                // semantic guess would trade one miss for another.
                // Semantic first (it fired because lexical was weak),
                // deduped by name, then truncated to the caller's limit.
                const seen = new Set(hits.map((h) => h.name));
                const merged = [...hits];
                for (const prior of scored) {
                  if (!seen.has(prior.name)) {
                    seen.add(prior.name);
                    merged.push(prior);
                  }
                }
                matchedBy = scored.length > 0 ? "hybrid" : "semantic";
                scored = merged.slice(0, limit);
              }
            }
          }
        } catch {
          // Recovery must never throw: an empty result is a worse answer,
          // a thrown error is a broken turn.
        }
      }

      return {
        count: scored.length,
        matchedBy,
        tools: scored.map(({ meta, name }) => ({
          name,
          category: meta.category,
          riskClass: getToolRiskClass(name, meta),
          readSafe: isReadSafeTool(name),
          invocableViaInvokeTool: isReadSafeTool(name) && !["searchTools", "invokeTool"].includes(name),
          description: schemas.get(name)?.description ?? "(no description)",
          inputSchema: schemas.get(name)?.inputSchema ?? null,
        })),
      };
    },
  }),

  invokeTool: tool({
    description:
      "Run a READ-ONLY tool by name that isn't loaded this turn (find it with searchTools first). Refuses anything that mutates state — write tools must load through the normal path so approval gates apply. Example: {\"name\":\"getHabitStreaks\",\"args\":{}}",
    inputSchema: z.object({
      name: z.string().min(2).describe("Exact tool name from searchTools."),
      args: z.record(z.string(), z.unknown()).default({}).describe("Arguments matching the tool's input schema."),
    }),
    execute: async ({ name, args }): Promise<Record<string, unknown>> => {
      // Self-review fix 2026-08-13: queryData is deliberately ALLOWED —
      // its sandbox reaches data only via its own 12-tool whitelist
      // (which excludes invokeTool), so no cycle is possible, and
      // without this a searchTools hit on queryData was a dead end.
      if (["searchTools", "invokeTool"].includes(name)) {
        return { error: `refusing recursive invocation of ${name}` };
      }
      type LooseTool = { execute?: (a: unknown) => Promise<unknown>; inputSchema?: z.ZodType };
      const mod = (await import("@/lib/ai/tools")) as unknown as { nourTools: Record<string, LooseTool> };
      const target: LooseTool | undefined = mod.nourTools[name];
      if (!target?.execute) return { error: `unknown tool: ${name}. Use searchTools to find valid names.` };
      const { isReadSafeTool } = await import("@/lib/ai/capability-registry");
      if (!isReadSafeTool(name)) {
        return {
          error: `${name} is not read-safe — it mutates state or is uncataloged. It cannot run through invokeTool; ask the operator so it loads through the normal gated path.`,
        };
      }
      const { isToolBlocked } = await import("@/lib/ai/tool-telemetry");
      if (isToolBlocked(name)) return { error: `${name} is circuit-breaker blocked (recent repeated failures).` };
      const { getAiConfig } = await import("@/lib/settings/ai-config");
      const aiConfig = await getAiConfig().catch(() => null);
      if (aiConfig?.disabledTools?.includes(name)) return { error: `${name} is disabled by operator config.` };
      let parsedArgs: unknown = args;
      if (target.inputSchema && typeof target.inputSchema.safeParse === "function") {
        const parsed: z.ZodSafeParseResult<unknown> = target.inputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            error: `arguments failed ${name}'s schema`,
            issues: parsed.error.issues.map((i: z.core.$ZodIssue) => `${i.path.join(".")}: ${i.message}`),
          };
        }
        parsedArgs = parsed.data;
      }
      const started = Date.now();
      const result = await target.execute(parsedArgs);
      // Proxied calls still count in tool_telemetry under the REAL tool's
      // name, so the usage census (BDN-202) sees recovery-lane usage.
      const { recordToolInvocation } = await import("@/lib/ai/tool-telemetry");
      const softFailed = !!(result && typeof result === "object" && "error" in (result as Record<string, unknown>));
      // Private Lab leaves no trace, so no tool_telemetry row either (audit 07-SN-05 b).
      const { currentTurn } = await import("@/lib/agent/turn-context");
      if (currentTurn()?.privateMode !== true) {
        void recordToolInvocation({
          toolName: name,
          success: !softFailed,
          durationMs: Date.now() - started,
          errorMessage: softFailed ? String((result as Record<string, unknown>).error) : undefined,
        }).catch(() => {});
      }
      return { tool: name, viaRecoveryLane: true, result };
    },
  }),

  queryData: tool({
    description:
      "Run JavaScript against a READ-ONLY data API to join/filter/aggregate across sources in one call instead of many separate tool calls. The sandbox exposes `api.call(toolName, args)` (await it) for a whitelisted set of read tools plus `api.tools` (the whitelist). No network, no filesystem, 10s budget. Return the final value. Example: {\"code\":\"const t = await api.call('getTasks',{}); const c = await api.call('getCommitments',{}); return { tasks: t.length ?? t.count, commitments: c.length ?? c.count };\"}",
    inputSchema: z.object({
      code: z.string().min(4).max(20_000).describe("JavaScript body. Use `return` for the final value; `await api.call(name, args)` for data."),
      description: z.string().optional().describe("What this query computes"),
    }),
    execute: async ({ code, description }) => {
      const WHITELIST = [
        "getTasks", "getCommitments", "getAgendaItems", "getMissions",
        "getHabitStreaks", "getBodyData", "getHealthToday", "getSleepTrend",
        "getFinancialSnapshot", "getMasteryScores", "getDriftAlerts", "searchMemories",
      ] as const;
      type LooseTool = { execute?: (a: unknown) => Promise<unknown> };
      const mod = (await import("@/lib/ai/tools")) as unknown as { nourTools: Record<string, LooseTool> };
      const { isReadSafeTool } = await import("@/lib/ai/capability-registry");
      const guardedCall = async (name: string, args: unknown = {}): Promise<unknown> => {
        if (!(WHITELIST as readonly string[]).includes(name)) {
          throw new Error(`api.call: '${name}' is not in the read-only whitelist: ${WHITELIST.join(", ")}`);
        }
        if (!isReadSafeTool(name)) throw new Error(`api.call: '${name}' is not read-safe`);
        const target: LooseTool | undefined = mod.nourTools[name];
        if (!target?.execute) throw new Error(`api.call: '${name}' not found`);
        return target.execute(args);
      };
      try {
        const refused = sandboxRefusal(code);
        if (refused) return { success: false, error: refused };
        // Record and replay (see queryDataApi): each round reruns the code with
        // every answer so far; each distinct call runs once on the host. Model
        // code is pure, so a rerun only differs in how far it gets.
        const COMPUTE_MS = 2000; // shared by all rounds
        const MAX_ROUNDS = 8; // sequential waves of new calls; Promise.all is one wave
        const replay = async (): Promise<SandboxOutcome> => {
          const answers: Record<string, { value: unknown } | { error: string }> = {};
          let computeLeft = COMPUTE_MS;
          for (let round = 0; ; round++) {
            const started = Date.now();
            const script = `${SANDBOX_PRELUDE}${queryDataApi(WHITELIST, answers)}\n__finish(async () => {\n${code}\n});`;
            const run = await runSandboxed(script, Math.max(1, computeLeft));
            computeLeft -= Date.now() - started;
            let asked: string[] = [];
            try {
              asked = run.out === undefined && !run.timedOut && run.pending ? (JSON.parse(run.pending) as unknown[]).map(String) : [];
            } catch { /* unreadable: report the outcome below */ }
            const fresh = [...new Set(asked)].filter((k) => !(k in answers));
            if (fresh.length === 0) return readSandboxOutcome(run, COMPUTE_MS);
            if (round >= MAX_ROUNDS) {
              return { ok: false, error: `more than ${MAX_ROUNDS} rounds of dependent api.call; batch independent calls with Promise.all` };
            }
            await Promise.all(fresh.map(async (key) => {
              try {
                const parsed = JSON.parse(key) as unknown;
                const [name, args] = Array.isArray(parsed) ? parsed : [];
                const value = await guardedCall(String(name), args ?? {});
                const json = JSON.stringify(value ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
                answers[key] = { value: JSON.parse(json) };
              } catch (e) {
                answers[key] = { error: e instanceof Error ? e.message : String(e) };
              }
            }));
          }
        };
        // Self-review fix: keep a handle on the timer so a fast result
        // doesn't leave a 10s timer holding the event loop.
        let deadlineTimer: NodeJS.Timeout | undefined;
        const deadline = new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(() => reject(new Error("queryData exceeded its 10s budget")), 10_000);
        });
        const replayed = replay();
        replayed.catch(() => {}); // a failure after the deadline won must not go unhandled
        let outcome: SandboxOutcome;
        try {
          outcome = await Promise.race([replayed, deadline]);
        } finally {
          clearTimeout(deadlineTimer);
        }
        if (!outcome.ok) return { success: false, error: outcome.error };
        const value = outcome.value;
        const logs = outcome.logs;
        let serialized = JSON.stringify(value ?? null);
        if (serialized && serialized.length > 20_000) {
          serialized = `${serialized.slice(0, 20_000)}…(truncated)`;
          return { success: true, resultTruncated: serialized, logs: logs.length ? logs : undefined, description };
        }
        return { success: true, result: value ?? null, logs: logs.length ? logs : undefined, description };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  }),



};
