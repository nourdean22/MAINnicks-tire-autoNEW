/**
 * lib/types/branded.ts · Phase O.3 (2026-05-18 PM)
 *
 * Branded (nominal) types for primitive units that have semantic
 * meaning the type system doesn't capture by default.
 *
 * Bug classes this prevents:
 *   · Passing a percentage (0-100) where a normalized confidence
 *     (0-1) is expected · the codebase has both `confidence * 100`
 *     and `confidence.toFixed(0) + "%"` patterns scattered
 *   · Passing a string ID of one entity where another entity's ID
 *     is expected (BrainMemoryId vs TraceId vs ReservationId)
 *   · Mixing minutes vs ms vs seconds in timing math
 *
 * Trade-off: callers must use the asConfidence() / asUsd() / asMs()
 * constructors to brand a raw number. This is explicit · sometimes
 * verbose · but makes the type system catch the bug class at compile
 * time. We adopt branded types ONLY at API boundaries · internal
 * arithmetic stays on raw numbers.
 *
 * Scope: lib-level new types · H+ surfaces. Legacy code keeps raw
 * numbers · no big-bang migration.
 */

declare const __brand: unique symbol;

type Brand<TBase, TBrand extends string> = TBase & { readonly [__brand]: TBrand };

// ── Numeric units ──────────────────────────────────────────────────

/** A normalized confidence value · always in [0, 1] · used by the
 *  reasoning engine's trace.confidence field and the wisdom matcher. */
export type Confidence = Brand<number, "Confidence">;

export function asConfidence(n: number): Confidence {
  // Runtime clamp · guards against caller mistakes at the boundary
  const clamped = Math.max(0, Math.min(1, n));
  return clamped as Confidence;
}

/** USD amount · used by budget cap + reservation + persisted trace
 *  cost. Never negative · we round at 4-decimal precision (0.0001 USD). */
export type UsdAmount = Brand<number, "UsdAmount">;

export function asUsd(n: number): UsdAmount {
  const rounded = Math.max(0, Math.round(n * 10000) / 10000);
  return rounded as UsdAmount;
}

/** Milliseconds · positive integer · used by latency + duration fields. */
export type Milliseconds = Brand<number, "Milliseconds">;

export function asMs(n: number): Milliseconds {
  return Math.max(0, Math.round(n)) as Milliseconds;
}

// ── String IDs ─────────────────────────────────────────────────────

/** BrainMemory.id · cuid string · NOT interchangeable with other ID
 *  types even though both are strings. */
export type BrainMemoryId = Brand<string, "BrainMemoryId">;

export function asBrainMemoryId(s: string): BrainMemoryId {
  // No format validation here · Prisma already enforces cuid pattern
  // at write time · this is purely a type-safety brand.
  return s as BrainMemoryId;
}

/** Reasoning trace correlation id · `err_<base36>` from the
 *  H.7.1 sanitizer · grep-able in Railway runtime logs. */
export type ErrorId = Brand<string, "ErrorId">;

export function asErrorId(s: string): ErrorId {
  return s as ErrorId;
}

/** Idempotency key · client-generated nanoid · validated server-side
 *  via lookupIdempotency (N.1). */
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

export function asIdempotencyKey(s: string): IdempotencyKey {
  return s as IdempotencyKey;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Convert a branded value back to its underlying primitive type ·
 *  use sparingly at the OUTPUT boundary (e.g. when serializing for
 *  the wire). Inside the system, keep things branded. */
export function unbrand<T extends number | string>(v: Brand<T, string>): T {
  return v as unknown as T;
}
