import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // v7 · Apr 28 — Exclude Playwright e2e tests from vitest. They use
    // a different runner (`playwright test`) and import @playwright/test
    // which isn't a vitest dep.
    // .next-prod is statenour's NEXT_DIST_DIR for `build:local` — its
    // standalone output bundles nickstire .test.ts files that vitest
    // would otherwise collect and fail on (can't resolve drizzle-orm /
    // the bundle's broken relative paths). Both build dirs are excluded.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-prod/**",
      "tests/e2e/**",
    ],
    // v8.26 · Mock @/lib/auth-guard globally so route tests don't pull
    // next-auth into the vitest node environment (incompatible runtime).
    setupFiles: ["tests/setup/auth-guard-mock.ts"],
    // 2026-07-25 · forks, NOT threads. The 2026-05-23 switch to the
    // threads pool assumed "no native modules load in workers" — that
    // stopped being true once tests began importing modules that reach
    // @/lib/prisma (eager `new PrismaClient()` at import). The Prisma
    // query engine (libquery_engine .so/.dll, napi-rs) then loads inside
    // vitest worker THREADS, and when a worker's JS env is torn down its
    // ThreadsafeFunction callbacks abort the whole process:
    //   FATAL ERROR: threadsafe_function.rs:749 ... InvalidArg
    //   Aborted (core dumped) — exit 134
    // This killed CI on main nondeterministically from run 29847275435
    // (07-21) onward, and is the same class as the long-standing
    // nondeterministic native faults in local full-suite runs on
    // Windows. Forked child processes die cleanly at exit — no live
    // napi TSFN over a dying env — so process isolation is the fix.
    // Do NOT switch back to threads while anything under test can
    // transitively import @/lib/prisma.
    pool: "forks",
    // 2026-07-25 · vitest's default testTimeout is 5s, which was tuned to
    // the old threads pool on a fast dev box. Forked workers pay real
    // process-startup + per-process module-load cost, and CI runs on a
    // 2-core runner, so heavy route tests that measure ~1.4s locally
    // exceeded 5s there (tests/ai/chat/shadow-dispatch.test.ts timed out
    // on run 30171959495, and its in-flight work then polluted the next
    // test in the file). 20s is headroom for the slowest observed test,
    // not a license to hang: a genuinely stuck test still fails, just
    // later. No assertion is relaxed by this.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": rootDir,
      "@nour/utils": path.resolve(rootDir, "../../packages/utils/src/index.ts"),
      // v10.0.209 · `server-only` is a Next.js runtime guard that
      // throws in client bundles. Vitest runs in Node, has no client
      // distinction, and shouldn't choke on the import. Map it to an
      // empty shim so any module annotated `import "server-only"` can
      // be imported by tests without installing the package.
      "server-only": path.resolve(rootDir, "tests/setup/server-only-shim.ts"),
    }
  }
});
