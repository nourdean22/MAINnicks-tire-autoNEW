/**
 * What the chat's tool-receipt chip is allowed to claim.
 *
 * The chip used to read `Tool receipts: 3 verified` with a green shield,
 * computed as `parts.filter(p => p.state === "output-available").length`.
 * That state means ONE thing: the tool call returned without throwing. It
 * says nothing about whether the call found anything.
 *
 * On 2026-08-29 the operator screenshotted three "verified" receipts sitting
 * directly above five "REFLECTIONS FOUND · 0 matches" cards. Every one of
 * those searches had come back empty. The chip was a success badge over a
 * failure, and "verified" is the strongest word in the product's vocabulary
 * -- the same word the receipts system uses for actions it genuinely proved.
 *
 * So: classify what actually happened, and let the caller name it honestly.
 * A returned-but-empty call is its own state and is reported as such.
 *
 * Pure -- no IO, no React. Lives here so it can be tested directly rather
 * than through a rendered tree.
 */

export interface ToolReceiptPart {
  state?: string;
  output?: unknown;
}

export interface ToolReceiptCounts {
  /** Calls that returned a payload carrying data. */
  returned: number;
  /** Calls that returned successfully and carried NO results. */
  empty: number;
  /** Calls that errored. */
  failed: number;
  /** Calls still in flight. */
  running: number;
  total: number;
}

/**
 * Decide whether a successful tool payload actually carried anything.
 *
 * Deliberately conservative: only reports `true` when the payload gives a
 * POSITIVE signal of emptiness. An unrecognised shape counts as data, so a
 * tool whose output this function does not understand is never maligned as
 * a miss -- the failure mode we are fixing is over-claiming, and the
 * opposite error would be just as dishonest.
 */
export function isEmptyToolOutput(output: unknown): boolean {
  if (output == null) return true;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output !== "object") return false;

  const o = output as Record<string, unknown>;

  // The house convention: search tools return a `count`. searchReflections,
  // searchMemories, searchColdMemory, searchSkills all do.
  if (typeof o.count === "number") return o.count === 0;

  // Tools that report per-source counts instead of a total.
  const countKeys = Object.keys(o).filter((k) => /Count$/.test(k) && typeof o[k] === "number");
  if (countKeys.length > 0) return countKeys.every((k) => (o[k] as number) === 0);

  // Otherwise: if the payload's only substantive fields are arrays and all
  // of them are empty, nothing was found.
  const arrays = Object.values(o).filter(Array.isArray) as unknown[][];
  if (arrays.length > 0) return arrays.every((a) => a.length === 0);

  return false;
}

export function summarizeToolReceipts(parts: readonly ToolReceiptPart[]): ToolReceiptCounts {
  let returned = 0;
  let empty = 0;
  let failed = 0;
  for (const part of parts) {
    if (part.state === "output-error") failed++;
    else if (part.state === "output-available") {
      if (isEmptyToolOutput(part.output)) empty++;
      else returned++;
    }
  }
  return { returned, empty, failed, running: parts.length - returned - empty - failed, total: parts.length };
}

/**
 * Collapse CONSECUTIVE identical tool results into one card.
 *
 * When recall was broken the model retried the same search several times in
 * a single turn, and the transcript rendered five byte-identical
 * "REFLECTIONS FOUND · 0 matches" cards stacked on top of each other --
 * pure noise on a phone, where they cost most of the viewport.
 *
 * Only ADJACENT runs collapse, and only when the tool name, state and
 * emptiness all match. Two searches of the same tool separated by a
 * different tool stay separate, because the sequence is real information
 * about what the model did. Returns one entry per rendered card, carrying
 * the index to render from and how many calls it stands for.
 */
export interface CollapsedToolRun {
  /** Index into the ORIGINAL parts array — render this one. */
  index: number;
  /** How many consecutive identical calls this card represents (>= 1). */
  repeat: number;
}

export function collapseRepeatedToolParts(
  parts: readonly { type?: string; state?: string; output?: unknown }[],
): CollapsedToolRun[] {
  const runs: CollapsedToolRun[] = [];
  let prevKey: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const key = `${p.type ?? ""}|${p.state ?? ""}|${isEmptyToolOutput(p.output) ? "empty" : "data"}`;
    if (key === prevKey && runs.length > 0) runs[runs.length - 1].repeat++;
    else {
      runs.push({ index: i, repeat: 1 });
      prevKey = key;
    }
  }
  return runs;
}

/**
 * The chip's text. "completed" is the honest verb for `output-available`:
 * the call finished. Empty results are named separately and never folded
 * into a success count.
 */
export function formatToolReceipts(c: ToolReceiptCounts): string {
  if (c.total === 0) return "";
  const parts: string[] = [];
  if (c.returned) parts.push(`${c.returned} returned data`);
  if (c.empty) parts.push(`${c.empty} found nothing`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.running) parts.push(`${c.running} running`);
  return `Tool calls: ${parts.join(" · ")}`;
}
