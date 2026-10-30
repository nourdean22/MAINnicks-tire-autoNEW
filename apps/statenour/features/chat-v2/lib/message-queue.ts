/**
 * Messages typed while Nick is still replying (W2, 2026-10-30, Nour: "queue messages ... even while
 * its still working"). Kept in localStorage so a reload keeps them; one per browser, each tagged
 * with the conversation it was typed in so a switched chat never receives another chat's message.
 * The composer removes an item BEFORE handing it to the normal send, so it can never send twice.
 */
export interface QueuedMessage {
  id: string;
  text: string;
  /** null = typed in a chat that had no id yet (its first reply was still running). */
  conversationId: string | null;
}

const KEY = "nick-chat-queue";
export const EMPTY_QUEUE: QueuedMessage[] = [];
/** Where the queue lives when localStorage throws (private mode): this page only, gone on reload. */
let memory: QueuedMessage[] = EMPTY_QUEUE;
const listeners = new Set<() => void>();

export function loadQueue(): QueuedMessage[] {
  let stored: string | null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  try {
    const raw: unknown = JSON.parse(stored ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (q): q is QueuedMessage =>
        Boolean(q) &&
        typeof q.id === "string" &&
        typeof q.text === "string" &&
        (q.conversationId === null || typeof q.conversationId === "string"),
    );
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueuedMessage[]): void {
  memory = queue;
  try {
    if (queue.length > 0) localStorage.setItem(KEY, JSON.stringify(queue));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or full storage: `memory` keeps it for this page; it won't survive a reload.
  }
  listeners.forEach((l) => l());
}

// useSyncExternalStore glue: one cached array per stored string, so React sees a stable snapshot,
// and another tab's write (the storage event) re-renders this one.
let cachedRaw: string | null | undefined;
let cached: QueuedMessage[] = EMPTY_QUEUE;
export function getQueueSnapshot(): QueuedMessage[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = raw ? loadQueue() : EMPTY_QUEUE;
  }
  return cached;
}
export function subscribeQueue(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Items typed in this chat. A new chat's items (null) are re-tagged when it gets an id. */
export function forConversation(queue: QueuedMessage[], conversationId: string | null): QueuedMessage[] {
  return queue.filter((q) => q.conversationId === conversationId);
}
