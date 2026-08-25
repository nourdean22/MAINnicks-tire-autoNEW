/**
 * Client-side access to the API envelope, typed so the envelope is unreachable.
 *
 * THE DEFECT, and it shipped in three live components at once. `apiHandler`
 * wraps every response as `{ ok, data, meta }`. A caller doing
 *
 *     const data = (await res.json()) as Thing[];
 *
 * gets the ENVELOPE and a cast that says otherwise. TypeScript is satisfied —
 * `as` is an assertion, not a check — so nothing fails at build time and the
 * component quietly renders the wrong thing:
 *
 *   · self-critique-card.tsx    `Array.isArray(envelope)` is false, so the list
 *                               falls back to [] and the panel renders NOTHING.
 *   · location-ranking-card.tsx `envelope.found` is undefined, so the card is
 *                               permanently "not found" even on a 200.
 *   · OpportunityCard.tsx       the POST succeeds and the UI never updates,
 *                               because the field it reads lives under .data.
 *
 * Every one of those is a 200 response the operator sees as an empty or broken
 * panel. Nothing logs, nothing throws, nothing turns red.
 *
 * WHY A TYPED FETCH RATHER THAN "REMEMBER TO UNWRAP". A rule that says "unwrap
 * the envelope" is the same category of thing as the ET-clock helper that
 * reached 108 files and stopped at 38: correct, documented, and not enforced.
 * `apiFetch<T>` returns `T`, never `ApiResponse<T>`, so the envelope is not a
 * thing a caller can accidentally hold. The mistake stops being available.
 *
 * WHY `rawFetch` EXISTS, and why it is not a loophole. 143 of 381 routes do not
 * envelope (measured 2026-08-24: 238 do, 62%). A caller hitting one of those
 * legitimately needs the parsed body as-is. `rawFetch` is how you say so out
 * loud — and unlike a cast, it CHECKS: it throws the moment that route starts
 * enveloping, which is the only reason converting a correct cast to it is worth
 * doing at all. See its own header. The lint that forbids bare `res.json()`
 * has NO exemption list — it requires you to pick one of these two and thereby
 * to state which contract you believe you are calling. That is the same move as
 * the completion-frame `frame` field: the guard does not ban the hard case, it
 * bans doing it silently.
 */
import type { ApiResponse } from "./http";

/** Thrown when the envelope reports failure, so callers get a real error. */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function isEnvelope(v: unknown): v is ApiResponse<unknown> {
  return typeof v === "object" && v !== null && "ok" in v && "meta" in v;
}

/**
 * Pull `data` out of a parsed envelope, or throw.
 *
 * Exported separately from `apiFetch` for callers that already hold a parsed
 * body — and so the unwrap logic can be tested without a network layer.
 *
 * A body that is NOT an envelope is returned untouched rather than throwing:
 * this function must be safe to point at a non-enveloping route during a
 * migration, otherwise it becomes something people route around.
 */
export function unwrapApi<T>(body: unknown, status = 200): T {
  if (!isEnvelope(body)) return body as T;
  if (body.ok === false) {
    throw new ApiError(body.error ?? "request failed", status, body.details);
  }
  return body.data as T;
}

export interface ApiFetchInit extends RequestInit {
  /** Return `undefined` instead of throwing when the response is a 4xx/5xx. */
  tolerateHttpError?: boolean;
}

/**
 * Fetch an ENVELOPED route and get the payload.
 *
 * Returns `T`, never `ApiResponse<T>` — that is the whole design. `credentials:
 * "include"` is the default because every operator-private route needs it and
 * forgetting it produces a 401 that reads like an empty result.
 */
export async function apiFetch<T>(input: string, init: ApiFetchInit = {}): Promise<T> {
  const { tolerateHttpError, ...rest } = init;
  const res = await fetch(input, { credentials: "include", ...rest });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    throw new ApiError("response was not JSON", res.status);
  }

  if (!res.ok) {
    // An enveloped error carries a real message; use it rather than the status.
    if (isEnvelope(body) && body.error) throw new ApiError(body.error, res.status, body.details);
    if (tolerateHttpError) return undefined as T;
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }

  return unwrapApi<T>(body, res.status);
}

/**
 * Fetch a route that does NOT envelope, and say so — then hold it to that.
 *
 * Not an escape hatch. A declaration WITH A CHECK, and the check is the whole
 * reason this function is worth calling.
 *
 * MEASURED 2026-08-24: of the 18 remaining unchecked casts on our own `/api/`
 * routes, ZERO are live defects — every one hits a route that genuinely does
 * not envelope. So converting them is not a bug fix. Its value is entirely
 * prospective, and it only exists if this function does something a cast does
 * not:
 *
 *     someone wraps `/api/ai/goals-brief` in `apiHandler` — a one-line,
 *     obviously-correct change, the direction 62% of routes have already gone —
 *     and `nicks-goals-brief.tsx` starts rendering an empty brief forever, on a
 *     200, with nothing red anywhere.
 *
 * A plain `as T` cannot see that happen. Neither could a `rawFetch` that merely
 * renamed the cast. So this one THROWS when the body is an envelope, naming the
 * route and the fix. The failure moves from "silent, weeks later, found by a
 * human noticing a blank panel" to "loud, immediate, at the commit that caused
 * it".
 *
 * THE ASYMMETRY IS DELIBERATE. `apiFetch` is tolerant — a non-enveloped body
 * passes through, so it stays usable mid-migration. `rawFetch` is strict — it
 * asserts the route still does not envelope. Tolerant in the direction that is
 * safe; strict in the direction that silently corrupts a render.
 */
export async function rawFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, { credentials: "include", ...init });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const body: unknown = await res.json();
  if (isEnvelope(body)) {
    throw new ApiError(
      `${input} now returns the API envelope — switch this call to apiFetch<T>()`,
      res.status,
      body,
    );
  }
  return body as T;
}
