import { operatorSensitivityProfile } from "./operatorSensitivityProfile";

export type HealthGovernorMode = "LOCKDOWN" | "SHADOW_MODE" | "RECOVERY_LOCK" | "OPTIMIZED" | "STABLE";

export interface HealthGovernorDecision {
  mode: HealthGovernorMode;
  score: number;
  reasons: string[];
  blockedActions: string[];
  allowedActions: string[];
  delayedActions: string[];
  forcedActions: string[];
  recommendedCommand: string;
  actionSeverity: "CRITICAL" | "WARNING" | "MODERATE" | "NONE";
  promptGuardrailText: string;
}

export interface ReadinessInput {
  sleepHours: number | null;
  energyLevel: number | null;
  focusQuality: number | null;
  driftLevel: number | null;
  sorenessScore: number | null;
  injuryFlag: boolean | null;
  workoutCompletedToday: boolean | null;
}

export function evaluateReadiness(input: ReadinessInput): HealthGovernorDecision {
  const profile = operatorSensitivityProfile;
  const reasons: string[] = [];
  let score = 100;

  // 1. Sleep deduction
  const sleep = input.sleepHours ?? 7.0; // Default fallback to 7.0
  if (sleep < profile.minSleepOptimized) {
    const diff = profile.minSleepOptimized - sleep;
    const deduction = Math.min(50, Math.round(diff * 15));
    if (deduction > 0) {
      score -= deduction;
      reasons.push(`Sleep deficit: ${sleep.toFixed(1)}h logged (target >= ${profile.minSleepOptimized}h)`);
    }
  }
  if (sleep < profile.minSleepLockdown) {
    score -= 20; // Extra penalty for critical sleep deprivation
  }

  // 2. Focus & Drift deduction
  const focus = input.focusQuality ?? 5;
  if (focus < 5) {
    const deduction = (5 - focus) * 5;
    score -= deduction;
    reasons.push(`Low focus quality: Lvl ${focus} (below baseline 5)`);
  }

  const drift = input.driftLevel ?? 5;
  if (drift > 5) {
    const deduction = (drift - 5) * 5;
    score -= deduction;
    reasons.push(`Elevated drift level: Lvl ${drift} (above baseline 5)`);
  }

  // 3. Soreness & Injury
  const soreness = input.sorenessScore ?? 0;
  if (soreness >= profile.sorenessRecovery) {
    score -= 15;
    reasons.push(`Elevated muscle soreness: Lvl ${soreness}`);
  }
  if (soreness >= profile.sorenessLockdown) {
    score -= 15;
    reasons.push(`Extreme muscle soreness: Lvl ${soreness}`);
  }

  if (input.injuryFlag) {
    score -= 30;
    reasons.push("Injury flag is ACTIVE");
  }

  // 4. Energy Level
  const energy = input.energyLevel ?? 3;
  if (energy === 1) {
    score -= 40;
    reasons.push("Extreme fatigue / low energy: Lvl 1");
  } else if (energy === 2) {
    score -= 20;
    reasons.push("Low energy: Lvl 2");
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine mode
  let mode: HealthGovernorMode = "STABLE";
  let recommendedCommand = "/execute";
  let actionSeverity: "CRITICAL" | "WARNING" | "MODERATE" | "NONE" = "NONE";
  let blockedActions: string[] = [];
  let allowedActions: string[] = ["view_dashboard", "read_alerts", "rest"];
  let delayedActions: string[] = [];
  let forcedActions: string[] = [];

  // Critical triggers for LOCKDOWN
  const isLockdown =
    score < 40 ||
    sleep < profile.minSleepLockdown ||
    input.injuryFlag === true ||
    soreness >= profile.sorenessLockdown ||
    energy === 1;

  // Warning triggers for SHADOW_MODE
  const isShadowMode =
    !isLockdown &&
    (score < 60 ||
      sleep < profile.minSleepShadow ||
      focus <= profile.minFocusShadow ||
      drift >= profile.maxDriftShadow);

  // Recovery triggers for RECOVERY_LOCK
  const isRecoveryLock =
    !isLockdown &&
    !isShadowMode &&
    (soreness >= profile.sorenessRecovery);

  // Optimized triggers
  const isOptimized =
    !isLockdown &&
    !isShadowMode &&
    !isRecoveryLock &&
    sleep >= profile.minSleepOptimized &&
    focus >= profile.minFocusOptimized &&
    drift <= profile.maxDriftOptimized &&
    energy >= profile.minEnergyOptimized &&
    score >= 80;

  if (isLockdown) {
    mode = "LOCKDOWN";
    recommendedCommand = "/rest";
    actionSeverity = "CRITICAL";
    blockedActions = ["deploy", "launch_campaign", "strategic_decision", "social_post"];
    forcedActions = ["force_rest"];
  } else if (isShadowMode) {
    mode = "SHADOW_MODE";
    recommendedCommand = "/strict";
    actionSeverity = "WARNING";
    blockedActions = ["deploy", "launch_campaign"];
    allowedActions.push("develop", "bugfix", "task_management");
  } else if (isRecoveryLock) {
    mode = "RECOVERY_LOCK";
    recommendedCommand = "/rest";
    actionSeverity = "MODERATE";
    blockedActions = ["hard_physical_training", "aggressive_scheduling"];
    allowedActions.push("develop", "bugfix", "task_management", "stretch_and_mobility");
  } else if (isOptimized) {
    mode = "OPTIMIZED";
    recommendedCommand = "/expand";
    actionSeverity = "NONE";
    allowedActions = ["deploy", "launch_campaign", "strategic_decision", "social_post", "develop", "bugfix", "task_management", "stretch_and_mobility"];
  } else {
    mode = "STABLE";
    recommendedCommand = "/execute";
    actionSeverity = "NONE";
    allowedActions = ["deploy", "launch_campaign", "strategic_decision", "social_post", "develop", "bugfix", "task_management"];
  }

  // Compile system prompt injection text
  let promptGuardrailText = "";
  if (mode === "LOCKDOWN") {
    promptGuardrailText = `
[HEALTH GOVERNOR: LOCKDOWN MODE ACTIVE (Score: ${score}/100)]
Nour is severely compromised. Do NOT assist with or allow deploying code, launching marketing ad sets, or making major strategic decisions.
Actively push for absolute rest. Enforce the '/rest' command format. Reject any task that incurs decision fatigue.
Reasons: ${reasons.join("; ")}
`.trim();
  } else if (mode === "SHADOW_MODE") {
    promptGuardrailText = `
[HEALTH GOVERNOR: SHADOW MODE ACTIVE (Score: ${score}/100)]
Nour's focus, sleep, or drift levels are degraded. Restrict high-risk deployment or marketing campaigns unless absolutely verified or explicitly overridden.
Speak with extreme discipline. Enforce the '/strict' command focus. Highlight blind spots aggressively.
Reasons: ${reasons.join("; ")}
`.trim();
  } else if (mode === "RECOVERY_LOCK") {
    promptGuardrailText = `
[HEALTH GOVERNOR: RECOVERY LOCK ACTIVE (Score: ${score}/100)]
Nour is experiencing high physical muscle soreness or injury. Warn against strenuous physical training or aggressive over-scheduling.
Ensure recovery tasks are elevated to the top of the queue. Recommend the '/rest' command.
Reasons: ${reasons.join("; ")}
`.trim();
  } else if (mode === "OPTIMIZED") {
    promptGuardrailText = `
[HEALTH GOVERNOR: OPTIMIZED MODE ACTIVE (Score: ${score}/100)]
Nour is in peak state with excellent sleep, high energy, and minimal drift.
Push for aggressive execution, launch high-leverage initiatives, and expand capabilities. Recommend '/expand'.
Reasons: ${reasons.join("; ")}
`.trim();
  } else {
    promptGuardrailText = `
[HEALTH GOVERNOR: STABLE MODE ACTIVE (Score: ${score}/100)]
Nour's readiness is stable. Execute on active tasks and standard operations.
`.trim();
  }

  return {
    mode,
    score,
    reasons,
    blockedActions,
    allowedActions,
    delayedActions,
    forcedActions,
    recommendedCommand,
    actionSeverity,
    promptGuardrailText,
  };
}
