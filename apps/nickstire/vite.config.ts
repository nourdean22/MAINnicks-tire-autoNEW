import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Critical-CSS extraction via beasties was attempted (see
// scripts/vite-plugin-critical-css.mjs) but Tailwind 4's @layer + CSS
// variable structure isn't compatible with beasties' postcss parsing.
// Beasties extracts 0 critical rules even with full prerendered DOM.
// Decision: keep the standard async-CSS strategy (font preload-onload
// already shipped) and revisit critical-CSS only if mobile render-block
// stays high after font fix lands. The plugin file is kept for reference.
export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const plugins = [react(), tailwindcss(), ...(isDev ? [jsxLocPlugin()] : [])];

  return {
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
    // wave-fix-2026-05-25 (PSI mobile perf) · drop admin/blog/guides/seo-pages
    // from <link rel="modulepreload"> on the entry HTML. Those chunks are
    // React.lazy()-loaded · they download on-demand when the user routes to
    // them. Vite's default preloads ALL reachable chunks · on the homepage
    // that meant ~150-300 KB of pointless bandwidth + 3 extra HTTP/2 streams
    // before any LCP work could happen on mobile 3G/4G. Customer-facing
    // page-chunks aren't named (Rollup's auto-chunker handles them) so this
    // filter only strips the 4 admin-adjacent named chunks.
    //
    // Lazy-loading still works at runtime · the chunks exist on disk + are
    // fetched via dynamic import() when the React.lazy() route mounts. This
    // ONLY removes the speculative preload hint.
    modulePreload: {
      resolveDependencies: (_filename, deps, { hostType }) => {
        if (hostType !== "html") return deps;
        return deps.filter(
          (dep) => !/\b(admin|blog|guides|seo-pages)-[A-Za-z0-9_-]+\.js$/.test(dep)
        );
      },
    },
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
          if (id.includes("node_modules")) {
            // Isolate core React to guarantee it initializes first and together
            if (
              /[\\/]node_modules[\\/](react|react-dom|scheduler|react-is)[\\/]/.test(id)
            ) {
              return "vendor-react";
            }
            return undefined;
          }
          // Admin shell — only the SHARED admin helpers land in the admin chunk.
          // Individual sections (LeadsSection, WinBackSection, etc.) are NOT
          // forced into the same chunk so React.lazy() can produce per-section
          // chunks and download them on-demand.
          //
          // Before this fix (May 2026): all 30+ admin files bundled into a
          // single 1.7MB chunk — admins paid the full cost on every first
          // visit even though most sections were never opened. After: only
          // shared.tsx + AdminSectionBoundary + Admin.tsx land in `admin`
          // (~80-150KB), each Section gets its own ~20-100KB chunk on demand.
          if (
            (id.includes("/pages/admin/shared") || id.includes("\\pages\\admin\\shared")) ||
            (id.includes("/components/admin/") || id.includes("\\components\\admin\\"))
          ) {
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
  };
});
