import {
  getToolCapability,
  getMissingEnvForTool,
  ToolRiskClass,
  ApprovalPolicy,
  ToolCapability
} from "./tool-registry";
import { getFlag } from "@/lib/feature-flags";

export type ToolDecisionType =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_owner"
  | "require_screenshot_approval"
  | "require_memory_review";

export interface ToolActionRequest {
  toolId: string;
  actionType: string;
  targetDomain?: string;
  requestedBy?: string;
  externalMutation?: boolean;
  memoryWriteRequested?: boolean;
  costEstimate?: number;
  destructive?: boolean;
  containsExternalContent?: boolean;
  hasPriorApproval?: boolean;
}

export interface ToolDecision {
  decision: ToolDecisionType;
  riskClass: ToolRiskClass;
  reason: string;
  requiredApproval?: ApprovalPolicy;
  missingEnv?: string[];
}

/**
 * Evaluate a tool action request against the safety policies.
 */
export function evaluateToolAction(request: ToolActionRequest): ToolDecision {
  const cap = getToolCapability(request.toolId);

  // 1. Unknown tool -> deny
  if (!cap) {
    return {
      decision: "deny",
      riskClass: "critical",
      reason: `Unknown tool ID: ${request.toolId}`,
      requiredApproval: "manual_only"
    };
  }

  const { riskClass, approvalPolicy, status } = cap;
  
  // 1.5. NICK_MUTATION_LOCK gate
  const isMutation =
    request.destructive ||
    request.externalMutation ||
    request.memoryWriteRequested ||
    cap.writeAccess ||
    cap.externalMutation ||
    cap.memoryWriteAllowed;

  if (isMutation) {
    try {
      const mutationLock = getFlag("NICK_MUTATION_LOCK")?.isOn ?? false;
      if (mutationLock) {
        return {
          decision: "deny",
          riskClass: cap.riskClass,
          reason: `Action rejected: NICK_MUTATION_LOCK is active, preventing database/system mutations.`,
          requiredApproval: "manual_only"
        };
      }
    } catch {
      // safe fallback if feature flags cannot be resolved
    }
  }

  // 2. Blocked tool -> deny
  if (status === "blocked" || cap.category === "local") {
    return {
      decision: "deny",
      riskClass: "critical",
      reason: `Access to tool ${request.toolId} is blocked by system configuration.`,
      requiredApproval: "manual_only"
    };
  }

  // 3. Destructive actions -> deny
  if (request.destructive) {
    return {
      decision: "deny",
      riskClass: "critical",
      reason: `Action on ${request.toolId} rejected: destructive actions are disabled.`,
      requiredApproval: "manual_only"
    };
  }

  // 4. Missing required env -> deny with missing env list
  const missingEnv = getMissingEnvForTool(request.toolId);
  if (missingEnv.length > 0) {
    return {
      decision: "deny",
      riskClass,
      reason: `Required environment variables are missing for tool ${request.toolId}: ${missingEnv.join(", ")}`,
      missingEnv,
      requiredApproval: "manual_only"
    };
  }

  // 5. Inert/scaffolded tool -> deny or require setup
  if (status === "inert" || status === "scaffolded") {
    return {
      decision: "deny",
      riskClass,
      reason: `Tool ${request.toolId} is currently inert or scaffolded and cannot be executed.`,
      requiredApproval: "manual_only"
    };
  }

  // 6. Memory write from external content -> require memory review
  const isMemoryWrite = request.memoryWriteRequested || cap.memoryWriteAllowed;
  if (isMemoryWrite && request.containsExternalContent) {
    return {
      decision: "require_memory_review",
      riskClass,
      reason: "Memory writes from external untrusted content require human memory review.",
      requiredApproval: "memory_review_required"
    };
  }

  // 7. Browser sensitive click/submit -> require screenshot approval
  const isBrowserTool = cap.category === "browser";
  const isSensitiveBrowserAction =
    request.actionType === "click" ||
    request.actionType === "submit" ||
    request.actionType === "type";
  if (isBrowserTool && isSensitiveBrowserAction) {
    return {
      decision: "require_screenshot_approval",
      riskClass,
      reason: "Sensitive browser operations require visual/screenshot approval.",
      requiredApproval: "screenshot_required"
    };
  }

  // 8. Critical action or risk class -> require owner
  if (riskClass === "critical") {
    return {
      decision: "require_owner",
      riskClass: "critical",
      reason: "Critical risk actions require explicit owner authorization.",
      requiredApproval: "owner_required"
    };
  }

  // 9. External mutation -> require approval / owner
  const isExternalMutation = request.externalMutation || cap.externalMutation;
  if (isExternalMutation) {
    const policy = approvalPolicy === "none" ? "owner_required" : approvalPolicy;
    return {
      decision: policy === "owner_required" ? "require_owner" : "require_approval",
      riskClass,
      reason: "External mutations must be approved by the operator.",
      requiredApproval: policy
    };
  }

  // 10. Map other approval policies if defined on capability
  if (approvalPolicy === "owner_required") {
    return {
      decision: "require_owner",
      riskClass,
      reason: "Tool policy requires explicit owner approval.",
      requiredApproval: "owner_required"
    };
  } else if (approvalPolicy === "screenshot_required") {
    return {
      decision: "require_screenshot_approval",
      riskClass,
      reason: "Tool policy requires screenshot confirmation.",
      requiredApproval: "screenshot_required"
    };
  } else if (approvalPolicy === "memory_review_required") {
    return {
      decision: "require_memory_review",
      riskClass,
      reason: "Tool policy requires memory review check.",
      requiredApproval: "memory_review_required"
    };
  }

  // 11. Low-risk read-only tool with healthy env -> allow
  return {
    decision: "allow",
    riskClass,
    reason: "Tool execution allowed under current safety policy.",
    requiredApproval: "none"
  };
}
