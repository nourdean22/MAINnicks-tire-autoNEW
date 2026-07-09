import { SignalControlForgeInput } from "./schemas/input.js";
import { SignalControlForgeOutput, SignalControlForgeOutputSchema } from "./schemas/output.js";
import { decideWorkflowPattern } from "./workflow-scoring.js";

export function generateSignalControlArchitecture(
  input: SignalControlForgeInput,
  mockScoring?: { s1: number; s2: number; s3: number; s4: number; s5: number }
): SignalControlForgeOutput {
  // If LLM provider is used, it goes here.
  // V1 default is deterministic mock based on input.
  
  const score = decideWorkflowPattern(
    mockScoring?.s1 ?? 3,
    mockScoring?.s2 ?? 3,
    mockScoring?.s3 ?? 3,
    mockScoring?.s4 ?? 3,
    mockScoring?.s5 ?? 3
  );

  const output: SignalControlForgeOutput = {
    executiveVerdict: `Architecture generated for ${input.coreTask}`,
    confidenceLevel: "High (Deterministic scaffolding)",
    taskRestatement: input.coreTask,
    objectiveBreakdown: ["Identify signals", "Validate demand", "Estimate viability"],
    inputAudit: "Input processed successfully",
    constraintAudit: "No paid APIs allowed. Public scraping restricted.",
    riskAudit: "Moderate risk of hallucinated market size",
    workflowScoreBreakdown: {
      totalScore: score.total,
      dimensions: [
        { dimension: "Specialization Pressure", score: mockScoring?.s1 ?? 3 },
        { dimension: "Tool Separation Need", score: mockScoring?.s2 ?? 3 },
        { dimension: "Parallelization Value", score: mockScoring?.s3 ?? 3 },
        { dimension: "Failure Isolation Benefit", score: mockScoring?.s4 ?? 3 },
        { dimension: "Context Partition Value", score: mockScoring?.s5 ?? 3 }
      ]
    },
    workflowDecision: score.decision,
    whyThisDesignWins: "Optimizes parallel execution while preventing context contamination",
    architectureSummary: `A ${score.decision} architecture designed for ecommerce.`,
    roleRoster: [
      {
        roleName: "Trend Researcher",
        mission: "Discover emerging trends",
        whyThisRoleExists: "To separate raw discovery from validation",
        scopeBoundary: "Public search only",
        inputs: ["Search terms"],
        outputContract: "JSON list of product ideas",
        allowedTools: ["web_search"],
        forbiddenTools: ["paid_apis"],
        successCondition: "At least 3 viable trends found",
        failureTriggers: ["Rate limits"],
        retryRule: "Retry 3 times",
        fallbackRule: "Return cached list",
        handoffTarget: "Demand Validator",
        promptStub: "You are an expert product researcher..."
      }
    ],
    handoffContracts: [
      {
        sourceRole: "Trend Researcher",
        targetRole: "Demand Validator",
        contract: "List of trends"
      }
    ],
    validationGates: [
      {
        description: "Verify trends are not seasonal fads",
        failureResponse: "Reject trend and request new ones"
      }
    ],
    failureContainmentPlan: [
      {
        detection: "LLM timeout",
        fallback: "Return structural risk marker"
      }
    ],
    promptStubs: [
      {
        roleName: "Trend Researcher",
        stub: "{LOCKED_CORE}\\n[EDITABLE_FIELDS]"
      }
    ],
    compactOutputSchemas: [
      {
        schemaName: "OpportunityReport",
        schemaStructure: { product: "string" }
      }
    ],
    implementationNotes: "Deploy using Vercel or local node.",
    finalRecommendation: "Proceed with multi-agent orchestration."
  };

  return SignalControlForgeOutputSchema.parse(output);
}
