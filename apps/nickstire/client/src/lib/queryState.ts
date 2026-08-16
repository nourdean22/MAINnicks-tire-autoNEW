/**
 * Did the read actually happen? — the guard shape this admin keeps re-losing.
 *
 * THE TRAP. react-query pauses queries when the browser reports offline
 * (`networkMode: 'online'`, the default). A paused query has `status: 'pending'`
 * and `fetchStatus: 'paused'`, which means:
 *
 *     isError   === false     (nothing failed)
 *     isLoading === false     (isLoading is pending && FETCHING, and it isn't)
 *     data      === undefined (nothing arrived)
 *
 * So a component that branches `isError ? unknown : data?.length ? list : empty`
 * falls through to its EMPTY state and states, confidently, that there is
 * nothing there — when the truth is that it never looked. On the operator's
 * phone, in a standalone PWA on a flaky connection, this is the normal case, not
 * an edge case.
 *
 * Eleven such sites were closed across #1336–#1343 and #1347 ("$0 RECOVERABLE",
 * "0 · All clear", "All eligible customers have already been contacted"). The
 * shape was recorded in prose in docs/IG-ADMIN-PLAN-GATE-2026-08-05.md — guard
 * on DATA, not on `isError` alone — and three more sites were still written
 * wrong afterwards. Prose did not hold it, so this does.
 *
 * `unavailable` deliberately merges "errored" with "paused/never ran": both mean
 * the same thing to the operator — WE DO NOT KNOW — and the UI must not imply
 * emptiness for either. Where the distinction matters (a retry button vs a
 * connectivity hint), read `reason`.
 */

/** The four states a read can be in that a surface must render differently. */
export type ReadState = "loading" | "unavailable" | "empty" | "ready";

export interface ReadStatus {
  state: ReadState;
  /** Why it is unavailable — for copy that tells the operator what to do. */
  reason?: "error" | "not_attempted";
}

/** The subset of a react-query result this needs. Structural, so it accepts
 *  tRPC's result objects without importing react-query types. */
export interface QueryLike {
  isError: boolean;
  isLoading: boolean;
  /** Present on react-query v5 results; `pending` covers the paused case that
   *  `isLoading` cannot see. Optional so older/partial call sites still work. */
  isPending?: boolean;
  fetchStatus?: "fetching" | "paused" | "idle";
  data?: unknown;
}

/**
 * Classify one query.
 *
 * `isEmpty` decides what "nothing to show" means for THIS data — an empty array,
 * a zero count, a null object. It is a callback rather than a length check
 * because "empty" is domain-specific and guessing it wrong is how a real zero
 * gets reported as a failure.
 */
export function readStatus(q: QueryLike, isEmpty?: (data: unknown) => boolean): ReadStatus {
  if (q.isError) return { state: "unavailable", reason: "error" };

  // Genuinely in flight. `fetchStatus === 'fetching'` is the honest signal;
  // isLoading is kept for call sites that do not pass fetchStatus.
  if (q.fetchStatus === "fetching" || q.isLoading) return { state: "loading" };

  // Not loading, not errored, and nothing arrived. This is the paused/offline
  // case — and also a query still gated by `enabled: false`. Either way the read
  // did not happen, so emptiness cannot be claimed.
  if (q.data === undefined || q.data === null) {
    return { state: "unavailable", reason: "not_attempted" };
  }

  if (isEmpty ? isEmpty(q.data) : false) return { state: "empty" };
  return { state: "ready" };
}

/** Convenience for the common `data` shape of an array. */
export function readStatusOfList(q: QueryLike): ReadStatus {
  return readStatus(q, (d) => Array.isArray(d) && d.length === 0);
}

/**
 * Operator-facing copy for an unavailable read.
 *
 * Kept here so every surface says the same thing, and so none of them blames a
 * cause it has not established — the feed's empty state used to read "Make sure
 * Instagram credentials are set", which is a diagnosis, not an observation.
 */
export function unavailableCopy(reason: ReadStatus["reason"]): string {
  return reason === "error"
    ? "Could not read this — unknown, not empty."
    : "This has not been read yet — unknown, not empty. Check your connection.";
}
