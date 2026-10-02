/**
 * Judge statenour's answer to POST /api/sync/evidence (2026-10-02).
 *
 * From 2026-09-29 to 2026-10-02 every post returned HTTP 500 (a missing
 * column) and every proof run still concluded SUCCESS, because the poster
 * only printed the status. A partly rejected batch is subtler: apiHandler
 * answers HTTP 200 with the envelope `{ ok: true, data: { ok: false,
 * rejected: [...] } }`, so even reading the status would miss it.
 *
 * Returns null when every row landed, otherwise a one-line reason.
 */
export function ledgerFailure(status, json) {
  if (status < 200 || status >= 300) {
    const error = typeof json?.error === "string" ? `: ${json.error.slice(0, 200)}` : "";
    return `HTTP ${status}${error}`;
  }
  const rejected = Array.isArray(json?.data?.rejected) ? json.data.rejected : [];
  if (rejected.length > 0) {
    const first = rejected[0] ?? {};
    return `${rejected.length} row(s) rejected; first: ${first.kind}[${first.index}] ${String(first.error ?? "").slice(0, 200)}`;
  }
  return null;
}
