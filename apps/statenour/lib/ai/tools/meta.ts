/**
 * Meta tools — introspection + sandboxed exec + browser automation.
 *
 * Includes: listTools · toolHealth · getCronStatus · runCode ·
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

export const metaTools = {
  listTools: tool({
    description: "List all available tools organized by category. Use when Nour asks 'what can you do?' or 'show me your tools' or 'what tools do you have?'",
    inputSchema: z.object({
      category: z.string().optional().describe("Filter by category: personal, business, shop, revenue, planning, brain, files, communication, analysis, research, commands, content, winback, meta. Leave empty for all."),
    }),
    execute: async ({ category }) => {
      // v10.0.179 · purged 4 retired tools the model was being told
      // about but couldn't actually call: getDailyScores + logDailyScore
      // (retired Apr 19 with DailyScore model), getRevenueProjection +
      // getDailyClose (never made it into nourTools). Pre-fix the model
      // could attempt to call them and either tool-not-found or get
      // garbage back, depending on SDK shape.
      const categories: Record<string, string[]> = {
        personal: [
          "getMasteryScores — Mastery domain scores",
          "getDriftAlerts — Unresolved drift alerts",
          "getCommitments — Active commitments",
          "getAgendaItems — Active agenda items (witnessed commitments, intentions, contradictions, neglect alerts)",
          "getTasks — Active tasks (INBOX/READY/DOING)",
          "getTasks — Tasks by status",
          "getMissions — Active missions",
          "getHabitStreaks — Habit streaks",
          "getBodyData — Weight/body data",
          "getFinancialSnapshot — Financial snapshot",
          // v10.0.529.89 · Wave 33 · "logDecision" stale ref removed.
          // Canonical decision-capture tool is journalDecision (listed
          // under planning below). The standalone logDecision tool was
          // retired Apr 15 · keeping the catalog string aligned with
          // the actual exposed surface prevents Nick from advertising
          // capabilities it doesn't have.
          "createTask — Create task",
          "completeTask — Complete task",
          "createCommitment — Create commitment",
          "resolveAlert — Resolve drift alert",
        ],
        planning: [
          "setWeeklyTargets — Set 3 weekly targets",
          "getWeeklyTargets — Get this week's targets",
          "checkCommitments — Check commitment health",
          "completeCommitment — Mark commitment done",
          "journalDecision — Log decision from chat",
          "suggestMIT — Suggest Most Important Task",
          "createMissionPlan — Create full mission plan",
        ],
        business: [
          "queryNickstire — Query shop API (any type)",
          "getAttentionAlerts — What needs attention now",
          "findCustomer — Search customer DB",
          "getEstimateLeaks — Find unconverted estimates",
          "createQuickQuote — Generate a quote",
        ],
        brain: [
          "getBrainHealth — Brain health + learning velocity",
          "getEmotionalState — Emotional arc + decision risk",
          "getHabitRevenueCorrelation — Habit→revenue patterns",
          "runSimulation — What-if scenario simulation",
          "searchMemories — Search brain memories",
          "searchConversations — Search past conversations",
          "searchGreeneLaws — Search strategic law library",
        ],
        files: [
          "searchDriveFiles — Search Google Drive",
          "readDriveFile — Read a Drive document",
          "listRecentDriveFiles — Recent Drive files",
          "githubReadFile — Read file from repo",
          "githubListFiles — List repo files",
          "githubSearchCode — Search code",
          "githubRecentCommits — Recent commits",
          "githubCreatePR — Create pull request",
          "githubCreateIssue — Create issue",
          "githubListRepos — List repos",
        ],
        communication: [
          "sendTelegram — Push urgent msg to phone",
        ],
        commands: [
          "dailyPulse — Full daily status check",
          "endOfDay — EOD wrap-up",
          "weeklyReview — Weekly review with scoring",
          "analyzeWeek — Deep week analysis",
          "getShopSnapshot — Quick shop snapshot",
        ],
      };

      if (category && categories[category]) {
        return { category, tools: categories[category], count: categories[category].length };
      }

      const all = Object.entries(categories).map(([cat, tools]) => ({
        category: cat,
        count: tools.length,
        tools,
      }));
      return { totalTools: all.reduce((s, c) => s + c.count, 0), categories: all };
    },
  }),

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
    description: "Execute JavaScript in a sandbox. Use for calculations, data analysis, projections, formatting. Has Math, Date, JSON, Array. No network/filesystem. Returns last expression.",
    inputSchema: z.object({
      code: z.string().describe("JavaScript code. Last expression value is returned."),
      description: z.string().optional().describe("What this code does"),
    }),
    execute: async ({ code, description }) => {
      try {
        const vm = await import("vm");
        const logs: string[] = [];
        const sandbox = {
          Math, Date, JSON, Array, Object, String, Number, Boolean, Map, Set, RegExp,
          parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
          console: { log: (...args: unknown[]) => { logs.push(args.map(String).join(" ")); } },
          // Data analysis helpers
          avg: (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0,
          sum: (arr: number[]) => arr.reduce((s, v) => s + v, 0),
          min: (arr: number[]) => Math.min(...arr),
          max: (arr: number[]) => Math.max(...arr),
          pct: (part: number, whole: number) => whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10,
          delta: (curr: number, prev: number) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10,
          result: undefined as unknown,
        };
        const wrapped = `result = (function() { ${code} })()`;
        const context = vm.createContext(sandbox);
        vm.runInContext(wrapped, context, { timeout: 5000 });
        return { success: true, result: sandbox.result, logs: logs.length > 0 ? logs : undefined, description };
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
    execute: async ({ goal, startUrl, permission, maxSteps, keepSessionOpen }) => {
      const { browseAndDo } = await import("@/lib/ai/browser/browse-and-do");
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
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
      "LOW-LEVEL: start a live cloud browser session (headless Chrome) and return its id + live-view URL — you then drive it manually with browser_navigate/browser_act/browser_extract. For complete tasks ('go check X online', 'pull data from Z') PREFER browseAndDo, which runs the whole workflow in one call. Use this only for surgical multi-tool control or debugging.",
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
          "Then: call browser_navigate to load a URL, browser_act to click/type, browser_extract to read structured data.",
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
      "Navigate the active cloud browser session to a URL. Requires a sessionId from a prior browser_do call. Returns the final resolved URL + page title. Use this before browser_act or browser_extract when you need to reach a specific page.",
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

  // v11.1 G1 · browser_act — LLM-native DOM interaction. The
  // instruction is parsed by Stagehand into a concrete click/type/
  // select action. No selectors needed.
  browser_act: tool({
    description:
      "Execute a natural-language action on the open session's current page: click a button, fill a form field, select an option. Stagehand plans the DOM interaction. Examples: 'click the Sign In button', 'type nour@bdnick.info into the email field', 'select Auto Repair from the category dropdown'.",
    inputSchema: z.object({
      sessionId: z.string().min(6).describe("Session id from a prior browser_do call."),
      instruction: z
        .string()
        .min(4)
        .describe("Plain-English description of the single action to perform. Keep it one action per call."),
    }),
    execute: async ({ sessionId, instruction }) => {
      const { act } = await import("@/lib/integrations/stagehand");
      const res = await act({ sessionId, instruction });
      if (!res.ok) {
        return { ok: false, code: res.code, error: res.error, hint: res.hint };
      }
      return { ok: true, ...res.data, instruction };
    },
  }),

  // v11.1 G1 · browser_observe — reconnaissance pass. Asks Stagehand
  // what's actionable on the current page. Useful before a blind
  // browser_act when the agent doesn't know the page layout, and for
  // debugging "why didn't the click work?" after a failed act.
  browser_observe: tool({
    description:
      "Reconnaissance on the open session's current page. Returns a list of actionable elements (buttons, forms, links) with short descriptions. Use before browser_act when you're unsure what's clickable, or after a failed act to debug.",
    inputSchema: z.object({
      sessionId: z.string().min(6).describe("Session id from a prior browser_do call."),
      instruction: z
        .string()
        .optional()
        .describe("Optional hint to narrow the observation, e.g. 'find the login form'. Omit for a full page scan."),
    }),
    execute: async ({ sessionId, instruction }) => {
      const { observe } = await import("@/lib/integrations/stagehand");
      const res = await observe({ sessionId, instruction });
      if (!res.ok) {
        return { ok: false, code: res.code, error: res.error, hint: res.hint };
      }
      return {
        ok: true,
        count: res.data.length,
        elements: res.data,
      };
    },
  }),

  // v11.1 G1 · browser_extract — structured extraction with a Zod
  // schema. Stagehand uses the schema as the LLM response format so
  // the return shape is guaranteed.
  browser_extract: tool({
    description:
      "Pull structured data from the open session's current page. Provide an instruction (what to look for) plus a shape (fields + types). Returns a typed object. Use when Nour needs specific values read off a page — prices, dates, statuses, table rows.",
    inputSchema: z.object({
      sessionId: z.string().min(6).describe("Session id from a prior browser_do call."),
      instruction: z
        .string()
        .min(4)
        .describe("What to extract. Example: 'get the shipping price and delivery date'."),
      fields: z
        .record(z.string(), z.enum(["string", "number", "boolean"]))
        .describe(
          "Shape of the expected return: { fieldName: 'string'|'number'|'boolean' }. Example: { price: 'string', deliveryDate: 'string' }.",
        ),
    }),
    execute: async ({ sessionId, instruction, fields }) => {
      // Build a Zod schema from the fields map so Stagehand gets a real
      // z.ZodType (its response-format plumbing requires it).
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [k, t] of Object.entries(fields)) {
        shape[k] = t === "number" ? z.number() : t === "boolean" ? z.boolean() : z.string();
      }
      const schema = z.object(shape);
      const { extract } = await import("@/lib/integrations/stagehand");
      const res = await extract({ sessionId, instruction, schema });
      if (!res.ok) {
        return { ok: false, code: res.code, error: res.error, hint: res.hint };
      }
      return { ok: true, data: res.data, instruction };
    },
  }),

  // v10.0.525 · Session-recording recall (VideoDB) · operator captures
  // their own sessions (chat + computer-use) externally (OBS, Loom,
  // screen-recorder) and submits to /api/system/videodb-sessions. These
  // two tools let Nick search across them by transcript + scene content.
};
