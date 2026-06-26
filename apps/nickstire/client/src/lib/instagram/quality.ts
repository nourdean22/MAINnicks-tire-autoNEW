export type ContentQualityGate = "pass" | "warn" | "block";

export interface ContentQualityScore {
  /** 0-10: scroll-stopping power of first line/frame */
  hookStrength: number;
  /** 0-10: matches Nick's brand voice */
  voiceMatch: number;
  /** 0-10: price compliance + no fabrication */
  claimSafety: number;
  /** 0-10: worth saving/sharing */
  saveability: number;
  /** 0-10: Cleveland specificity */
  localRelevance: number;
  /** 0-10: not similar to recent posts */
  novelty: number;
  
  /** Weighted composite of all metrics (0-100) */
  overall: number;
  
  /** 
   * Strict blocking gate:
   * pass: Allowed to publish
   * warn: Needs review, can be overridden
   * block: Failed safety check, requires rewrite
   */
  gate: ContentQualityGate;
  
  /** Explanation for any warnings or blocks */
  reasoning?: string[];
}

export function evaluateQuality(
  metrics: Omit<ContentQualityScore, "overall" | "gate">
): Pick<ContentQualityScore, "overall" | "gate" | "reasoning"> {
  const reasoning: string[] = [];
  let gate: ContentQualityGate = "pass";

  // Critical safety check
  if (metrics.claimSafety < 8) {
    gate = "block";
    reasoning.push("Failed claim safety check. Post may contain pricing errors or fabrications.");
  }

  // Hook check
  if (metrics.hookStrength < 5) {
    if (gate !== "block") gate = "warn";
    reasoning.push("Weak hook. Consider starting with a question, command, or specific number.");
  }

  // Voice check
  if (metrics.voiceMatch < 6) {
    if (gate !== "block") gate = "warn";
    reasoning.push("Weak voice match. Needs to sound more like Nick.");
  }

  // Calculate weighted overall (0-100)
  // Max possible weight sum: 10
  const overall = Math.round(
    (metrics.hookStrength * 2.5 +
     metrics.voiceMatch * 1.5 +
     metrics.claimSafety * 3.0 +
     metrics.saveability * 1.0 +
     metrics.localRelevance * 1.0 +
     metrics.novelty * 1.0)
  );

  return { overall, gate, reasoning };
}
