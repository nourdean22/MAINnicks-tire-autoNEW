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
