import { prisma } from "@/lib/prisma";

export interface EnvironmentVerificationResult {
  toolName: string;
  verified: boolean;
  reason?: string;
}

/**
 * Slice 2: Enforcement · Environment State Verifier
 * Given a list of tool calls that completed, verify against the actual database
 * that the side effects were durably committed. This prevents silent failures
 * from tricking the agent into claiming success.
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
         }
      } else {
        // Unverified tools are assumed true if they returned ok=true
        results.push({ toolName: call.name, verified: true, reason: "No specific environment verifier exists" });
      }
    } catch (e) {
      results.push({ toolName: call.name, verified: false, reason: "Verification query failed" });
    }
  }

  return results;
}
