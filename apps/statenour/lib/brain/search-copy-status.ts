/**
 * What the operator is told after a forget, when the memory's search copy
 * (its vector_embeddings row) may still hold the text.
 *
 * Pure on purpose: the inspector imports it and must not pull in the server
 * prisma client. `remaining` is the count read back after the forget:
 *   0     copy confirmed gone        -> no warning
 *   n > 0 copies still indexed       -> warning naming n
 *   null  the count could not be read -> unknown, never shown as zero
 */
export function searchCopyWarning(remaining: number | null): string | null {
  if (remaining === 0) return null;
  if (remaining === null) {
    return "Forgotten, but could not confirm the search copy is gone. Check the memory index.";
  }
  return `Forgotten, but ${remaining} search ${remaining === 1 ? "copy is" : "copies are"} still indexed.`;
}
