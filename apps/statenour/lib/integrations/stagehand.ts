/**
 * Stagehand driver — G1 driver layer on top of Browserbase sessions.
 *
 * Stagehand (@browserbasehq/stagehand) is Browserbase's LLM-native
 * page controller. It wraps Playwright with three natural-language
 * primitives:
 *   · page.act("click the sign-in button")
 *   · page.extract({ instruction, schema })  // Zod-typed return
 *   · page.observe("find the login form")
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
 * Minimal structural type for the bits of Stagehand we use. We keep
 * our own type rather than `typeof import(...)` because the package
 * may not be installed yet (the dynamic import is runtime-only and
 * the structural type lets tsc compile without the dep on disk).
 */
interface StagehandCtor {
  new (opts: {
    env: "BROWSERBASE" | "LOCAL";
    apiKey: string;
    projectId: string;
    browserbaseSessionID?: string;
    modelName?: string;
  }): StagehandInstance;
}
interface StagehandInstance {
  init(): Promise<void>;
  close(): Promise<void>;
  page: StagehandPage;
}
interface StagehandPage {
  goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  act(opts: { action: string }): Promise<{ success?: boolean; message?: string } | undefined>;
  extract<T>(opts: { instruction: string; schema: unknown }): Promise<T>;
  observe(opts?: { instruction?: string }): Promise<Array<{ description: string; selector?: string }> | undefined>;
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
    // Stagehand takes the browserbase session id via browserbaseSessionID
    // and drives Chrome through CDP. env=BROWSERBASE tells it to not
    // spin a local browser.
    const stagehand = new loaded.Stagehand({
      env: "BROWSERBASE",
      apiKey: bb.apiKey,
      projectId: bb.projectId,
      browserbaseSessionID: sessionId,
      // modelName omitted — Stagehand picks a sensible default; we
      // can pin later when we want consistency.
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
      await sh.page.goto(opts.url, { waitUntil: opts.waitUntil ?? "networkidle" });
      const title = await sh.page.title();
      const url = sh.page.url();
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
      const result = await sh.page.act({ action: opts.instruction });
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
      const result = (await sh.page.extract({
        instruction: opts.instruction,
        schema: opts.schema,
      })) as T;
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
      const result = await sh.page.observe(
        opts.instruction ? { instruction: opts.instruction } : undefined,
      );
      return { ok: true, data: Array.isArray(result) ? result : [] };
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
