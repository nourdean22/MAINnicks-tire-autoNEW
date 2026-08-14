import { create } from "zustand";

/**
 * Media dock store (BDN-311, 2026-08-14) — media plan item #2.
 *
 * WHY A DOCK AT ALL
 * BDN-309 made media VISIBLE in the transcript. That is not the same as
 * WATCHABLE: an inline player dies the moment the message scrolls out of
 * view, and a streaming reply pushes it out within seconds. The dock is
 * the difference between "video appears in chat" and "watching video
 * inside chat is useful" — playback survives scrolling, new messages, and
 * navigation within the chat surface.
 *
 * SEPARATE STORE, DELIBERATELY
 * chat-ui-store owns turn/transport concerns and already carries
 * `isVoiceDocked`. Playback is a different lifetime — it outlives a turn
 * — so it gets its own store rather than growing that one. Both live in
 * features/chat-v2/stores/, which is why that is a directory.
 *
 * NOT PERSISTED, ON PURPOSE
 * Resume positions live in memory only. Media plan item #7 is explicit
 * that watching something must not silently become a durable record —
 * "Save to memory" is an operator action, never a side effect of pressing
 * play. A localStorage write here would quietly build a viewing history
 * the operator never asked for.
 *
 * NO AUTOPLAY. `dock()` is only ever called from a user gesture.
 */

export type DockedMediaKind = "video" | "audio";

export interface DockedMedia {
  /** Stable id — message part identity, used to key resume positions. */
  id: string;
  url: string;
  kind: DockedMediaKind;
  title: string;
}

/**
 * A seek request carries a TOKEN, not just a timestamp.
 *
 * Without it, asking to seek to 4:12 twice in a row is a no-op: the state
 * is unchanged, so the effect that performs the seek never re-runs and
 * the second click does nothing. That is the bug shape that makes
 * clickable transcript timestamps (item #3) feel broken intermittently —
 * it only misfires when you click the SAME timestamp again, which is
 * exactly what someone re-watching a moment does.
 */
export interface SeekRequest {
  token: number;
  seconds: number;
}

export type MediaDockState = {
  item: DockedMedia | null;
  queue: DockedMedia[];
  expanded: boolean;
  /** Consumed by the player, then cleared. Null = nothing pending. */
  seek: SeekRequest | null;
  /** id → last known playback offset, in seconds. Memory only. */
  resumeAt: Record<string, number>;

  dock: (item: DockedMedia) => void;
  enqueue: (item: DockedMedia) => void;
  playNext: () => void;
  close: () => void;
  setExpanded: (expanded: boolean) => void;
  toggleExpanded: () => void;
  requestSeek: (seconds: number) => void;
  consumeSeek: () => void;
  rememberPosition: (id: string, seconds: number) => void;
};

/** Monotonic, so two identical seeks are still two distinct requests. */
let seekToken = 0;

export const useMediaDockStore = create<MediaDockState>((set, get) => ({
  item: null,
  queue: [],
  expanded: false,
  seek: null,
  resumeAt: {},

  dock: (item) =>
    set((s) => {
      // Re-docking what is already playing must not restart it — the
      // player would remount and lose its position.
      if (s.item?.id === item.id) return {};
      return { item, seek: null, expanded: s.expanded };
    }),

  enqueue: (item) =>
    set((s) => {
      if (!s.item) return { item };
      if (s.item.id === item.id || s.queue.some((q) => q.id === item.id)) return {};
      return { queue: [...s.queue, item] };
    }),

  playNext: () =>
    set((s) => {
      const [next, ...rest] = s.queue;
      if (!next) return { item: null, queue: [], expanded: false };
      return { item: next, queue: rest, seek: null };
    }),

  close: () => set({ item: null, queue: [], expanded: false, seek: null }),

  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),

  requestSeek: (seconds) => {
    // Negative timestamps are a parsing artifact, not an intent.
    if (!Number.isFinite(seconds) || seconds < 0) return;
    seekToken += 1;
    set({ seek: { token: seekToken, seconds } });
  },

  consumeSeek: () => {
    if (get().seek === null) return;
    set({ seek: null });
  },

  rememberPosition: (id, seconds) =>
    set((s) => {
      if (!Number.isFinite(seconds) || seconds < 0) return {};
      return { resumeAt: { ...s.resumeAt, [id]: seconds } };
    }),
}));

/** Test seam — resets module state the store itself cannot reach. */
export function __resetMediaDockForTest() {
  seekToken = 0;
  useMediaDockStore.setState({
    item: null,
    queue: [],
    expanded: false,
    seek: null,
    resumeAt: {},
  });
}
