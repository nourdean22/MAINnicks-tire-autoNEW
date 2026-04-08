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
      "client/src/__tests__/**/*.test.ts",
      "client/src/__tests__/**/*.test.tsx",
    ],
    environmentMatchGlobs: [
      ["client/src/__tests__/**", "jsdom"],
    ],
    setupFiles: ["client/src/__tests__/setup.ts"],
  },
});
