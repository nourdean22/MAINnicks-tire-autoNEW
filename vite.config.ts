import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const plugins = [react(), tailwindcss(), jsxLocPlugin()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    // Raise the warning ceiling — our main bundle is intentionally larger due
    // to the admin shell. Real target for homepage FCP is the chunks below.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split ONLY our own page shells into separate chunks so customer
        // pages don't drag in admin/blog/guide JS. Leave vendor chunking
        // entirely up to Rollup — manual vendor splitting was causing
        // module-init order bugs (e.g. "Cannot set properties of undefined
        // (setting 'Activity')", "Cannot read properties of undefined
        // (reading 'createContext')") because React-dependent libs in
        // vendor-misc evaluated before vendor-react finished initializing.
        // Rollup's default vendor chunking respects module graph order.
        manualChunks(id: string) {
          // Let all node_modules fall through to Rollup's default chunker.
          if (id.includes("node_modules")) return undefined;
          // Admin shell — all admin sections land in a single chunk, lazy-loaded
          if (id.includes("/pages/admin/") || id.includes("\\pages\\admin\\")) {
            return "admin";
          }
          if (id.includes("/pages/Blog") || id.includes("\\pages\\Blog")) {
            return "blog";
          }
          if (id.includes("/pages/Guide") || id.includes("\\pages\\Guide")) {
            return "guides";
          }
          if (/pages\/(TireFinder|ServicePage|DiagnosePage|CostEstimator|LaborEstimator)/.test(id)) {
            return "seo-pages";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
