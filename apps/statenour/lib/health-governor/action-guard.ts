import { getLatestGovernorDecision } from "./health-governor-guardrails";
import { prisma } from "@/lib/prisma";

export async function logOverrideAudit(actionType: string, reason: string = "User override") {
  const dateStr = new Date().toISOString().split("T")[0];
  const key = `hg-override:${dateStr}:${actionType}`;
  try {
    await prisma.entityAudit.create({
      data: {
        entityType: "health_governor",
        entityId: "override",
        action: "override",
        actor: "user",
        reason: reason,
        source: `health-governor:${actionType}`,
        idempotencyKey: key,
      },
    });
  } catch (err) {
    // Unique constraint collision is expected if overridden multiple times in one day
  }
}

export async function checkAction(
  actionType: string,
  override: boolean = false,
  reason: string = "User override"
): Promise<{ allowed: boolean; blocked: boolean; warning?: string }> {
  const decision = await getLatestGovernorDecision();
  if (!decision) {
    return { allowed: true, blocked: false };
  }

  // Check if this action is in the blockedActions list
  const isBlocked = decision.blockedActions.includes(actionType);

  if (isBlocked) {
    if (decision.mode === "LOCKDOWN") {
      // In LOCKDOWN, no overrides are allowed
      return {
        allowed: false,
        blocked: true,
        warning: `Action '${actionType}' is strictly BLOCKED in LOCKDOWN mode due to operator fatigue/injury. Overrides are disabled. Reasons: ${decision.reasons.join(", ")}`,
      };
    }

    if (override) {
      // Allowed via override, log to EntityAudit
      await logOverrideAudit(actionType, reason);
      return {
        allowed: true,
        blocked: false,
        warning: `Action '${actionType}' was overridden by operator. Override logged to audit trail.`,
      };
    } else {
      // Blocked but can be overridden
      return {
        allowed: false,
        blocked: true,
        warning: `Action '${actionType}' is blocked under ${decision.mode} mode. Requires explicit operator override. Reasons: ${decision.reasons.join(", ")}`,
      };
    }
  }

  return { allowed: true, blocked: false };
}
