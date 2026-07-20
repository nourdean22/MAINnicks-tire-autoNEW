import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  plugins: [react()],
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    // singleFork serial mode (canonical on Windows) shares one process across
    // all test files — auto-revert vi.stubEnv / vi.stubGlobal before each test
    // so stubs can never leak across files.
    unstubEnvs: true,
    unstubGlobals: true,
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "server/__tests__/**/*.test.ts",
      // shared/ holds the pure cross-boundary modules both the server and the
      // client import. Without this glob a test file placed there is silently
      // NEVER RUN — it looks like coverage in the tree and contributes nothing,
      // which is the worst possible failure mode for a test.
      "shared/**/*.test.ts",
      "client/src/__tests__/**/*.test.ts",
      "client/src/__tests__/**/*.test.tsx",
    ],
    environmentMatchGlobs: [
      ["client/src/__tests__/**", "jsdom"],
    ],
    setupFiles: ["client/src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: [
        "server/routers/booking.ts",
        "server/routers/lead.ts",
        "server/services/featureFlags.ts",
        "server/sms.ts",
        "server/lib/ai-gateway.ts",
        "server/lib/health.ts",
        "server/services/pushNotifications.ts",
        "server/services/googleAdsConversion.ts",
        "server/services/snapFinanceSync.ts",
        "server/services/workOrderAutomation.ts",
        "server/cron/jobs/retentionSequences.ts",
        "server/services/payments.ts",
        "server/routers/payments.ts",
        "server/routers/memberships.ts",
        "server/services/refundWriteback.ts",
        "server/routers/gatewayTire.ts",
        "server/routers/advanced/invoices.ts",
        "server/services/invoiceReconciliation.ts",
        "server/lib/tire-order-guards.ts",
        "server/lib/membership-guards.ts",
        "server/services/invoiceGenerator.ts",
        "server/services/snapApplications.ts",
        "server/services/financingPreQual.ts",
        "server/services/declinedRecoverySequence.ts",
        "server/services/declinedWorkRecovery.ts",
        "server/services/auditTrail.ts",
        "server/services/quoteEngine.ts",
        "server/routers/costEstimator.ts",
        "shared/business.ts",
        "shared/const.ts",
      ],
      thresholds: {
        statements: 20,
        branches: 60,
        functions: 35,
        lines: 20,
      },
    },
  },
});
