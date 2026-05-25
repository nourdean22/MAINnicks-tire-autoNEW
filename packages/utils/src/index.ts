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
// Wave AN hotfix (2026-05-26) · .js extensions required for Node ESM
// runtime resolution. tsc with moduleResolution:Bundler emits raw
// specifiers; vite/esbuild on the CLIENT bundle the dep so it works
// there. But the SERVER (esbuild --packages=external · Node ESM at
// runtime) needs explicit extensions to find the file. The Wave AE+AF+AI
// server-side `import { withTimeout } from "@nour/utils"` calls exposed
// this latent bug · without it, nickstire's prod start crashed with
// ERR_MODULE_NOT_FOUND on @nour/utils/dist/cn.
export { cn } from "./cn.js";
export {
  withTimeout,
  withTimeoutOrFallback,
  fetchWithTimeout,
} from "./with-timeout.js";
