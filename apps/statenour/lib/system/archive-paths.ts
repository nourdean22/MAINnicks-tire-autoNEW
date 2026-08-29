/**
 * Archive path + retention policy for the nightly brain archive.
 *
 * Extracted from scripts/export-brain-archive.ts 2026-08-29 so the
 * dated-file / promote-on-success / retention BEHAVIOUR is unit-testable
 * (scripts/ is tsc-excluded; lib/ is not). The exporter imports these —
 * the test proves the production code, not a copy of it.
 *
 * Design (operator directive 2026-08-29, after the exporter's in-place
 * overwrite destroyed the 08-27 archive — the only pre-deletion snapshot
 * of 54,107 hard-deleted brain rows):
 *
 *   _archive/dated/<yyyy-mm-dd>/   one dated dir per run; a crash
 *                                  mid-export leaves yesterday's latest
 *                                  intact and today's damage confined to
 *                                  the dated dir.
 *   _archive/<file>                "latest" copies, promoted ONLY after
 *                                  the dated write fully succeeded.
 *   _archive/snapshots/            manual/operator snapshots — NEVER
 *                                  touched by any automated retention.
 *
 * Retention prunes only `dated/` dirs whose name parses as a stamp older
 * than ARCHIVE_RETENTION_DAYS. A dir whose name is not a valid stamp is
 * never a prune candidate — retention can only delete what it can date.
 */

/** How many days of dated archives to keep. ~96 MB/day; 30 ≈ 2.9 GB. */
export const ARCHIVE_RETENTION_DAYS = 30;

/** The three files an archive run produces. Dated write first, then promote. */
export const ARCHIVE_FILES = [
  "brain-memories.ndjson",
  "brain-orphans.ndjson",
  "brain-memories.manifest.json",
] as const;

export type ArchiveFile = (typeof ARCHIVE_FILES)[number];

/** Dated-dir name for a run: "dated/2026-08-29". UTC — the job runs at
 * 3am local but the stamp only needs to be unique per run and sortable. */
export function datedDirName(d: Date): string {
  return `dated/${d.toISOString().slice(0, 10)}`;
}

/** Parse the date out of a "dated/<yyyy-mm-dd>" dir name. null if the name
 * is not a stamped dated dir — such entries are never pruned. */
export function parseDatedDirStamp(name: string): Date | null {
  const m = name.match(/^dated\/(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Reject impossible dates ("dated/2026-13-99" must not parse to something
  // prune-eligible; a real Date would roll over silently).
  if (d.getUTCFullYear() !== Number(m[1])) return null;
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
  if (d.getUTCDate() !== Number(m[3])) return null;
  return d;
}

/**
 * Split dated-dir names into keep/prune. Pure: takes names + now, returns
 * the verdict. Only names parseable by parseDatedDirStamp and strictly
 * older than ARCHIVE_RETENTION_DAYS are pruned. Same-day and future
 * stamps are always kept (a clock skew must never delete today's archive).
 */
export function selectRetainedDatedDirs(
  names: string[],
  now: Date = new Date(),
): { keep: string[]; prune: string[] } {
  const cutoff = now.getTime() - ARCHIVE_RETENTION_DAYS * 86_400_000;
  const keep: string[] = [];
  const prune: string[] = [];
  for (const name of names) {
    const stamp = parseDatedDirStamp(name);
    if (stamp === null || stamp.getTime() >= cutoff) keep.push(name);
    else prune.push(name);
  }
  return { keep, prune };
}