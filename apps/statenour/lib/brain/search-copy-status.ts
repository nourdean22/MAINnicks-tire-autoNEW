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

export type ForgetToast =
  | { level: "warning"; text: string }
  | { level: "success"; text: string }
  | { level: "error"; text: string };

/**
 * The one message after a forget, for every outcome. The warning is decided first,
 * for a retry too: a retry (deleted false) can still leave a copy indexed.
 * searchCopyRemaining undefined = no read-back ran (early return), so no warning.
 */
export function forgetToast(res: { deleted: boolean; searchCopyRemaining?: number | null }): ForgetToast {
  const warn = res.searchCopyRemaining === undefined ? null : searchCopyWarning(res.searchCopyRemaining);
  if (warn) return { level: "warning", text: warn };
  if (res.deleted) return { level: "success", text: "Memory forgotten" };
  return { level: "error", text: "Nothing to forget, it was already gone" };
}
