export const DEFAULT_MENTION_RESOLUTION_TIMEOUT_MS = 1_200;

export type MentionResolutionSource = "async" | "sync" | "raw";

export interface MentionResolutionResult {
  text: string;
  source: MentionResolutionSource;
  timedOut: boolean;
}

interface ResolveMentionsInput {
  text: string;
  resolveAsync: (text: string) => Promise<string>;
  resolveSync: (text: string) => string;
  timeoutMs?: number;
}

/**
 * Resolve @mentions without holding the composer hostage.
 *
 * Server-backed mentions can touch the database. The optimistic message is
 * visible before this runs; this helper only bounds how long dispatch waits
 * for richer context. Timeout and failure both fall back to the synchronous
 * resolver, then finally to the original text. A mention outage can never eat
 * a message or leave the composer stuck.
 */
export async function resolveMentionsWithTimeout({
  text,
  resolveAsync,
  resolveSync,
  timeoutMs = DEFAULT_MENTION_RESOLUTION_TIMEOUT_MS,
}: ResolveMentionsInput): Promise<MentionResolutionResult> {
  if (!text.includes("@")) {
    return { text, source: "raw", timedOut: false };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      resolveAsync(text).then((value) => ({ kind: "resolved" as const, value })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);

    if (result.kind === "resolved") {
      return { text: result.value, source: "async", timedOut: false };
    }

    try {
      return { text: resolveSync(text), source: "sync", timedOut: true };
    } catch {
      return { text, source: "raw", timedOut: true };
    }
  } catch {
    try {
      return { text: resolveSync(text), source: "sync", timedOut: false };
    } catch {
      return { text, source: "raw", timedOut: false };
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
