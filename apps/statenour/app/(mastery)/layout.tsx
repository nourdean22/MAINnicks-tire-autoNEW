import { BottomTabBar } from "@/components/layout/bottom-tab-bar";
import { MoreSheet } from "@/components/layout/more-sheet";
import { PageTracker } from "@/components/brain/page-tracker";
import { PageContextBridge } from "@/components/chat/page-context-bridge";
import { SwipeNavigation } from "@/components/layout/swipe-navigation";
import { NeuralBackground } from "@/components/hud/neural-background";
import { KeyboardShortcuts } from "@/components/hud/keyboard-shortcuts";
import { SessionExpiryBanner } from "@/components/hud/session-expiry-banner";
import { AmbientAura } from "@/components/hud/ambient-aura";
import { NourStateProvider } from "@/lib/state/nour-state";
import { BrainDumpModal } from "@/components/brain-dump-modal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
// Phase H.2 (2026-05-18 PM) · DeepModeNudge · global watcher that
// surfaces a tiny gold chip when the focused input matches the
// reasoning classifier at tier ≥ deep · one-tap to /reason pre-filled.
// Non-invasive · listens to document focus/input events · self-hides
// when nothing matches. Lives in layout so it monitors every mastery
// surface (chat textarea, task quick-add, journal, etc).
import { DeepModeNudge } from "@/components/operator/deep-mode-nudge";
// Phase J (2026-05-18 PM) · TRPCProvider · wraps every mastery surface
// so any component can call trpc.X.useQuery / useMutation with end-
// to-end type safety. Legacy useAuthedFetch calls keep working ·
// gradual migration · no big-bang cutover.
import { TRPCProvider } from "@/components/providers/trpc-provider";
// Phase N.4 (2026-05-18 PM) · MegaConfirmHost · accessible focus-trap
// Dialog for mega-tier cost confirms · replaces window.confirm.
// Mounted once at layout root · components call megaConfirm() and
// get a Promise<boolean>.
import { MegaConfirmHost } from "@/components/operator/mega-confirm-dialog";
// BDN-205 (2026-08-13) · AppBadge · pending-approval count on the
// installed PWA's icon via the Badge API. Must live INSIDE TRPCProvider.
import { AppBadge } from "@/components/hud/app-badge";

// ── Render mode (audit-2026-06-21 CSP follow-up) ──────────────────────────
// MUST be force-dynamic. middleware.ts stamps a per-request CSP nonce onto
// every framework <script> via the request headers — but that only happens on
// a live render. A statically prerendered (mastery) page ships with NO nonce,
// so the runtime `'strict-dynamic'` CSP header blocks ALL of its scripts →
// blank/skeleton page in every browser (Chrome, Safari, desktop, phone).
// Dynamic rendering = a live nonce that matches the header. Mirrors
// app/auth/sign-in/page.tsx, which already does this and works.
export const dynamic = "force-dynamic";

export default function MasteryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TRPCProvider>
    <NourStateProvider>
      {/* A11y · WCAG 2.4.1 Bypass Blocks · first focusable element in the
          shell. Keyboard / screen-reader users jump past the ambient HUD,
          tickers, and bottom nav straight to <main id="main-content">.
          Visually hidden until focused (sr-only → not-sr-only on focus). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-[var(--bg-elevated)] focus:px-4 focus:py-2 focus:text-[var(--text-primary)] focus:outline focus:outline-2 focus:outline-[var(--glass-border)]"
      >
        Skip to main content
      </a>
      <NeuralBackground />
      <PageTracker />
      {/* v10.0.529.91 · Wave 35 · invisible · watches usePathname +
          URL hash to extract the entity ID the operator is viewing ·
          writes localStorage + fires nour:page-context-changed event ·
          chat reads on mount + on event so "grade this decision" /
          "act on this reflection" resolve without needing a chip tap. */}
      <PageContextBridge />
      <SwipeNavigation />
      <KeyboardShortcuts />
      {/* v7.4 · Apr 29 · NotificationCenter (bell) RETIRED. Per Nour:
          "the whole free-floating bell thing is annoying — let's just
          have two persistent tickers feed me everything." Priority
          alerts now flow through the GlobalTopTicker; ambient brain
          signals flow through the BottomPulseTicker. /system/health
          remains the canonical surface for true incident triage. */}
      {/* Session-expiry pre-warning — polls /api/auth/session and
          surfaces a fixed banner 10min before expiry so mid-capture
          401s + bounce-to-sign-in don't eat work in progress. Silent
          outside the warn window. */}
      <SessionExpiryBanner />
      {/* AmbientAura (#17) — reads currentState and applies state-aura +
          state-aura-<state> classes on a wrapper around EVERY mastery
          page. Previously only /chat and /command had the ambient
          background glow. Now /settings, /tasks, /journal, /system/*,
          /brain, etc all react to the state change the same way. */}
      {/* Apr 19 · Dropped `min-h-screen` from <main>. AmbientAura's
          wrapper already enforces min-h-screen for the ambient glow, so
          a second one here just created phantom bottom whitespace on
          short pages (e.g. HQ/Ultron when content is < 100vh). */}
      <AmbientAura>
        {/* truth-substrate UI fix (2026-07-21): viewport-fit=cover lets content
            render under the iOS status bar / notch in the installed PWA, which
            covered the top of the page (the operator: "the time covers the back
            button"). Nothing padded the TOP (only the bottom chrome was safe-area
            aware). pt-[env(safe-area-inset-top)] pushes content clear of the
            status bar; it resolves to 0 where there's no inset (e.g. desktop). */}
        <main id="main-content" className="pt-[env(safe-area-inset-top,0px)] pb-[var(--bottom-chrome-h)]">
          <div className="feed py-4 md:py-6 page-enter">
            {/* v11.1 · ErrorBoundary wraps the page content (not the
                chrome). A broken panel still lets the orb, nav, and
                notifications work. The boundary auto-reports to
                /api/errors → visible in /system/errors. */}
            <ErrorBoundary name="mastery.page">
              {children}
            </ErrorBoundary>
          </div>
        </main>
      </AmbientAura>
      {/* 2026-06-18 · IA reorg Phase 4 · the FloatingHome orb is RETIRED as
          primary nav. BottomTabBar (4 daily tabs Home/Missions/Journal/Stats
          + a "More" slot) is the fixed primary surface; MoreSheet is the
          verb-grouped launcher behind "More" with the ⌘K Search tap-trigger.
          The ambient BottomPulseTicker now rides inside BottomTabBar so the
          whole bottom chrome is one stacked, safe-area-aware unit. */}
      <BottomTabBar />
      <MoreSheet />
      {/* Phase H.2 · global deep-mode hint · sees focused input, runs
          quick client classifier, chip appears bottom-right when
          verdict ≥ deep. One-tap to /reason. */}
      <DeepModeNudge />
      {/* N.4 · global host for the focus-trap confirm Dialog · listens
          for megaConfirm() calls + renders the modal. */}
      <MegaConfirmHost />
      {/* Global brain-dump capture — Cmd/Ctrl+Shift+J from anywhere. */}
      <BrainDumpModal />
      {/* BDN-205 · pending-approval count on the PWA icon (Badge API).
          Renders nothing; feature-detected; count matches the Home
          header pill. */}
      <AppBadge />
    </NourStateProvider>
    </TRPCProvider>
  );
}
