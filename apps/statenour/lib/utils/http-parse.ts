/**
 * AI-route input/output safety helpers · v8.0.1 · 2026-04-29.
 *
 * Extracted from lib/utils/http.ts so they can be unit-tested without
 * dragging in auth-guard / next-auth (which has an ESM-resolution
 * collision with vitest's default loader).
 *
 * Two distinct error classes that used to all become 500s + email alerts:
 *
 *   1. Bad client input          → 400 with structured field errors,
 *                                  console.warn (NOT error) so Vercel
 *                                  doesn't fire alerts on every typo.
 *   2. AI returned malformed JSON → 502 with a "please retry" hint,
 *                                  same console.warn discipline. The
 *                                  upstream is bad, not us.
 *   3. Real server crashes        → 500 + console.error + alert (the
 *                                  signal stays valid).
 *
 * Re-exported from lib/utils/http.ts for back-compat with existing
 * route imports.
 */

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

export type SafeParseBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

/**
 * Parse a JSON request body against a Zod schema. On failure, returns
 * a 400 Response with `{error, code: "INVALID_INPUT", issues}`. The
 * caller short-circuits with `if (!parsed.ok) return parsed.response`.
 *
 * Logs as `console.warn` (not error) so the failure doesn't trigger
 * Vercel's runtime-error email alerts on bad client input.
 */
export async function safeParseBody<T>(
  schema: z.ZodSchema<T>,
  req: Request,
  routeName: string,
): Promise<SafeParseBodyResult<T>> {
  const raw = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  console.warn(`[${routeName}] invalid input`, {
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    })),
  });
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Invalid request body",
        code: "INVALID_INPUT",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join(".") || "(root)",
          message: i.message,
        })),
      },
      { status: 400 },
    ),
  };
}

/**
 * Wrap an AI route's catch block: ZodErrors that bubble up from
 * downstream parses (the AI returned malformed JSON we tried to
 * Zod-validate) become 502 with a retry hint. Real server errors
 * stay 500. Use as the default branch in `} catch (err) { ... }`.
 *
 *   catch (err) {
 *     return aiRouteError(err, "track-story", "Failed to track story");
 *   }
 */
export function aiRouteError(
  err: unknown,
  routeName: string,
  fallbackMessage: string,
): Response {
  // Downstream Zod parse failure (e.g. AI returned an unexpected shape).
  if (err instanceof ZodError || (err && typeof err === "object" && "issues" in err)) {
    console.warn(`[${routeName}] downstream parse failed`, err);
    return NextResponse.json(
      { error: "AI returned an unexpected shape — please retry", code: "AI_BAD_SHAPE" },
      { status: 502 },
    );
  }
  // Real server error — keep the alert signal.
  console.error(`[${routeName}]`, err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : fallbackMessage },
    { status: 500 },
  );
}
