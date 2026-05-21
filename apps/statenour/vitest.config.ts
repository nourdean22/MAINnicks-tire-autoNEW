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
  },
  resolve: {
    alias: {
      "@": rootDir,
      // v10.0.209 · `server-only` is a Next.js runtime guard that
      // throws in client bundles. Vitest runs in Node, has no client
      // distinction, and shouldn't choke on the import. Map it to an
      // empty shim so any module annotated `import "server-only"` can
      // be imported by tests without installing the package.
      "server-only": path.resolve(rootDir, "tests/setup/server-only-shim.ts"),
    }
  }
});
