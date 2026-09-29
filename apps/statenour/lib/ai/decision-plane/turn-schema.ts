import type { TurnSignal } from "@/lib/ai/turn-intelligence";
import { choice, noul } from "./questions";
import type {
  DecisionRequest,
  DecisionResult,
  DecisionQuestions,
} from "./types";

export const TURN_DECISION_STATE_CHARS = 12_000;

export const TURN_DECISION_QUESTIONS = {
  intent: choice("What is the user's primary intent?", {
    factual: "asks for facts or explanation",
    analytical: "asks to analyze or compare",
    creative: "asks to draft, invent, or brainstorm",
    emotional: "expresses feelings or seeks emotional conversation",
    instructional: "asks to be taught or walked through a concept",
    casual: "casual conversational turn",
    decision: "asks which option to choose",
    procedural: "asks for a concrete process or steps",
    reflective: "asks about patterns, self-reflection, or meaning",
  }),
  complexity: choice("How much reasoning does this turn require?", {
    simple: "direct and low-complexity",
    moderate: "some synthesis or multiple considerations",
    complex: "multi-step, ambiguous, or high reasoning burden",
  }),
  outputShape: choice("What answer shape best satisfies the request?", {
    prose: "normal prose answer",
    email: "ready-to-send email",
    sms: "short message or SMS",
    proposal: "proposal or scope",
    list: "ordered or bulleted list",
    code: "working code",
    json: "machine-readable JSON",
    table: "tabular comparison or data",
    summary: "condensed summary",
    none: "very short conversational response",
  }),

  domain: choice("Which domain primarily owns this turn?", {
    business: "Nick's/business/work operations",
    personal: "Nour's personal life or self-management",
    mixed: "both personal and business materially matter",
    unknown: "no reliable domain signal",
  }),
  urgency: choice("How urgent is the user's requested outcome?", {
    low: "no time pressure",
    medium: "normal priority",
    high: "explicitly urgent, critical, broken, or immediate",
  }),
  needsTools: noul("Does a correct answer require executing or reading a tool rather than only reasoning from supplied context?", {
    true: "a tool or connected system is materially needed",
    false: "the answer can be completed without a tool",
  }),
  needsWeb: noul("Does this turn require current public-web information?", {
    true: "fresh/current public information is required",
    false: "web lookup is not required",
  }),
  actionRequest: noul("Is the user asking the system to perform an action rather than only explain or draft?", {
    true: "execute/change/send/create/run something",
    false: "information, analysis, or drafting only",
  }),
  needsDeepReasoning: noul("Would deeper multi-step reasoning materially improve correctness?", {
    true: "deep reasoning is justified",
    false: "fast/normal reasoning is sufficient",
  }),
  needsBackgroundMission: noul("Should this become durable multi-step background work that may outlive the chat request?", {
    true: "long-running or multi-stage mission is appropriate",
    false: "finish within the normal turn",
  }),
} as const satisfies DecisionQuestions;

export type TurnDecisionQuestions = typeof TURN_DECISION_QUESTIONS;

export interface IncumbentTurnDecisionInput {
  turnSignal: TurnSignal;
  mode: string;
  finalTaskType: string;
  pythonExecuteIntent: boolean;
  actionIntent: boolean;
  webSearchIntent: boolean;
  webSearchRecency: boolean;
}

export interface IncumbentTurnDecision {
  intent: TurnSignal["intent"];
  complexity: TurnSignal["complexity"];
  outputShape: TurnSignal["outputShape"];
  domain: TurnSignal["domain"];
  urgency: TurnSignal["urgency"];
  needsTools: boolean;
  needsWeb: boolean;
  actionRequest: boolean;
  needsDeepReasoning: boolean;
  /** No incumbent policy owns this yet; never manufacture a baseline label. */
  needsBackgroundMission: null;
  mode: string;
  finalTaskType: string;
}

export function incumbentTurnDecision(
  input: IncumbentTurnDecisionInput,
): IncumbentTurnDecision {
  return {
    intent: input.turnSignal.intent,
    complexity: input.turnSignal.complexity,
    outputShape: input.turnSignal.outputShape,
    domain: input.turnSignal.domain,
    urgency: input.turnSignal.urgency,
    needsTools:
      input.pythonExecuteIntent ||
      input.actionIntent ||
      input.webSearchIntent ||
      input.webSearchRecency,
    needsWeb: input.webSearchIntent || input.webSearchRecency,
    actionRequest: input.pythonExecuteIntent || input.actionIntent,
    needsDeepReasoning:
      input.mode === "deep" ||
      input.turnSignal.useChainOfThought ||
      input.turnSignal.useTwoPassCritique,
    needsBackgroundMission: null,
    mode: input.mode,
    finalTaskType: input.finalTaskType,
  };
}

export function buildTurnDecisionRequest(
  userContent: string,
): DecisionRequest<TurnDecisionQuestions> {
  const text = userContent.slice(0, TURN_DECISION_STATE_CHARS);
  return {
    state: {
      message: text,
      truncated: userContent.length > text.length,
    },
    questions: TURN_DECISION_QUESTIONS,
  };
}

function boolAnswer(result: DecisionResult<TurnDecisionQuestions>, key: "needsTools" | "needsWeb" | "actionRequest" | "needsDeepReasoning"): boolean {
  const answer = result.answers[key];
  return answer.type === "noul" && answer.noul >= 0.5;
}

export function compareTurnDecision(
  result: DecisionResult<TurnDecisionQuestions>,
  incumbent: IncumbentTurnDecision,
): {
  compared: number;
  agreements: number;
  agreementRate: number;
  fields: Record<string, boolean>;
} {
  const fields: Record<string, boolean> = {
    intent:
      result.answers.intent.type === "choice" &&
      result.answers.intent.choice === incumbent.intent,
    complexity:
      result.answers.complexity.type === "choice" &&
      result.answers.complexity.choice === incumbent.complexity,
    outputShape:
      result.answers.outputShape.type === "choice" &&
      result.answers.outputShape.choice === incumbent.outputShape,
    domain:
      result.answers.domain.type === "choice" &&
      result.answers.domain.choice === incumbent.domain,
    urgency:
      result.answers.urgency.type === "choice" &&
      result.answers.urgency.choice === incumbent.urgency,
    needsTools: boolAnswer(result, "needsTools") === incumbent.needsTools,
    needsWeb: boolAnswer(result, "needsWeb") === incumbent.needsWeb,
    actionRequest: boolAnswer(result, "actionRequest") === incumbent.actionRequest,
    needsDeepReasoning:
      boolAnswer(result, "needsDeepReasoning") === incumbent.needsDeepReasoning,
  };
  const values = Object.values(fields);
  const agreements = values.filter(Boolean).length;
  return {
    compared: values.length,
    agreements,
    agreementRate: values.length === 0 ? 0 : agreements / values.length,
    fields,
  };
}
