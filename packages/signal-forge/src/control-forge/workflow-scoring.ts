import { WorkflowPattern } from "../shared/types.js";

export function scoreWorkflow(dimensions: number[]): { total: number; decision: WorkflowPattern } {
  const total = dimensions.reduce((acc, val) => acc + val, 0);

  let decision: WorkflowPattern;
  if (total >= 0 && total <= 6) {
    decision = "single_agent";
  } else if (total >= 7 && total <= 11) {
    decision = "single_agent_with_tools";
  } else {
    decision = "multi_agent";
  }

  return { total, decision };
}

export function decideWorkflowPattern(
  specializationPressure: number,
  toolSeparationNeed: number,
  parallelizationValue: number,
  failureIsolationBenefit: number,
  contextPartitionValue: number
): { total: number; decision: WorkflowPattern } {
  return scoreWorkflow([
    specializationPressure,
    toolSeparationNeed,
    parallelizationValue,
    failureIsolationBenefit,
    contextPartitionValue,
  ]);
}
