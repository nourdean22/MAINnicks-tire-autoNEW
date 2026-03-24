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
    // Target modern browsers for smaller output
    target: "es2020",
    // Increase chunk warning threshold (we code-split aggressively)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual chunk splitting for optimal caching & parallel loading
        manualChunks(id) {          // Vendor: React core — changes rarely, cached long-term
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "vendor-react";
          }
          // Vendor: UI library (Radix + framer-motion)
          if (id.includes("@radix-ui") || id.includes("framer-motion")) {
            return "vendor-ui";
          }
          // Vendor: Data layer (tRPC + TanStack Query)
          if (id.includes("@trpc") || id.includes("@tanstack")) {
            return "vendor-data";
          }
          // NOTE: recharts/d3 intentionally NOT manual-chunked here.
          // Forcing them into a shared chunk caused a d3 circular-dependency
          // crash (ReferenceError: Cannot access 'S' before initialization)
          // that broke the entire site. Let Vite naturally code-split them
          // into the lazy admin chunks where they're actually used.
        },
      },
    },
    // Enable CSS code splitting
    cssCodeSplit: true,
    // Source maps in production for error tracking
    sourcemap: false,
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
