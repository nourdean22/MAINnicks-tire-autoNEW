export const DEFAULT_MENTION_RESOLUTION_TIMEOUT_MS = 1_200;

export type MentionResolutionSource = "async" | "sync" | "raw";

export interface MentionResolutionResult {
  text: string;
  source: MentionResolutionSource;
  timedOut: boolean;
}

/**
 * Resolve @mentions without holding the composer hostage.
 *
 * Server-backed mentions can touch the database. The optimistic message is
 * already visible before this runs;