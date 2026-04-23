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
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Vendor splits — keep big deps isolated so customer pages don't
          // drag them in. Order matters: most specific first.
          if (id.includes("node_modules")) {
            if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) {
              return "vendor-charts";
            }
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("date-fns")) return "vendor-date";
            if (id.includes("@tanstack") || id.includes("@trpc") || id.includes("superjson")) {
              return "vendor-data";
            }
            // React 19 ecosystem — MUST be a single chunk. Splitting React
            // from `scheduler` / `react-is` / `use-sync-external-store` causes
            // "Cannot set properties of undefined (setting 'Activity')" at
            // load time because vendor-misc evaluates before React exports
            // its Activity API. Regex matches POSIX + Windows paths.
            if (/[\\/](react|react-dom|react-hook-form|scheduler|react-is|use-sync-external-store|wouter|sonner)[\\/]/.test(id)) {
              return "vendor-react";
            }
            return "vendor-misc";
          }
          // Admin shell — all admin sections land in a single chunk, lazy-loaded
          if (id.includes("/pages/admin/") || id.includes("\\pages\\admin\\")) {
            return "admin";
          }
          // Blog + long-form content
          if (id.includes("/pages/Blog") || id.includes("\\pages\\Blog")) {
            return "blog";
          }
          if (id.includes("/pages/Guide") || id.includes("\\pages\\Guide")) {
            return "guides";
          }
          // Large per-route pages that don't belong in the main bundle
          if (/pages\/(TireFinder|ServicePage|DiagnosePage|CostEstimator|LaborEstimator)/.test(id)) {
            return "seo-pages";
          }
          // everything else falls through to the default chunking
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
