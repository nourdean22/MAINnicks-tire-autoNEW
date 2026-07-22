/**
 * Stagehand driver — G1 driver layer on top of Browserbase sessions.
 *
 * Stagehand (@browserbasehq/stagehand) is Browserbase's LLM-native
 * page controller. v3 exposes three natural-language primitives as
 * INSTANCE methods (the v1-era `.page` facade is gone):
 *   · stagehand.act("click the sign-in button")
 *   · stagehand.extract("get the price", zodSchema)   // positional
 *   · stagehand.observe("find the login form")        // -> Action[]
 *
 * Why this file exists (and not direct Playwright):
 *   · Stagehand handles the LLM plumbing so we don't hand-roll DOM
 *     queries. One act() call beats 30 lines of selector gymnastics.
 *   · The API stays stable across page redesigns because it reasons
 *     about intent ("click Send") instead of DOM selectors.
 *
 * Lazy loading:
 *   Stagehand is heavy (Playwright plumbing + LLM clients). We
 *   `await import()` inside each call so the serverless bundle stays
 *   small when nobody calls the driver, and a missing install degrades
 *   to a structured "not_installed" error instead of crashing.
 *
 * INSTALLED 2026-07-22: @browserbasehq/stagehand@3.7.0 +
 * playwright-core@1.61.1 are pinned deps (package.json) and listed in
 * next.config.ts `serverExternalPackages` so the standalone runtime
 * image actually contains them (see loadStagehand's tracing note).
 *
 * Reference: https://docs.stagehand.dev
 */

import { z } from "zod";
import { getConfig as getBrowserbaseConfig } from "@/lib/integrations/browserbase";

export type DriverErrorCode =
  | "not_installed"
  | "not_configured"
  | "session_missing"
  | "driver_error"
  | "timeout"
  | "extract_failed";

export interface DriverOk<T> {
  ok: true;
  data: T;
}
export interface DriverError {
  ok: false;
  code: DriverErrorCode;
  error: string;
  hint?: string;
}

const NOT_INSTALLED_HINT =
  "Run: pnpm add @browserbasehq/stagehand playwright-core";

/**
 * Default per-call timeout. A real browser action that takes longer
 * than this is almost certainly hung (page.act stalled on a selector,
 * extract() waiting for content that never loads, etc). 45s gives
 * plenty of headroom for cold Browserbase sessions + LLM plan + DOM
 * interaction while still bailing before Vercel's serverless timeout.
 */
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Run a Stagehand operation with a hard wall-clock timeout AND a
 * guaranteed cleanup callback that fires on BOTH paths (success and
 * timeout).
 *
 * This replaces the old `withTimeout(promise, ms)` helper that simply
 * raced the promise against a timer. The old version had a critical
 * billing leak: when timeout fired, the caller returned a DriverError
 * but the underlying promise kept running. In Stagehand's case that
 * meant the Browserbase session stayed connected + Stagehand stayed
 * reserved until the CDP call naturally resolved — potentially many
 * minutes of billed session-time per hung call.
 *
 * Now: both paths guarantee `cleanup()` runs immediately. Cleanup
 * tears down the Stagehand instance which drops the CDP connection
 * — Browserbase sees the disconnect and stops counting minutes for
 * THIS connection (the session itself may stay alive if keepAlive).
 *
 * Cleanup errors are swallowed — the tear-down path should never mask
 * the real success/timeout result from reaching the caller.
 */
async function runStagehandOp<T>(
  work: () => Promise<T>,
  cleanup: () => Promise<void>,
  ms: number,
  label: string,
): Promise<T | DriverError> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<DriverError>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        code: "timeout",
        error: `${label} timed out after ${Math.round(ms / 1000)}s`,
      });
    }, ms);
  });

  try {
    const result = await Promise.race([work(), timeoutPromise]);
    return result;
  } catch (err) {
    return {
      ok: false,
      code: "driver_error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    // CRITICAL: cleanup runs on ALL paths — success, timeout, throw.
    // Swallow cleanup errors so they don't hide the real outcome.
    try {
      await cleanup();
    } catch {
      /* cleanup best-effort */
    }
  }
}

