import { prisma } from "@/lib/prisma";

export interface EnvironmentVerificationResult {
  toolName: string;
  /**
   * Tri-state, and the middle value is the point.
   *   true  · an independent read-back CONFIRMED the intended world state
   *   false · a read-back ran and CONTRADICTED it (the row is not there)
   *   null  · nothing checked — no verifier exists for this tool, or the
   *           verification query itself failed
   *
   * 2026-09-22 · this used to be a boolean, and the else-branch returned
   * `verified: true, reason: "No specific environment verifier exists"`. A
   * verifier that answers "true" when it did not look is fail-OPEN: it is the
   * "provider success is not truth" defect, inside the component whose whole
   * job is to be stricter than the provider. It was harmless only because
   * nothing downstream consumed the true branch — the moment `verified` is
   * fed into the action receipt (persist-assistant-message.ts) every
   * unverified tool would have been promoted to VERIFIED. Hence the third
   * value: a receipt may promote on `true` only, and the consumer that
   * hedges the reply may act on `false` only.
   */
  verified: boolean | null;
  reason?: string;
}

/**
 * Slice 2: Enforcement · Environment State Verifier
 * Given a list of tool calls that completed, verify against the actual database
 * that the side effects were durably committed. This prevents silent failures
 * from tricking the agent into claiming success.
 *
 * CONTRACT (2026-09-22): ONE result per input call, in input order — including
 * a `null` entry when a known tool carried nothing to look up. Callers pair
 * results to calls BY INDEX (receiptsWithReadBack), so a read-back applies to
 * the invocation it verified and never to every invocation of the same name.
 * Before this, a call without args produced no entry, silently shifting every
 * later result one position.
 */
export async function verifyEnvironmentState(
  toolCalls: Array<{ name: string; ok: boolean; args?: Record<string, unknown> }>
): Promise<EnvironmentVerificationResult[]> {
  const results: EnvironmentVerificationResult[] = [];
  // Only count rows created in this turn's window. A bare title match
  // would pass verification against a stale same-title task from a
  // prior session — defeating the whole point of catching a silent
  // failure. 5min comfortably covers any single turn's duration.
  const recentCutoff = new Date(Date.now() - 5 * 60_000);

  for (const call of toolCalls) {
    if (!call.ok) {
      results.push({ toolName: call.name, verified: false, reason: "Tool execution failed" });
      continue;
    }

    try {
      if (call.name === "createTask") {
        const args = call.args as { title?: string };
        if (args?.title) {
          // deletedAt: null — a soft-deleted task must not satisfy "the
          // side effect was durably committed".
          const task = await prisma.task.findFirst({
            where: { title: args.title, deletedAt: null, createdAt: { gte: recentCutoff } },
            orderBy: { createdAt: "desc" }
          });
          if (task) {
            results.push({ toolName: call.name, verified: true });
          } else {
            results.push({ toolName: call.name, verified: false, reason: "Task not found in database" });
          }
        } else {
          results.push({ toolName: call.name, verified: null, reason: "createTask call carried no title to look up" });
        }
      } else if (call.name === "addTasksToProject") {
        const args = call.args as { tasks?: Array<{ title: string }> };
        if (args?.tasks && args.tasks.length > 0) {
          // Verify EVERY task in the batch landed — not just tasks[0].
          // A partial commit (e.g. 1 of 5 created, 4 silently failed)
          // used to pass as fully verified because only the first
          // title was looked up.
          const titles = args.tasks.map((t) => t.title).filter(Boolean);
          const found = await prisma.task.count({
            where: { title: { in: titles }, deletedAt: null, createdAt: { gte: recentCutoff } },
          });
          if (found >= args.tasks.length) {
            results.push({ toolName: call.name, verified: true });
          } else {
            results.push({
              toolName: call.name,
              verified: false,
              reason: `Only ${found}/${args.tasks.length} bulk tasks found in database`,
            });
          }
        } else {
          results.push({ toolName: call.name, verified: null, reason: "addTasksToProject call carried no tasks to look up" });
        }
      } else if (call.name === "completeTask") {
         const args = call.args as { taskId?: string };
         if (args?.taskId) {
            const task = await prisma.task.findUnique({ where: { id: args.taskId } });
            if (task && task.status === "DONE") {
               results.push({ toolName: call.name, verified: true });
            } else {
               results.push({ toolName: call.name, verified: false, reason: "Task not marked DONE in database" });
            }
         } else {
            results.push({ toolName: call.name, verified: null, reason: "completeTask call carried no taskId to look up" });
         }
      } else {
        // Not checked. NOT "assumed true": a tool with no verifier stays at
        // whatever the provider said, which the receipt records as
        // PROVIDER_ACCEPTED. Absence of a check is not a passed check.
        results.push({ toolName: call.name, verified: null, reason: "No specific environment verifier exists" });
      }
    } catch (e) {
      // A verification QUERY failing is not a contradiction of world state —
      // it is the instrument failing. Reporting it as `false` would push a
      // fabrication banner into the persisted reply on a DB hiccup, accusing
      // Nick of a claim the evidence never contradicted. So: null, and say so
      // loudly, because a silent null is how a broken verifier reads as "no
      // verifier" forever (the instrument-failures doctrine).
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[instrument.environment_verifier] query failed for ${call.name}: ${message}`);
      results.push({ toolName: call.name, verified: null, reason: `Verification query failed: ${message}` });
    }
  }

  return results;
}
