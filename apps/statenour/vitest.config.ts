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
    // 2026-05-23 · Wave G · threads pool is dramatically faster than
    // the default `forks` pool on Windows (process-spawn cost is heavy
    // on Win32 · threads share the V8 heap). Safe here because all
    // tests are pure-function / Prisma-mocked · no native modules that
    // require process isolation. On Linux CI both pools are close.
    pool: "threads",
    poolOptions: {
      threads: {
        // useAtomics speeds up cross-thread coordination · default off
        // for backwards compatibility but recommended for our scale.
        useAtomics: true,
      },
    },
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
