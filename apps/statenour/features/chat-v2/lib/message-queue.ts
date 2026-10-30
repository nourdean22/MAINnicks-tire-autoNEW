/**
 * Messages typed while Nick is still replying (W2, 2026-10-30, Nour: "queue messages ... even while
 * its still working"). Kept in localStorage so a reload keeps them; one list per browser, each item
 * tagged with the chat it was typed in, so a switched chat never receives another chat's message.
 * A chat with no id yet cannot queue (the composer refuses): tagging such items to "whichever chat
 * gets an id next" sent them into the wrong chat when the operator opened History (Codex P1).
 *
 * Every read-modify-write runs under one cross-tab lock (mutateQueue), so two tabs cannot overwrite
 * each other's additions or both take the same message.
 */
export interface QueuedMessage {
  id: string;
  text: string;
  conversationId: string;
}

const KEY = "nick-chat-queue";
const LOCK = "nick-chat-queue";
export const EMPTY_QUEUE: QueuedMessage[] = [];
/** The queue when localStorage cannot be written (private mode, full quota): this page only. */
let memory: QueuedMessage[] = EMPTY_QUEUE;
/** The last write failed: storage holds an older list, so reads come from `memory` until a write lands. */
let writeFailed = false;
const listeners = new Set<() => void>();

function parse(stored: string | null): QueuedMessage[] {
  try {
    const raw: unknown = JSON.parse(stored ?? "[]");
    if (!Array.isArray(raw)) return EMPTY_QUEUE;
    return raw.filter(
      (q): q is QueuedMessage =>
        Boolean(q) && typeof q.id === "string" && typeof q.text === "string" && typeof q.conversationId === "string",
    );
  } catch {
    return EMPTY_QUEUE;
  }
}

export function loadQueue(): QueuedMessage[] {
  if (writeFailed) return memory;
  try {
    return parse(localStorage.getItem(KEY));
  } catch {
    return memory;
  }
}

export function saveQueue(queue: QueuedMessage[]): void {
  memory = queue;
  try {
    if (queue.length > 0) localStorage.setItem(KEY, JSON.stringify(queue));
    else localStorage.removeItem(KEY);
    writeFailed = false;
  } catch {
    writeFailed = true;
  }
  listeners.forEach((l) => l());
}

/**
 * Read, change and write the queue as one step for every tab (navigator.locks; a browser without it
 * runs the step directly). `change` returns the new list and, optionally, a value to hand back.
 */
export async function mutateQueue<T = void>(
  change: (queue: QueuedMessage[]) => { next: QueuedMessage[]; result?: T },
): Promise<T | undefined> {
  const step = async () => {
    const { next, result } = change(loadQueue());
    saveQueue(next);
    return result;
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(LOCK, step) : step();
}

/** Drop a deleted chat's waiting messages, so they do not linger invisible in storage. */
export function purgeConversation(conversationId: string): Promise<void> {
  return mutateQueue((q) => ({ next: q.filter((m) => m.conversationId !== conversationId) })).then(() => undefined);
}

// useSyncExternalStore glue: one cached array per stored string, so React sees a stable snapshot,
// and another tab's write (the storage event) re-renders this one.
let cachedRaw: string | null | undefined;
let cached: QueuedMessage[] = EMPTY_QUEUE;
export function getQueueSnapshot(): QueuedMessage[] {
  if (writeFailed) return memory;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = raw ? parse(raw) : EMPTY_QUEUE;
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

export function forConversation(queue: QueuedMessage[], conversationId: string | null): QueuedMessage[] {
  return conversationId ? queue.filter((q) => q.conversationId === conversationId) : EMPTY_QUEUE;
}
