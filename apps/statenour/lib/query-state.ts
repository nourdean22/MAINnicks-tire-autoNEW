/**
 * The one shared read of a query's honest state (truth sweep 2026-10-23).
 *
 * Four states, never two. A PWA with no connection leaves a tRPC query PAUSED: no data, no error,
 * and `isLoading` false (react-query v5 isLoading means "fetching AND pending"). A panel that read
 * `data` and `isError` and nothing else drew that as empty, zero, idle or hidden. This reads
 * `fetchStatus` once so every panel can say which of the four it is in:
 *
 *   ready    data is in hand (stale data beats a blank, even if a later refetch failed or paused)
 *   offline  paused with no data: the connection returns, the read runs
 *   error    the read failed, or finished with nothing: state unknown, never empty
 *   loading  on its way
 *
 * The house three-state form (components/brain/judgment-quality-panel.tsx) is the `error` copy.
 */
import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

export type ReadState = "ready" | "loading" | "offline" | "error";

export interface ReadStateInput {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  fetchStatus?: string;
}

export function readState(q: ReadStateInput): ReadState {
  if (q.data !== undefined) return "ready";
  if (q.fetchStatus === "paused") return "offline";
  if (q.isError) return "error";
  if (q.isLoading || q.isPending) return "loading";
  // No data, nothing in flight, no error: an unknown, not a clean read.
  return "error";
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
