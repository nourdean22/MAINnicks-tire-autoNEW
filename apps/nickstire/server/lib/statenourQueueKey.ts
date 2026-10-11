/**
 * Key for statenour's social publish queue (/api/sync/queue). STATENOUR_QUEUE_KEY is the
 * scoped key only this Command Queue holds; the bridge key is the fallback until it is set.
 * Statenour stops accepting the bridge key there once STATENOUR_QUEUE_KEY_STRICT=1 (2026-10-10).
 */
export function statenourQueueKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.STATENOUR_QUEUE_KEY || env.STATENOUR_SYNC_KEY || "").trim();
}