/**
 * Minimal structural types for the bits of Stagehand we use. We keep
 * our own types rather than `typeof import(...)` because the package
 * may be absent from junctioned worktree node_modules pre-merge (the
 * structural types let tsc compile either way).
 *
 * VERIFIED against the installed v3.7.0 dist types (2026-07-22 — see
 * dist/cjs/lib/v3/v3.d.ts). The v3 API is a hard break from v1/v2:
 *   · act/extract/observe are INSTANCE methods (there is no `.page`)
 *   · extract is POSITIONAL: extract(instruction, schema, options?)
 *   · navigation goes through `get context()` → activePage()/newPage()
 *   · ActResult = { success, message, actionDescription, actions }
 */
interface StagehandCtor {
  new (opts: {
    env: "BROWSERBASE" | "LOCAL";
    apiKey: string;
    projectId: string;
    browserbaseSessionID?: string;
    /** Model string ("google/gemini-2.5-flash", key via providerEnvVarMap) or a
     *  config object ({modelName, apiKey, baseURL} — e.g. an OpenRouter route). */
    model?: string | { modelName: string; apiKey?: string; baseURL?: string };
    /** MUST be true when attaching: v3 close() RELEASES a non-keepAlive session,
     *  killing it between per-op attach cycles ("Requested session is not running"). */
    keepAlive?: boolean;
    /** true = run act/extract/observe LOCALLY over CDP instead of proxying
     *  through Browserbase's hosted Stagehand API (which 500s on custom
     *  baseURL model configs — live-repro'd 2026-07-22). */
    disableAPI?: boolean;
    disablePino?: boolean;
    verbose?: 0 | 1 | 2;
  }): StagehandInstance;
}
interface StagehandPageV3 {
  goto(url: string, opts?: { waitUntil?: string; timeoutMs?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
}
interface StagehandInstance {
  init(): Promise<void>;
  close(opts?: Record<string, unknown>): Promise<void>;
  readonly context: {
    activePage(): StagehandPageV3 | undefined;
    newPage(url?: string): Promise<StagehandPageV3>;
  };
  act(instruction: string, opts?: Record<string, unknown>): Promise<{ success: boolean; message: string }>;
  extract(instruction: string, schema: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  observe(instruction?: string, opts?: Record<string, unknown>): Promise<unknown[]>;
}

/**
 * Lazily load Stagehand. Returns the module or a structured error if
 * the dep isn't installed. Never throws — callers branch on `.ok`.
 *
 * 2026-07-22 · LITERAL import on purpose. The old version used a
 * variable-indirected, webpackIgnore-hinted dynamic import because the
 * package was optional — but that made the import INVISIBLE to Next's
 * file tracer, so the standalone runtime image (Dockerfile stage 3
 * copies ONLY `.next/standalone`) would prune Stagehand and prod would
 * report not_installed forever, even with the dep installed. Now that
 * @browserbasehq/stagehand is a real pinned dependency, a literal
 * dynamic import + `serverExternalPackages` (next.config.ts) lets the
 * tracer carry the package and its transitive closure into standalone.
 * The not_installed catch stays as defense-in-depth.
 *
 * Memoized for the life of the process: Node caches modules after the
 * first import anyway, but memoizing our wrapper avoids the try/catch
 * + error-construction cost on every call.
 */
let cachedLoad: Promise<
  | { ok: true; Stagehand: StagehandCtor }
  | DriverError
> | null = null;

async function loadStagehand(): Promise<
  | { ok: true; Stagehand: StagehandCtor }
  | DriverError
> {
  if (cachedLoad) return cachedLoad;
  cachedLoad = (async () => {
    try {
      // @ts-ignore -- the LITERAL specifier is REQUIRED for standalone file
      // tracing (see the note above), but the package may be absent on disk in
      // worktrees that junction node_modules from a pre-merge main. @ts-ignore
      // (not @ts-expect-error) so tsc passes in BOTH states; the structural
      // types below own the compile-time contract either way.
      const mod = (await import("@browserbasehq/stagehand")) as unknown as {
        Stagehand: StagehandCtor;
      };
      return { ok: true as const, Stagehand: mod.Stagehand };
    } catch (err) {
      // Reset cache on failure so a later install retries cleanly.
      cachedLoad = null;
      return {
        ok: false as const,
        code: "not_installed" as const,
        error: err instanceof Error ? err.message : String(err),
        hint: NOT_INSTALLED_HINT,
      };
    }
  })();
  return cachedLoad;
}

/**
 * Build a Stagehand instance attached to an existing Browserbase
 * session. The session must already exist (created via
 * `createSession` in browserbase.ts) — we do NOT create one here.
 *
 * Pattern: one Stagehand per tool call. We build, use, close. That's
 * the serverless-friendly pattern — no persistent connections.
 */
/**
 * Resolve the LLM Stagehand's act/extract/observe calls use. Live-verified
 * 2026-07-22, every lane probed end-to-end: direct GEMINI_API_KEY is over its
 * monthly spending cap, OPENAI_API_KEY is out of quota, and OpenRouter has
 * near-zero credits ("can only afford 127 tokens") — Ollama Cloud is the one
 * FUNDED lane (the primary chat provider; openai-compatible at
 * <OLLAMA_BASE_URL>/v1, same registration Perplexica uses). Wired via
 * Stagehand's ModelConfig object ({modelName, apiKey, baseURL} — the "openai/"
 * prefix selects its OpenAI-compatible client, the rest is the upstream model
 * id). Chain:
 *   1. STAGEHAND_MODEL          — explicit operator override (plain model string)
 *   2. OLLAMA_API_KEY set       — Ollama Cloud route. Model: STAGEHAND_OLLAMA_MODEL
 *                                 || OLLAMA_MODEL || deepseek-v4-pro. deepseek-v4-pro
 *                                 is E2E-VERIFIED for extract/observe structured
 *                                 output (2026-07-22 receipt: real zod-v4 extract off
 *                                 example.com); gpt-oss:120b FAILS schema parsing
 *                                 ("No object generated") — do not default to it.
 *   3. OPENROUTER_API_KEY set   — OpenRouter route (default google/gemini-2.5-flash,
 *                                 override via STAGEHAND_OPENROUTER_MODEL)
 *   4. fallback                 — direct google/gemini-2.5-flash (when the cap resets)
 */
function resolveStagehandModel():
  | string
  | { modelName: string; apiKey: string; baseURL: string } {
  const explicit = process.env.STAGEHAND_MODEL;
  if (explicit) return explicit;
  const ollamaKey = process.env.OLLAMA_API_KEY;
  if (ollamaKey) {
    const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
    return {
      modelName: `openai/${process.env.STAGEHAND_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "deepseek-v4-pro"}`,
      apiKey: ollamaKey,
      baseURL: `${base}/v1`,
    };
  }
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    return {
      modelName: `openai/${process.env.STAGEHAND_OPENROUTER_MODEL || "google/gemini-2.5-flash"}`,
      apiKey: openrouterKey,
      baseURL: "https://openrouter.ai/api/v1",
    };
  }
  return "google/gemini-2.5-flash";
}

async function attach(sessionId: string) {
  const bb = getBrowserbaseConfig();
  if (!bb) {
    return {
      ok: false as const,
      code: "not_configured" as const,
      error: "Browserbase not configured",
      hint: "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID",
    };
  }
  const loaded = await loadStagehand();
  if (!loaded.ok) return loaded;

  try {
    // Stagehand resumes the existing Browserbase session via
    // browserbaseSessionID and drives Chrome through CDP. env=BROWSERBASE
    // tells it to not spin a local browser. Model via resolveStagehandModel()
    // (OpenRouter-first — see its doc). disablePino keeps its logger out of
    // our stdout.
    const stagehand = new loaded.Stagehand({
      env: "BROWSERBASE",
      apiKey: bb.apiKey,
      projectId: bb.projectId,
      browserbaseSessionID: sessionId,
      model: resolveStagehandModel(),
      // One-Stagehand-per-op design: each call attaches, works, closes. Without
      // keepAlive, v3's close() RELEASES the session and the NEXT op 400s with
      // "Requested session is not running" (live-repro'd 2026-07-22). The
      // session's actual lifetime stays owned by browserbase.closeSession().
      keepAlive: true,
      // Local execution over CDP — the hosted Stagehand API 500s on custom
      // baseURL model configs (Ollama Cloud lane), and local keeps inference
      // inside our process/keys anyway.
      disableAPI: true,
      disablePino: true,
      verbose: 0,
    });
    await stagehand.init();
    return { ok: true as const, stagehand };
  } catch (err) {
    return {
      ok: false as const,
      code: "driver_error" as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Tear down a Stagehand instance. Never throws. */
async function close(stagehand: StagehandInstance): Promise<void> {
  try {
    await stagehand.close();
  } catch {
    // Non-fatal — session may already be closing.
  }
}

/* ─────────────────────────────────────────────────────────────── */
/* Public driver operations                                         */
/* ─────────────────────────────────────────────────────────────── */

/**
 * Navigate the open session to a URL.
 *
 * Wrapped with a 45s timeout — a real goto that takes longer is
 * almost certainly hung (nav event never fires, network stalled).
 */
export async function navigate(opts: {
  sessionId: string;
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
}): Promise<DriverOk<{ url: string; title: string }> | DriverError> {
  const att = await attach(opts.sessionId);
  if (!att.ok) return att;
  const sh = att.stagehand;
  return runStagehandOp<DriverOk<{ url: string; title: string }>>(
    async () => {
      // v3: no `.page` — navigation goes through the CDP context.
      const page = sh.context.activePage() ?? (await sh.context.newPage());
      await page.goto(opts.url, { waitUntil: opts.waitUntil ?? "networkidle" });
      const title = await page.title();
      const url = page.url();
      return { ok: true, data: { url, title } };
    },
    () => close(sh),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "navigate",
  );
}

/**
 * Execute a natural-language action on the page. Stagehand plans the
 * DOM interaction from the instruction.
 *
 * Examples:
 *   · "click the Sign In button"
 *   · "type nour@bdnick.info into the email field"
 *   · "select 'Auto Repair' from the category dropdown"
 */
export async function act(opts: {
  sessionId: string;
  instruction: string;
  timeoutMs?: number;
}): Promise<DriverOk<{ success: boolean; message?: string }> | DriverError> {
  const att = await attach(opts.sessionId);
  if (!att.ok) return att;
  const sh = att.stagehand;
  return runStagehandOp<DriverOk<{ success: boolean; message?: string }>>(
    async () => {
      // v3: act is an instance method taking the instruction positionally.
      const result = await sh.act(opts.instruction);
      return {
        ok: true,
        data: {
          success: Boolean(result?.success ?? true),
          message: result?.message,
        },
      };
    },
    () => close(sh),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "act",
  );
}

/**
 * Extract structured data from the page. The schema is a shape of
 * field → type; Stagehand uses it as the response-format for its
 * LLM call and returns a typed object.
 *
 * Example:
 *   extract({
 *     sessionId,
 *     instruction: "get the shipping price and delivery date",
 *     schema: { price: "string", deliveryDate: "string" },
 *   })
 */
export async function extract<T extends Record<string, unknown>>(opts: {
  sessionId: string;
  instruction: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
}): Promise<DriverOk<T> | DriverError> {
  const att = await attach(opts.sessionId);
  if (!att.ok) return att;
  const sh = att.stagehand;
  return runStagehandOp<DriverOk<T>>(
    async () => {
      // v3: extract is POSITIONAL — extract(instruction, schema, options?).
      // zod v4 schemas are first-class (v3 ships a zodCompat layer).
      const result = (await sh.extract(opts.instruction, opts.schema)) as T;
      return { ok: true, data: result };
    },
    () => close(sh),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "extract",
  );
}

/**
 * Observe the page — asks Stagehand what's visible / actionable. Good
 * for "what can I click here?" reconnaissance before an act() call.
 */
export async function observe(opts: {
  sessionId: string;
  instruction?: string;
  timeoutMs?: number;
}): Promise<DriverOk<Array<{ description: string; selector?: string }>> | DriverError> {
  const att = await attach(opts.sessionId);
  if (!att.ok) return att;
  const sh = att.stagehand;
  return runStagehandOp<
    DriverOk<Array<{ description: string; selector?: string }>>
  >(
    async () => {
      // v3: observe is an instance method returning Action[] — map to the
      // stable {description, selector} shape our callers were built on.
      const result = await sh.observe(opts.instruction);
      const actions = Array.isArray(result) ? result : [];
      return {
        ok: true,
        data: actions.map((a) => {
          const rec = (a ?? {}) as { description?: unknown; method?: unknown; selector?: unknown };
          return {
            description: String(rec.description ?? rec.method ?? "action"),
            ...(typeof rec.selector === "string" ? { selector: rec.selector } : {}),
          };
        }),
      };
    },
    () => close(sh),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "observe",
  );
}

/**
 * Quick probe — is the package installed?
 *
 * Uses the same memoized loader so a diagnostics page that polls this
 * every few seconds doesn't repeatedly try to import a missing module.
 * A future `/api/browser/diagnostics` route (not yet shipped) will
 * surface this in the UI next to the Browserbase configured status.
 */
export async function isInstalled(): Promise<boolean> {
  const loaded = await loadStagehand();
  return loaded.ok;
}
