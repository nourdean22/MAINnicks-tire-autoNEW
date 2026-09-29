/**
 * Q-34 · Process-role switch for Nick's Tire.
 *
 * This does NOT split the service by itself. It makes job ownership explicit so
 * a future Railway nickstire-jobs service can be introduced as a config change.
 *
 * - all  (default): current behaviour; serve web + own background jobs.
 * - web: serve HTTP only; do not start background job processors.
 * - jobs: serve HTTP health/admin surfaces and own background jobs. A dedicated
 *   jobs service can use this role while the public service uses web.
 *
 * Invalid values fail loudly at boot rather than silently duplicating or
 * disabling jobs.
 */
export type ProcessRole = "all" | "web" | "jobs";

export function resolveProcessRole(raw: string | undefined | null): ProcessRole {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "all";
  if (value === "all" || value === "web" || value === "jobs") return value;
  throw new Error(
    `PROCESS_ROLE must be one of all|web|jobs; received "${raw}"`,
  );
}

export function processRoleRunsJobs(role: ProcessRole): boolean {
  return role === "all" || role === "jobs";
}

export function processRoleServesWeb(_role: ProcessRole): boolean {
  // The executable remains one Express server in Q-34. The jobs role keeps
  // health/admin endpoints available for observability; traffic routing is a
  // later Railway concern, not hidden in this switch.
  return true;
}
