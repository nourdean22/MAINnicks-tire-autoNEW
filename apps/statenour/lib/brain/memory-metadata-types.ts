/**
 * Shared BrainMemory metadata shapes.
 *
 * v11.0 cleanup: every /api/system/* consumer was redefining these
 * inline with `as` assertions. One source of truth now — import from
 * here or extend when adding new categories.
 *
 * Category / metadata map:
 *   · anti_pattern   · `AntiPatternMeta`
 *   · nick_quality   · `NickQualityMeta`
 *   · reply_quality  · `NickQualityMeta` (legacy, same shape)
 *   · power_panel    · `PowerPanelMeta`
 *   · cron_control   · `CronControlMeta`
 *   · spaced_review  · `SpacedReviewMeta`
 */

export type AntiPatternSeverity = "info" | "warn" | "critical";
export type AntiPatternDomain =
  | "business"
  | "personal"
  | "tech"
  | "health"
  | "relationships"
  | "other";

export interface AntiPatternMeta {
  attempt: string;
  outcome: string;
  severity: AntiPatternSeverity;
  domain: AntiPatternDomain;
  /** ISO timestamp of first-ever log */
  firstTriedAt: string;
  /** ISO timestamp of last "revisit" event, or null */
  lastRevisitedAt: string | null;
  /** How many times Nour has re-opened this pattern */
  revisitCount: number;
  tags: string[];
}

export interface NickQualityMeta {
  conversationId?: string;
  overall?: number;
  specificity?: number;
  cliche?: number;
  antiNour?: number;
  length?: number;
  shouldRegen?: boolean;
  wordCount?: number;
  turnIntent?: string;
  turnShape?: string;
  persona?: string;
}

export interface PowerPanelMeta {
  value: unknown;
  updatedAt: string;
  note: string | null;
}

export interface CronControlMeta {
  enabled?: boolean;
  updatedAt?: string;
  note?: string;
}

export interface SpacedReviewMeta {
  /** JSON-encoded in the `content` field, not metadata — but we document here for grep */
  topic?: string;
  interval?: number;
  nextDue?: string;
}

/** Type-narrowing helper — safe JSON metadata extraction. */
export function readMetadata<T>(raw: unknown): T {
  if (raw && typeof raw === "object") return raw as T;
  return {} as T;
}
