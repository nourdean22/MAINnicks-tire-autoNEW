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

  for (const call of toolCalls) {
    if (!call.ok) {
      results.push({ toolName: call.name, verified: false, reason: "Tool execution failed" });
      continue;
    }

    try {
      if (call.name === "createTask") {
        const args = call.args as { title?: string };
        if (args?.title) {
          const task = await prisma.task.findFirst({
            where: { title: args.title },
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
          // Verify at least the first task exists
          const firstTask = args.tasks[0].title;
          const task = await prisma.task.findFirst({
            where: { title: firstTask },
            orderBy: { createdAt: "desc" }
          });
          if (task) {
            results.push({ toolName: call.name, verified: true });
          } else {
            results.push({ toolName: call.name, verified: false, reason: "Bulk tasks not found in database" });
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
