/**
 * memoryWriterGuards — what a writer must NOT put into Nick's memory.
 *
 * WHY (2026-09-22, scripts/diagnostics/memory-counterfactual.mjs against the
 * live store): getWarmupContext() injects the ten highest confidence x uses
 * rows into every Nick turn, and nine of the ten were writer noise that had
 * been re-emitted until `uses` reached the thousands —
 *   "Bay utilization at 20:00: 0% (0/0 bays, 0 techs). FULL — consider expanding hours."  (x4, 68-77 uses)
 *   'Alert "proactive" was unknown. Outcome unknown.'                                       (2,517 uses)
 *   "[statenour] Nick AI has 30 learned memories"                                            (4,904 uses)
 *   "[statenour-commitment]  — deadline: tomorrow, status: active"                           (392 uses, no text)
 * while 498 of 548 rows could not reach the prompt at all. Repetition is not
 * evidence; a row that says nothing should never be written. Each guard below
 * returns the content to remember, or null for "write nothing", so the writer
 * stays one line and the rule is unit-tested.
 */

/** Bay utilization: nothing to learn from a shop with no bays configured, and 0/0 is not FULL. */
export function capacityMemoryContent(args: { etHour: number; totalBays: number; freeBays: number; clockedIn: number }): string | null {
  const { etHour, totalBays, freeBays, clockedIn } = args;
  if (totalBays <= 0) return null;
  const utilizationPct = Math.round(((totalBays - freeBays) / totalBays) * 100);
  const label = freeBays === 0 ? "FULL — consider expanding hours." : freeBays === totalBays ? "EMPTY — need more traffic." : "Normal utilization.";
  return `Bay utilization at ${etHour}:00: ${utilizationPct}% (${totalBays - freeBays}/${totalBays} bays, ${clockedIn} techs). ${label}`;
}

/** An alert outcome is a lesson only when there IS an outcome. */
export function alertOutcomeMemoryContent(alertType: string, outcome: "acted" | "ignored" | "unknown"): string | null {
  if (outcome === "unknown") return null;
  return `Alert "${alertType}" was ${outcome}. ${outcome === "acted" ? "This type of alert drives action — keep sending." : "This alert type may need a different approach or timing."}`;
}

/**
 * A pulled statenour item is worth remembering when it has text and is about
 * the world, not about Nick's own memory store. The bridge's recentInsights
 * carried "Nick AI has 30 learned memories" for months; re-pulled every pass,
 * it became the single most-reinforced row in the store.
 */
export function pulledMemoryText(prefix: string, text: string | null | undefined, suffix = ""): string | null {
  const body = (text ?? "").trim();
  if (!body) return null;
  if (/learned memor(y|ies)/i.test(body)) return null;
  return `${prefix} ${body}${suffix}`.slice(0, 500);
}
