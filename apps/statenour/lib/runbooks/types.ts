/**
 * Agent runbooks — types.
 *
 * A runbook is structured operating knowledge ("how to work safely here"), not
 * just a fact. The typed catalog (catalog.ts) carries the metadata; the full
 * prose lives in docs/runbooks/<id>.md. `pnpm check:runbooks` validates both.
 *
 * See docs/project/NEXT-INTELLIGENCE-WAVE.md (P6).
 */

export type RunbookStatus = "active" | "historical" | "retired";
export type RunbookRisk = "low" | "medium" | "high";

export interface Runbook {
  /** Stable kebab id. Unique. Matches the docs/runbooks/<id>.md filename. */
  id: string;
  title: string;
  /** Area of operation (deploy, migrations, classifier, …). */
  domain: string;
  status: RunbookStatus;
  /** One line: when an agent should reach for this runbook. */
  whenToUse: string;
  /** Doc/code pointers that this runbook defers to. */
  sourceOfTruth: string[];
  /** The hard rules. */
  rules: string[];
  /** Commands an agent runs (may be empty). */
  commands: string[];
  /** Traps + lessons. */
  gotchas: string[];
  /** How to verify the work. */
  verification: string[];
  /** How to undo. */
  rollback: string;
  /**
   * Repo-relative files this runbook touches. Prefix with `external:` for paths
   * outside apps/statenour, or `manual:` for human-only steps — those skip the
   * existence check.
   */
  relatedFiles: string[];
  /** YYYY-MM-DD last verified against reality. */
  lastVerified: string;
  owner: string;
  riskLevel: RunbookRisk;
  /** Repo-relative markdown with the full prose. */
  docPath: string;
}
