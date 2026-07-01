export type AIESourceType = 
  | "competitor_watch"
  | "saas_ai"
  | "market_sentiment"
  | "cyber_risk"
  | "system_internal";

export type AIEActionabilityBand = 
  | "GRAVEYARD" // < 60
  | "BRIEFING"  // 60-89
  | "OVERRIDE"; // >= 90

export interface IntelligenceSignalPayload {
  source: AIESourceType;
  url?: string;
  title: string;
  summary: string;
  derivativeContext?: string; // The LLM-extracted "So What?" delta
  actionabilityIndex: number; // 0-100
  metadata?: Record<string, unknown>;
}

export function getActionabilityBand(score: number): AIEActionabilityBand {
  if (score >= 90) return "OVERRIDE";
  if (score >= 60) return "BRIEFING";
  return "GRAVEYARD";
}
