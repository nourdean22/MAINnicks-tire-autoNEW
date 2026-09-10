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
    // Serial by DEFAULT, not by remembering a CLI flag.
    //
    // #515 ("deterministic serial vitest") added the comment and the unstub
    // safety nets below but never set `pool`, so `pnpm run test` — and therefore
    // `pnpm run verify` — has always run PARALLEL while AGENTS.md instructed
    // "always pass --pool=forks --poolOptions.forks.singleFork=true". The gate
    // contradicted the rule for months, and only a hand-typed flag was serial.
    //
    // Measured 2026-08-21, same commit, back-to-back on this machine:
    //   parallel : 5,851 passed, 1 FAILED (instagramStudio render smoke timed
    //              out at 60s under concurrent load), exit 1, 186.87s
    //   serial   : 5,858 passed, 0 failed,             exit 0,  81.11s
    // Serial is both correct AND 2.3x faster here — parallelism was buying
    // contention, not speed. Setting it here makes the rule mechanical instead
    // of advisory; drop the CLI flags from any doc that still recites them.
    //
    // SCOPE OF THIS CHANGE, precisely: `forks` is ALREADY the default pool in
    // Vitest 2+ (pinned ^3.2.6, installed 3.2.7), so naming it here is a no-op
    // written for legibility. The only behavioural change is `singleFork` —
    // one worker instead of many. This does NOT revisit #1090's threads->forks
    // switch, which .github/workflows/test.yml:104 blames for CI runtime; that
    // pool choice is untouched and remains the status quo.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // singleFork serial mode shares ONE process across all test files —
    // auto-revert vi.stubEnv / vi.stubGlobal before each test so stubs can
    // never leak across files. These are a safety net, not a licence to skip
    // per-file cleanup (see apps/nickstire/AGENTS.md, test hygiene).
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
      // Same failure mode as shared/ above, found the same way: a 2026-09
      // regression fix for scripts/lint-brand-voice.ts needed a test, and
      // scripts/lib/brandVoiceScope.test.ts sat in the tree — collected by
      // nothing — until this line existed. scripts/lib/ already holds
      // scanText.ts, deliberately extracted from lint-brand-voice.ts so it
      // COULD be unit-tested; this glob is what makes that extraction worth
      // anything.
      "scripts/**/*.test.ts",
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
