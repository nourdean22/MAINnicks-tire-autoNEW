/**
 * Circuit breaker for image-generation providers.
 *
 * WHY (Railway logs 2026-09-29 → 2026-10-01, every static autopost): the
 * image ladder tried Higgsfield (`not_enough_credits`), then OpenRouter
 * (`402 Insufficient credits`), then Hugging Face FLUX.1-schnell (`410 Gone —
 * model deprecated`) before the working direct-Gemini route produced the
 * pixels. Three dead hops, three error logs and ~10 s of latency on every
 * generation, repeated at every slot, with no memory that the same providers
 * failed the same way an hour earlier.
 *
 * A provider that answers "no money" or "this model no longer exists" is
 * not going to answer differently on the next post. This module remembers
 * the failure class and skips the provider until the cooldown lapses:
 *
 *   credits   → 6 h  (an operator top-up is a human action; re-probe a few
 *                      times a day so recovery is automatic)
 *   retired   → 24 h (a retired model needs a code change; the daily re-probe
 *                      is only there so a renamed endpoint self-heals)
 *   transient → 0    (timeouts, 5xx: retry next time as before)
 *
 * In-memory on purpose: one process, one replica, and the worst case of a
 * restart is one extra probe. Nothing here decides WHICH provider is best —
 * that is the ladder in igAutopost.generatePostImage; this only stops it
 * knocking on doors it knows are locked.
 */

export type ImageProvider = "higgsfield" | "openrouter" | "gemini" | "openai";
export type FailureClass = "credits" | "retired" | "transient";

const COOLDOWN_MS: Record<FailureClass, number> = {
  credits: 6 * 60 * 60_000,
  retired: 24 * 60 * 60_000,
  transient: 0,
};

interface OpenCircuit {
  klass: FailureClass;
  reason: string;
  openedAt: number;
  until: number;
}

const circuits = new Map<ImageProvider, OpenCircuit>();

/** Classify a provider error by its message. Pure; exported for tests. */
export function classifyProviderFailure(err: unknown): FailureClass {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/not_enough_credits|insufficient[ _]credits|402|payment required|quota exceeded|billing/.test(msg)) return "credits";
  if (/410|deprecated|no longer supported|model not found|does not exist|has been retired/.test(msg)) return "retired";
  return "transient";
}

/** Record a failure. Returns the class so the caller can log it once. */
export function tripCircuit(provider: ImageProvider, err: unknown, now = Date.now()): FailureClass {
  const klass = classifyProviderFailure(err);
  const cooldown = COOLDOWN_MS[klass];
  if (cooldown <= 0) return klass;
  const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  circuits.set(provider, { klass, reason, openedAt: now, until: now + cooldown });
  return klass;
}

/** Open = skip this provider. Returns the open record so the skip can be logged with its cause. */
export function circuitOpen(provider: ImageProvider, now = Date.now()): OpenCircuit | null {
  const c = circuits.get(provider);
  if (!c) return null;
  if (now >= c.until) {
    circuits.delete(provider);
    return null;
  }
  return c;
}

/** A success closes the circuit immediately (a top-up landed). */
export function closeCircuit(provider: ImageProvider): void {
  circuits.delete(provider);
}

/** Read-only snapshot for health surfaces. */
export function circuitSnapshot(now = Date.now()): Array<{ provider: ImageProvider; klass: FailureClass; reason: string; untilIso: string }> {
  const out: Array<{ provider: ImageProvider; klass: FailureClass; reason: string; untilIso: string }> = [];
  for (const [provider, c] of circuits) {
    if (now < c.until) out.push({ provider, klass: c.klass, reason: c.reason, untilIso: new Date(c.until).toISOString() });
  }
  return out;
}

/** Tests only. */
export function __resetCircuits(): void {
  circuits.clear();
}
