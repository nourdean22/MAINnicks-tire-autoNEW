/**
 * DB-free cron outcome vocabulary.
 *
 * Keep this module pure: read-side composers such as the Owner Panel should be
 * able to classify a persisted cron status without importing Prisma or the
 * cron-control mutation/runtime machinery.
 */
export const HARD_FAILURE_STATUSES: readonly string[] = ["failed", "interrupted"];

export function isHardFailure(status: string): boolean {
  return HARD_FAILURE_STATUSES.includes(status);
}

/**
 * 2026-10-02 · a `partial` row whose error text carries this prefix was DECLARED
 * degraded by the job itself (lib/inngest/cron-lifecycle.ts deriveDegradation:
 * the intelligence brief's compose timeout). It is distinct from a plain `partial`,
 * a fan-out parent whose children failed — mega-evening alone has written 1,248 of
 * those — whose chronic pattern is owned by diagnose-cron-failure, not paged.
 */
export const DECLARED_DEGRADATION_PREFIX = "degraded · ";

export function isDeclaredDegradation(status: string, error: string | null | undefined): boolean {
  return status === "partial" && typeof error === "string" && error.startsWith(DECLARED_DEGRADATION_PREFIX);
}

/** The job's own reason, without the prefix. Empty string when nothing followed it. */
export function declaredDegradationReason(error: string): string {
  return error.startsWith(DECLARED_DEGRADATION_PREFIX) ? error.slice(DECLARED_DEGRADATION_PREFIX.length).trim() : error.trim();
}
