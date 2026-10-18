/**
 * tRPC procedures that get their own HTTP request instead of joining the batch.
 * Why, and the scope of that choice: the comment above the splitLink in client/src/main.tsx.
 * Lives here, not in main.tsx, so a test can read it without booting the app.
 */
export const UNBATCHED_SLOW_PROCEDURES = new Set<string>([
  "instagramAdmin.getPerformanceReport",
  // LLM-backed hourly digest, polled every minute on Lot: batched, it would hold every Lot read.
  "lot.officeDigest",
]);
