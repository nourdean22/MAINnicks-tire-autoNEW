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
  output: process.platform === "win32" ? undefined : "standalone",
  // CP7 · Railway build containers can't reach Neon as fast as Vercel's
  // can. Three /api/ultron/* routes (signal · pulse · pulse-digest) run
  // 10+ Prisma queries during prerender and hit the 60s default. Bumping
  // to 300s gives the brain engines time to finish without us having to
  // mark every API route dynamic. If routes still time out at 300s the
  // right next move is `export const dynamic = "force-dynamic"` on them.
  staticPageGenerationTimeout: 300,
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

  // v10.0.290 · 3D layer.
  // Wave 53 (2026-05-20): pivoted off Spline to React Three Fiber. The
  // R3F packages (three · @react-three/fiber · @react-three/drei) ship
  // standard ESM/CJS that Next 16 + Turbopack consumes directly — they
  // do NOT need transpilePackages. The R3F <Canvas> is kept client-only
  // via next/dynamic({ ssr: false }) in components/3d/scene-canvas.tsx,
  // so three never enters the SSR bundle. No transpilePackages entry is
  // required for the 3D layer; the prior Spline entries are removed.

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
        // ── Content-Security-Policy ──────────────────────────────────────
        // CSP moved to middleware.ts (audit-2026-06-21) so script-src can use
        // a per-request nonce + 'strict-dynamic' in production. It must live in
        // exactly ONE place — a CSP header here AND in middleware would make the
        // browser enforce their intersection and break the nonce model. The
        // policy (incl. the Ollama/VAPI connect-src) now lives in
        // lib/security/csp.ts. Removed from next.config:
        // {
        //   key: "Content-Security-Policy",
        //   value: [
        //     "default-src 'self'",
        //     "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        //     "style-src 'self' 'unsafe-inline'",
        //     "img-src 'self' data: blob: https:",
        //     "font-src 'self' data:",
            // wave-fix-2026-05-25 · audit · added Ollama Cloud + local
            // localhost:11434 to support the kimi-k2.5:cloud backup
            // provider (operator's fallback when primary providers fail).
            // Without these, the browser blocks fetch to Ollama and the
            // backup chain is broken at the CSP layer even though the
            // ANTHROPIC_BASE_URL env var routes Claude Code to it.
            // wave-fix-2026-05-26 · audit #283 · add api.vapi.ai for the
            // VAPI voice-agent live-call surface (operator can see VAPI
            // status, call list, recordings from the statenour cockpit).
            // Wave H landed Ollama Cloud but missed VAPI · audit caught it.
        //     "connect-src 'self' https://*.openai.com https://*.anthropic.com https://api.venice.ai https://api.vapi.ai https://ollama.com https://*.ollama.com http://localhost:11434 wss:",
        //     "frame-ancestors 'none'",
        //     "base-uri 'self'",
        //     "form-action 'self'",
        //   ].join("; "),
        // },
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
  // /dashboard → /tasks (CP-coherency 2026-05-17 · was pointing at /habits
  // which doesn't exist as a UI page — brain rebuild reduced /brain from
  // 10 pages to 7 and the /habits page was rolled into /tasks DAILY-loop
  // concept · /dashboard redirect was never updated. /tasks is the
  // operator's actual work dashboard.)
  redirects: async () => [
    // Wave AA · 2026-05-28 · /tasks → /missions.
    { source: "/dashboard", destination: "/missions", permanent: false },
    { source: "/habits", destination: "/missions", permanent: false },
    { source: "/tasks", destination: "/missions", permanent: false },
    // 2026-05-30 · /goals consolidated into /stats · point straight at the
    // final page so these don't double-hop through the /goals→/stats stub.
    { source: "/plan", destination: "/stats", permanent: true },
    { source: "/mastery", destination: "/stats", permanent: true },
    { source: "/nick", destination: "/chat", permanent: true },

    // Wave AD · 2026-05-28 · mega-delete redirects · 41 pages deleted ·
    // routing the previously-canonical paths to their new canonical home
    // so bookmarks + cached deep links don't 404 mid-flight.
    // Cockpit: Sam-led / IS the cockpit now (Wave AC).
    { source: "/cockpit", destination: "/", permanent: false },
    { source: "/system/cockpit", destination: "/", permanent: false },
    // Brain consolidation: 4 sub-pages folded into /brain hub.
    { source: "/brain/health", destination: "/brain?tab=health", permanent: false },
    { source: "/brain/identity-trajectory", destination: "/brain", permanent: false },
    { source: "/brain/link-review", destination: "/brain", permanent: false },
    { source: "/brain/reflections", destination: "/brain", permanent: false },
    // Cron triplet → /system/crons only.
    { source: "/system/cron-diagnostics", destination: "/system/crons", permanent: false },
    { source: "/system/cron-runs", destination: "/system/crons", permanent: false },
    // Health triplet → /system/health only.
    { source: "/system/chat-health", destination: "/system/health", permanent: false },
    { source: "/system/data-source-health", destination: "/system/health", permanent: false },
    // Eval quadruplet → /system/calibration (operator-state lens).
    { source: "/system/coverage", destination: "/system/calibration", permanent: false },
    { source: "/system/quality", destination: "/system/calibration", permanent: false },
    { source: "/system/eval-results", destination: "/system/calibration", permanent: false },
    { source: "/system/judge-eval", destination: "/system/calibration", permanent: false },
    // Operator-state duplicates → /system/calibration.
    { source: "/system/operator-state", destination: "/system/calibration", permanent: false },
    { source: "/system/lens-stats", destination: "/system/calibration", permanent: false },
    // Cost dedup → /system/ai-cost only.
    { source: "/system/costs", destination: "/system/ai-cost", permanent: false },
    { source: "/system/performance", destination: "/system/ai-cost", permanent: false },
    // Debug surface → /system/logs (the unified tail).
    { source: "/system/agent-traces", destination: "/system/logs", permanent: false },
    // Devops sprawl → /system hub.
    { source: "/system/deployment-truth", destination: "/system", permanent: false },
    { source: "/system/schema-history", destination: "/system", permanent: false },
    { source: "/system/migrations", destination: "/system", permanent: false },
    { source: "/system/repos", destination: "/system", permanent: false },
    // Admin sprawl → /system hub.
    { source: "/system/policies", destination: "/system", permanent: false },
    { source: "/system/skills", destination: "/system", permanent: false },
    // 2026-06-18 · IA reorg Phase 0 · /system/tools UN-SHADOWED. The live
    // agent-tools registry page (trpc.system.getTools, linked from the System
    // hub grid) was being bounced to /system by this redirect = dead surface.
    // Now reachable; surfaced as a System-hub tile.
    { source: "/system/features", destination: "/system", permanent: false },
    { source: "/system/api-tokens", destination: "/system", permanent: false },
    { source: "/system/devices", destination: "/system", permanent: false },
    { source: "/system/brain-bus", destination: "/system", permanent: false },
    { source: "/system/history", destination: "/system", permanent: false },
    { source: "/system/prompt", destination: "/system", permanent: false },
    { source: "/system/providers", destination: "/system", permanent: false },
    { source: "/system/power", destination: "/system", permanent: false },
    { source: "/system/ghost-nour", destination: "/system/calibration", permanent: false },
    // PR #85 cleanup redirects:
    { source: "/system/approvals", destination: "/system/actions", permanent: false },
    { source: "/system/digest", destination: "/system", permanent: false },
    { source: "/system/coach-events", destination: "/system/alerts", permanent: false },
    { source: "/system/reviews", destination: "/system", permanent: false },
    // 2026-06-18 · IA reorg Phase 0 · /system/proactive-preview UN-SHADOWED.
    // The live proactive-push dry-run page (linked from the System hub grid)
    // was being bounced to /system by this redirect = dead surface. Now
    // reachable; surfaced as a System-hub tile.
    { source: "/system/errors", destination: "/system/logs?view=errors", permanent: false },
    // Reason consolidation. Wave 2 (2026-06-03) · /reason itself folded
    // into /brain?tab=reason · these two land there directly (single hop).
    { source: "/reason/history", destination: "/brain?tab=reason", permanent: false },
    { source: "/reason/telemetry", destination: "/brain?tab=reason", permanent: false },
    // Wave AN · 2026-05-28 · /relationships RENAMED to /people. Operator:
    // "lets change the name from relationships to something cool how
    // about people". Permanent redirect so bookmarks + deep links + the
    // morning Telegram links don't break. Inner /people/network path
    // also lands on /people (which is the dossier surface).
    { source: "/relationships", destination: "/people", permanent: true },
    { source: "/relationships/:path*", destination: "/people/:path*", permanent: true },
    { source: "/people/network", destination: "/people", permanent: false },
    // Nickstire-leakage · external redirect.
    { source: "/system/tire-stock-requests", destination: "https://nickstire.org/admin", permanent: false },
    { source: "/system/vapi-calls", destination: "https://nickstire.org/admin", permanent: false },
    { source: "/customer-360/:customerId*", destination: "https://nickstire.org/admin", permanent: false },
    // Wave 2 surface merge · 2026-06-03 · /financial + /funnel consolidated
    // into the tabbed /business surface (Money + Funnel tabs). Deep links +
    // bookmarks land on the right tab.
    { source: "/financial", destination: "/business?tab=money", permanent: false },
    { source: "/funnel", destination: "/business?tab=funnel", permanent: false },

    // 2026-06-19 · IA reorg Phase 5 · /finance + /wealth consolidated into the
    // tabbed /money hub (Finance + Wealth tabs). Deep links land on the right tab.
    { source: "/finance", destination: "/money?tab=finance", permanent: false },
    { source: "/wealth", destination: "/money?tab=wealth", permanent: false },
    // 2026-06-19 · IA reorg Phase 5 · /crm folded into the /business Clients tab
    // (coaching pipeline next to the funnel it feeds).
    { source: "/crm", destination: "/business?tab=clients", permanent: false },

    // Wave 2 surface merge · /seo + /radar folded into the tabbed /market
    // surface (Search + Radar tabs). Deep links + bookmarks land on the
    // right tab.
    { source: "/seo", destination: "/market?tab=search", permanent: false },
    { source: "/radar", destination: "/market?tab=radar", permanent: false },

    // Wave 2 surface merge · 2026-06-03 · /brain/board + /brain/wisdom +
    // /reason folded into the tabbed /brain surface (Memory + Board +
    // Wisdom + Reason tabs). Memory = the former /brain hub. Deep links +
    // bookmarks land on the right tab; per-tab query params (?focus,
    // ?evolution, ?q, ?h) ride through (Next forwards the query string).
    { source: "/brain/board", destination: "/brain?tab=board", permanent: false },
    { source: "/brain/wisdom", destination: "/brain?tab=wisdom", permanent: false },
    { source: "/reason", destination: "/brain?tab=reason", permanent: false },

    // Wave 2 surface merge · 2026-06-03 · /stats absorbs /body (weight +
    // health log) as a section + the /learn active-learning LOOP. /life
    // (a pure 5-link hub) DELETED. /learn KEEPS its Build-Your-Own-X
    // catalog (force-static dev reference) → NOT redirected.
    { source: "/body", destination: "/stats#body", permanent: false },
    { source: "/life", destination: "/stats", permanent: false },

    // Wave 2 surface merge · 2026-06-03 · /content/drafts + /content/history
    // + /social + /outreach folded into the tabbed /content surface (Drafts +
    // History + Publish + Outreach tabs). Deep links + bookmarks land on the
    // right tab; the Publish ?caption/?imageUrl/?platforms bridge rides
    // through (Next forwards the query string).
    { source: "/content/drafts", destination: "/content?tab=drafts", permanent: false },
    { source: "/content/history", destination: "/content?tab=history", permanent: false },
    { source: "/social", destination: "/content?tab=publish", permanent: false },
    { source: "/outreach", destination: "/content?tab=outreach", permanent: false },
  ],
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false, // CI-friendly — write report, don't open browser
});

export default withBundleAnalyzer(nextConfig);
