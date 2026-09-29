/**
 * Vendor-neutral typed decision contract.
 *
 * Shape-compatible with the public TypeSafe /v1/systemone wire format so
 * StateNour can compare Jev-compatible backends without depending on any one
 * vendor SDK. Policy/authorization never belongs in this layer.
 */
export type DecisionJson =
  | string
  | number
  | boolean
  | null
  | DecisionJson[]
  | { [key: string]: DecisionJson };

export type DecisionEntry =
  | string
  | DecisionJson[]
  | { [key: string]: DecisionJson }
  | null;

export interface NoulQuestion {
  type: "noul";
  instructions?: DecisionEntry;
  criteria?: { true?: DecisionEntry; false?: DecisionEntry } | null;
}

export interface ChoiceQuestion<
  T extends Record<string, DecisionEntry> = Record<string, DecisionEntry>,
> {
  type: "choice";
  instructions?: DecisionEntry;
  criteria: T;
}

export interface ScoreQuestion<
  T extends readonly [DecisionEntry, DecisionEntry, ...DecisionEntry[]] =
    readonly [DecisionEntry, DecisionEntry, ...DecisionEntry[]],
> {
  type: "score";
  instructions?: DecisionEntry;
  criteria: T;
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type DecisionQuestions = Record<string, DecisionQuestion>;

export interface NoulAnswer {
  type: "noul";
  /** Probability of true. */
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, DecisionEntry>;
  probabilities: Record<string, number>;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type AnswerFor<Q extends DecisionQuestion> =
  Q extends NoulQuestion
    ? NoulAnswer
    : Q extends ChoiceQuestion
      ? ChoiceAnswer
      : Q extends ScoreQuestion
        ? ScoreAnswer
        : never;

export interface DecisionRequest<Q extends DecisionQuestions = DecisionQuestions> {
  state: DecisionEntry;
  questions: Q;
  model?: string;
}

export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface DecisionResult<Q extends DecisionQuestions = DecisionQuestions> {
  backend: string;
  model: string;
  answers: { [K in keyof Q]: AnswerFor<Q[K]> };
  usage: DecisionUsage;
  latencyMs: number;
  requestId?: string;
}

export interface DecisionBackend {
  readonly id: string;
  readonly trust: "private" | "external";
  evaluate<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>>;
}

export interface DecisionPlaneContext {
  traceId?: string;
  conversationId?: string;
  purpose?: string;
}

export interface DecisionPlaneInput<Q extends DecisionQuestions = DecisionQuestions>
  extends DecisionRequest<Q> {
  context?: DecisionPlaneContext;
}
