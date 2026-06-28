"use client";

/**
 * useOfflineQueue — queue chat messages while offline, replay when
 * back online, with smart retry and exponential backoff.
 *
 * Problem today: if Venice times out, the connection drops mid-stream,
 * or Nour's phone loses signal on the highway, the message just...
 * vanishes. No retry, no queue, nothing.
 *
 * This hook:
 *   1. Listens to navigator.onLine + online/offline events
 *   2. Persists queued messages to localStorage so they survive a
 *      page reload or app close
 *   3. When online, replays the queue in order via the sendMessage
 *      callback with exponential backoff between retries (3 attempts)
 *   4. Exposes status for the UI: "online" / "offline" / "queued N" /
 *      "retrying" so the chat page can show a status indicator
 *
 * Usage:
 *   const { status, queue, enqueue, clearQueue } = useOfflineQueue({
 *     sendMessage: (text) => chatClient.sendMessage({ text }),
 *   });
 *
 *   if (!navigator.onLine) enqueue(text);
 *   else chatClient.sendMessage({ text });
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "nour:chat:offline-queue";
const MAX_QUEUE = 50;
const BASE_RETRY_MS = 1500;
const MAX_RETRIES = 3;

export interface QueuedMessage {
  id: string;
  text: string;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

export type OfflineStatus =
  | "online"
  | "offline"
  | "queued"
  | "retrying"
  | "drained";

interface UseOfflineQueueOptions {
  sendMessage: (text: string) => Promise<void>;
  onDrained?: (count: number) => void;
}

interface UseOfflineQueueReturn {
  status: OfflineStatus;
  queue: QueuedMessage[];
  enqueue: (text: string) => void;
  clearQueue: () => void;
  retryNow: () => Promise<void>;
  isOnline: boolean;
}

function readQueue(): QueuedMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_QUEUE);
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q.slice(0, MAX_QUEUE)));
  } catch {
    // Quota exceeded or disabled — fail silently
  }
}

export function useOfflineQueue(options: UseOfflineQueueOptions): UseOfflineQueueReturn {
  // Start with an EMPTY queue every session.
  //
  // FIX (Apr 15): previously we read from localStorage on mount, which
  // caused a "duplicate + retry" bug in the chat. If a previous session
  // had any queued items (e.g. a transient network blip), they'd
  // auto-drain on next page load — replaying them AS new user
  // messages appended to whatever conversation was open. Combined
  // with React Strict Mode's double-mount the effect fired twice
  // and Nour saw his message appear twice with no response.
  //
  // The localStorage persistence was designed for phone-lost-signal-
  // mid-send scenarios but in practice it caused more confusion than
  // it saved. Items queued during THIS session still work (enqueue
  // writes to localStorage + updates state) — they just don't
  // survive a full reload.
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  // Apr 27 · HYDRATION-FIX — was reading navigator.onLine in the
  // useState initializer. On SSR navigator is undefined so the
  // default fell through to "offline", which made <ConnectionStatus>
  // render its floating pill server-side. On the client navigator
  // exists and is online, so the pill returned null. React hydration
  // diff:
  //   - server had: <div className="fixed bottom-16 left-1/2…">
  //   + client has: <style>
  // → the chat surface aborted hydration on every mount. Defer the
  // navigator read to a useEffect so SSR + first client render match
  // ("online" → null pill); the post-mount effect picks up the real
  // state and only THEN switches to offline if needed.
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [status, setStatus] = useState<OfflineStatus>("online");
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!navigator.onLine) {
      setTimeout(() => {
        setIsOnline(false);
        setStatus("offline");
      }, 0);
    }
  }, []);
  const drainingRef = useRef(false);
  const sendMessageRef = useRef(options.sendMessage);
  const onDrainedRef = useRef(options.onDrained);

  // Clear any stale queue from a prior session on first mount. This is
  // load-bearing — without it the duplicate bug resurfaces.
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }, []);

  // Keep ref fresh without retriggering effects
  useEffect(() => {
    sendMessageRef.current = options.sendMessage;
    onDrainedRef.current = options.onDrained;
  }, [options.sendMessage, options.onDrained]);

  // Persist queue
  useEffect(() => {
    writeQueue(queue);
  }, [queue]);

  // Listen for online/offline events
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleOnline() {
      setIsOnline(true);
      setStatus(queue.length > 0 ? "retrying" : "online");
    }
    function handleOffline() {
      setIsOnline(false);
      setStatus("offline");
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queue.length]);

  const enqueue = useCallback((text: string) => {
    if (!text.trim()) return;
    const msg: QueuedMessage = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      enqueuedAt: Date.now(),
      attempts: 0,
    };
    setQueue((prev) => {
      const next = [...prev, msg].slice(-MAX_QUEUE);
      return next;
    });
    setStatus("queued");
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setStatus(isOnline ? "online" : "offline");
  }, [isOnline]);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    if (queue.length === 0) return;
    if (!isOnline) return;

    drainingRef.current = true;
    setStatus("retrying");

    const work = [...queue];
    const failures: QueuedMessage[] = [];
    let delivered = 0;

    for (const msg of work) {
      let success = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await sendMessageRef.current(msg.text);
          success = true;
          break;
        } catch (err) {
          msg.attempts++;
          msg.lastError = (err as Error).message || "unknown";
          // Exponential backoff: 1.5s, 3s, 6s
          const backoff = BASE_RETRY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
      if (success) {
        delivered++;
      } else {
        failures.push(msg);
      }
    }

    setQueue(failures);

    if (failures.length === 0) {
      setStatus("drained");
      onDrainedRef.current?.(delivered);
      // Auto-clear the drained state back to "online" after 2s so the
      // indicator doesn't linger forever.
      setTimeout(() => {
        setStatus((s) => (s === "drained" ? "online" : s));
      }, 2000);
    } else {
      setStatus("queued");
    }

    drainingRef.current = false;
  }, [queue, isOnline]);

  // Auto-drain when coming back online.
  //
  // Apr 19 · Removed `drainQueue` from deps. drainQueue is a
  // useCallback with [queue, isOnline] deps, so its identity changes
  // every time the queue mutates — which includes when drainQueue
  // itself calls setQueue(failures). That created a subtle
  // "drainQueue identity changed → effect re-runs → called drainQueue
  // again" cycle that could, under rapid network flapping, cascade
  // into React's max-update-depth guard. The closure captures the
  // latest drainQueue anyway (it's declared above); we only need the
  // effect to re-fire when the actual online state or queue size
  // shifts, which is already covered.
  useEffect(() => {
    if (isOnline && queue.length > 0) {
      setTimeout(() => {
        void drainQueue();
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, queue.length]);

  const retryNow = useCallback(async () => {
    await drainQueue();
  }, [drainQueue]);

  return {
    status,
    queue,
    enqueue,
    clearQueue,
    retryNow,
    isOnline,
  };
}
