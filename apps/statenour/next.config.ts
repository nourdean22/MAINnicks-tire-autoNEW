import type { NextConfig } from "next";
// v10 Horizon 5 — opt-in bundle analysis. Set ANALYZE=true to render
// HTML reports under .next/analyze (or .next-prod/analyze for build:local).
// pnpm scripts: `pnpm analyze` runs the prod build with ANALYZE=true.
import bundleAnalyzer from "@next/bundle-analyzer";

/**
 * Output directory — lets dev + prod build coexist without clashing.
 * When running a local prod build via `pnpm run build:local`, we use
 * `.next-prod` so the concurrent dev server (`.next/`) stays alive.
 * Apr 18 fix: previously `rm -rf .next && pnpm run build` after a
 * cleanup pass would silently break the Claude-Preview dev server
 * because they shared the same output dir. Now they don't.
 *
 * Vercel production deploys use the default `.next` — the NEXT_DIST_DIR
 * env var is only set by the local `build:local` script.
 */
const distDir = process.env.NEXT_DIST_DIR || ".next";

// Stamp the build time so /api/system/deploy-info can surface "deployed Xh ago"
// on HQ. Vercel doesn't expose the actual deploy-created timestamp at
// runtime — this ISO captures when `next build` ran, which is close enough.
const BUILD_TIME = new Date().toISOString();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir,
  // CP5 · Railway Docker requires a self-contained server build.
  // `standalone` produces .next/standalone/server.js with all required
  // node_modules tracing · no `pnpm install` needed in the runtime image.
  // Backward-compatible · Vercel ignores this flag.
  output: "standalone",
  env: {
    BUILD_TIME,
  },

  // Apr 28 · BATCH 4 hotfix — Next 16 + Turbopack typecheck does NOT
  // honor `skipLibCheck: true` from tsconfig and crashes on
  // `googleapis@171.4.0/build/src/apis/gkehub/v2beta.d.ts:1:1` with
  // "Type error: File appears to be binary." even though gkehub is
  // never imported (the package barrel-exports every Google product).
  //
  // Real type errors are still caught by:
  //   1. Pre-push hook (`tsc --noEmit` over the project)
  //   2. CI typecheck job (separate from the build)
  //   3. Local `pnpm typecheck` before each commit
  //
  // So setting ignoreBuildErrors=true here only opts out of the
  // duplicative Next-build-time check that's broken on this version.
  typescript: {
    ignoreBuildErrors: true,
  },

  // ── Hide Next.js dev indicator (the little N circle in dev mode) ─────
  devIndicators: false,

  // ── Image optimization ───────────────────────────────────────────────
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 24hr
  },

  // ── External packages (keep out of client bundle) ────────────────────
  // v10.0.529.103 · Wave 47 · `puppeteer` removed — not in package.json
  // dependencies · was a dead config entry from a prior browser-automation
  // exploration. Browser automation now flows via the claude-in-chrome MCP
  // path · no in-process puppeteer.
  serverExternalPackages: ["@prisma/client"],

  // v10.0.290 · Spline 3D needs its ESM packages transpiled by Next so
  // the Next.js variant (@splinetool/react-spline/next) imports cleanly
  // through the runtime/loader chain. Per spline-3d-integration
  // COMMON_PROBLEMS guide.
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime"],

  // ── Security + performance headers ───────────────────────────────────
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
        // Disable legacy XSS filter — modern browsers don't need it and it can cause issues
        { key: "X-XSS-Protection", value: "0" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://va.vercel-scripts.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://vercel.live https://vitals.vercel-insights.com https://*.openai.com https://*.anthropic.com https://api.venice.ai wss:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ],
    },
    {
      // API routes should never be cached by the browser
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
      ],
    },
    // Apr 17 separation: /api/tires /api/labor /api/quotes /api/applicants
    // /api/appointments all moved to nickstire.org. CORS blocks removed —
    // were decorating routes that no longer exist.
  ],
  // ── Redirects (alias routes) ──────────────────────────────────────────
  redirects: async () => [
    { source: "/dashboard", destination: "/habits", permanent: true },
    { source: "/nick", destination: "/chat", permanent: true },
  ],
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false, // CI-friendly — write report, don't open browser
});

export default withBundleAnalyzer(nextConfig);
