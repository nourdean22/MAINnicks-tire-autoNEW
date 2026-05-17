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
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "server/__tests__/**/*.test.ts",
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
        "shared/business.ts",
        "shared/const.ts",
      ],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 40,
        lines: 50,
      },
    },
  },
});
