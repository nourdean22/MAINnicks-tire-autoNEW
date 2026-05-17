/**
 * Project plan types — persisted to Mission.planData (Json).
 *
 * The chat route + /api/ai/plan-project populate this shape. The
 * ProjectDetail UI component reads it. Keep shapes additive: new
 * fields should be optional so old stored plans still render.
 *
 * Shape overview:
 *
 *   {
 *     v: 1,                             // schema version
 *     createdAt: ISO string,
 *     updatedAt: ISO string,
 *     title: string,
 *     summary: string,                  // 2-3 sentence exec summary
 *     initialThoughts?: string,
 *     quickWin?: string,                // one thing to do right now
 *     strategicAnswers?: string,        // the clarify Q&A transcript
 *     phases: Phase[],                  // ordered
 *     keyRisks: Risk[],
 *     decisionPoints: DecisionPoint[],
 *     doneChecklist: string[],
 *     toolsAndMaterials: ToolItem[],
 *     proTips: string[],
 *     commonMistakes: string[],
 *     redFlags?: string[],
 *     totalEstimatedCost?: { low: number; high: number; breakdown: string },
 *     estimatedTimeline?: string,
 *     weekendSchedule?: string,
 *     // learn mode — optional
 *     learning?: LearningPath,
 *     // guide mode — persisted history
 *     coachLog?: CoachEntry[],
 *   }
 */

export const PROJECT_PLAN_VERSION = 1;

export interface ProjectPhase {
  name: string;
  milestone: string;
  estimatedDays?: number;
  steps: ProjectStep[];
}

export interface ProjectStep {
  title: string;
  nextAction?: string;
  effort?: string; // M5 | M15 | M30 | H1 | H2PLUS
  estimatedCost?: number;
  who?: string;
  reasoning?: string;
  dependsOn?: string | null;
  isCheckpoint?: boolean;
  isDecisionPoint?: boolean;
  proTip?: string;
  phase?: string;
  /** The DB Task id after the plan gets flattened into the mission's task list */
  taskId?: string;
}

export interface ProjectRisk {
  risk: string;
  likelihood: "low" | "medium" | "high";
  mitigation: string;
  costIfHappens?: string;
}

export interface DecisionPoint {
  decision: string;
  options: string[];
  recommendation?: string;
  chosen?: string;
}

export interface ToolItem {
  item: string;
  quantity: string;
  estimatedCost?: number;
  where?: string;
}

export interface LearningResource {
  title: string;
  url?: string;
  note?: string;
}

export interface LearningPath {
  keyConcepts: string[];
  prerequisites: string[];
  resources: LearningResource[];
  practiceExercises: string[];
  /** Minimum viable understanding needed before starting */
  mvuRead?: string;
}

export interface CoachEntry {
  at: string; // ISO timestamp
  read: string; // Nick's read on current state
  nextAction: string; // one specific action
  blocker?: string | null; // current blocker if any
  risks?: string[];
}

export interface ProjectPlanData {
  v: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  summary?: string;
  initialThoughts?: string;
  quickWin?: string;
  strategicAnswers?: string;
  phases: ProjectPhase[];
  keyRisks?: ProjectRisk[];
  decisionPoints?: DecisionPoint[];
  doneChecklist?: string[];
  toolsAndMaterials?: ToolItem[];
  proTips?: string[];
  commonMistakes?: string[];
  redFlags?: string[];
  totalEstimatedCost?: { low: number; high: number; breakdown: string };
  estimatedTimeline?: string;
  weekendSchedule?: string;
  learning?: LearningPath;
  coachLog?: CoachEntry[];
}

/**
 * Type guard — returns true if `value` looks like a ProjectPlanData
 * object. Used when reading mission.planData from Prisma since Json
 * columns come back as `unknown`.
 */
export function isProjectPlanData(value: unknown): value is ProjectPlanData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.v === "number" && Array.isArray(v.phases);
}

/**
 * Build a ProjectPlanData from a raw AI response. The upstream AI
 * returns an unkeyed JSON blob — this normalizes it into the shape
 * above so the UI can rely on consistent fields.
 */
export function normalizeRawPlan(raw: Record<string, unknown>, title: string): ProjectPlanData {
  const now = new Date().toISOString();
  return {
    v: PROJECT_PLAN_VERSION,
    createdAt: now,
    updatedAt: now,
    title,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    phases: Array.isArray(raw.phases) ? (raw.phases as ProjectPhase[]) : [],
    keyRisks: Array.isArray(raw.keyRisks) ? (raw.keyRisks as ProjectRisk[]) : undefined,
    decisionPoints: Array.isArray(raw.decisionPoints)
      ? (raw.decisionPoints as DecisionPoint[])
      : undefined,
    doneChecklist: Array.isArray(raw.doneChecklist)
      ? (raw.doneChecklist as string[])
      : undefined,
    toolsAndMaterials: Array.isArray(raw.toolsAndMaterials)
      ? (raw.toolsAndMaterials as ToolItem[])
      : undefined,
    proTips: Array.isArray(raw.proTips) ? (raw.proTips as string[]) : undefined,
    commonMistakes: Array.isArray(raw.commonMistakes)
      ? (raw.commonMistakes as string[])
      : undefined,
    redFlags: Array.isArray(raw.redFlags) ? (raw.redFlags as string[]) : undefined,
    totalEstimatedCost:
      raw.totalEstimatedCost && typeof raw.totalEstimatedCost === "object"
        ? (raw.totalEstimatedCost as ProjectPlanData["totalEstimatedCost"])
        : undefined,
    estimatedTimeline:
      typeof raw.estimatedTimeline === "string" ? raw.estimatedTimeline : undefined,
    weekendSchedule:
      typeof raw.weekendSchedule === "string" ? raw.weekendSchedule : undefined,
  };
}
