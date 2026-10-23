/**
 * Close the day: move the stragglers to tomorrow and report only what moved.
 * `snooze` resolves true on a confirmed write; false or a throw is a failure.
 */
export type RollResult = { rolled: number; failed: number };

export async function rollStragglers(
  ids: string[],
  snooze: (id: string) => Promise<boolean>,
): Promise<RollResult> {
  let rolled = 0;
  let failed = 0;
  for (const id of ids) {
    let ok = false;
    try {
      ok = await snooze(id);
    } catch {
      ok = false;
    }
    if (ok) rolled++;
    else failed++;
  }
  return { rolled, failed };
}

export function rollSummary(r: RollResult, doneCount: number): { ok: boolean; text: string } {
  if (r.failed > 0) {
    return {
      ok: false,
      text: `${r.rolled} moved to tomorrow, ${r.failed} could not be moved. They are still open; try again.`,
    };
  }
  return { ok: true, text: `Day closed. ${doneCount} done, ${r.rolled} moved to tomorrow.` };
}
