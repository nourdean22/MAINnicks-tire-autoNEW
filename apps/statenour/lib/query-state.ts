/**
 * The one shared read of a query's honest state (truth sweep 2026-10-23, review fix 2026-10-24).
 *
 * Five states, never two. A PWA with no connection leaves a tRPC query PAUSED: no data, no error,
 * and `isLoading` false (react-query v5 isLoading means "fetching AND pending"). A panel that read
 * `data` and `isError` and nothing else drew that as empty, zero, idle or hidden. This reads
 * `fetchStatus` and `isError` once so every panel can say which of the five it is in:
 *
 *   ready    data is in hand and the last refresh did not fail
 *   stale    data is in hand but the LAST REFRESH FAILED: keep drawing the data, and say so above it
 *            (a 60 s poll that fails must not leave old numbers looking current)
 *   offline  paused with no data: the connection returns, the read runs
 *   error    the read failed, or finished with nothing: state unknown, never empty
 *   loading  on its way
 *
 * A caller that draws data must render `<ReadStateNote state={status} />` above it: the note is
 * null for ready and loading, so passing the state unconditionally is correct. Offline is only
 * ever reached WITHOUT data; a paused refetch over cached data stays `ready` (the cache beats a
 * blank, and nothing failed). react-query's onlineManager starts ONLINE, so a PWA launched with
 * no connection fires the fetch, the fetch fails, and the panel shows the `error` note, not
 * `offline`; `offline` needs a connection that drops while the app is open (the offline event).
 *
 * The house three-state form (components/brain/judgment-quality-panel.tsx) is the `error` copy.
 */
import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

export type ReadState = "ready" | "stale" | "loading" | "offline" | "error";

export interface ReadStateInput {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: string;
}

export function readState(q: ReadStateInput): ReadState {
  if (q.data !== undefined) return q.isError ? "stale" : "ready";
  if (q.fetchStatus === "paused") return "offline";
  if (q.isError) return "error";
  if (q.isLoading || q.isPending) return "loading";
  // No data, nothing in flight, no error: an unknown, not a clean read.
  return "error";
}

/**
 * A Retry is running. After a failure `readState` stays `error` or `stale` (the failure is still
 * the truth until a read succeeds), so the note's button reads this to show "Retrying".
 */
export function isRetrying(q: ReadStateInput): boolean {
  return q.fetchStatus === "fetching";
}

/** The signal react-query pauses on, for reads that are not queries (a bare fetch in an effect). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export const offlineCopy = (label: string) => `Offline. ${label} shows when the connection returns.`;
export const errorCopy = (label: string) => `${label} could not load. State unknown, not empty.`;
export const staleCopy = (label: string) => `Last refresh failed. ${label} below may be out of date.`;
