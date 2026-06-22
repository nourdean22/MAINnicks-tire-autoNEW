/**
 * Statenour Research Lab Core Types
 */

export type ResearchDomain =
  | "business"
  | "ai_system"
  | "health"
  | "personal_os"
  | "content"
  | "finance"
  | "competitive_intel"
  | "legal"
  | "general";

export type ResearchSourceType =
  | "url"
  | "pdf"
  | "markdown"
  | "repo_file"
  | "obsidian_note"
  | "database_record"
  | "youtube_transcript"
  | "manual";

export interface ResearchSource {
  id: string;
  title: string;
  type: ResearchSourceType;
  url?: string;
  path?: string;
  content: string;
  summary?: string;
  capturedAt: string;
  contentHash: string;
  scrapeStatus: "success" | "failed" | "failed_missing_key" | "failed_timeout";
  authorityScore?: number;
  recencyScore?: number;
  relevanceScore?: number;
  biasScore?: number;
  actionabilityScore?: number;
}

export interface ResearchClaim {
  id: string;
  claim: string;
  evidence: string;
  confidence: number;
  sourceIds: string[];
  action?: string;
  contradictionIds?: string[];
}

export interface ResearchPack {
  id: string;
  slug: string;
  title: string;
  domain: ResearchDomain;
  purpose: string;
  coreQuestion: string;
  sources: ResearchSource[];
  claims: ResearchClaim[];
  openQuestions: string[];
  recommendedActions: string[];
  createdAt: string;
}
