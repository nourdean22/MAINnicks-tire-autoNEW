/**
 * @nour/utils · barrel export.
 *
 * Keep this file tiny and additive. Anything moved here must be:
 *   1. Genuinely shared (duplicated in 2+ apps today)
 *   2. Framework-agnostic (no Next.js / Vite / Prisma imports)
 *   3. Pure functions when possible
 *
 * Cross-cutting infra (logger, telemetry, db) stays per-app · those
 * carry framework + env coupling that doesn't compose cleanly.
 */
export { cn } from "./cn";
export { withTimeout, withTimeoutOrFallback, fetchWithTimeout, } from "./with-timeout";
//# sourceMappingURL=index.d.ts.map