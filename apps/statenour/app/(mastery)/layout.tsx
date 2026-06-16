import { FloatingHome } from "@/components/layout/floating-home";
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
import { BottomPulseTicker } from "@/components/ultron/bottom-pulse-ticker";
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

export default function MasteryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TRPCProvider>
    <NourStateProvider>
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
        {/* May 02 · pb fix · BottomPulseTicker is fixed bottom-0 (h-5 +
            border = 21px). Pre-fix, md:pb-0 left desktop content sliding
            under the ticker. md:pb-8 (32px) clears the ticker with a
            touch of breathing room; mobile keeps pb-20 (80px) to clear
            the orb stack too. */}
        <main className="pb-20 md:pb-8">
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
      {/* Floating orb — single nav surface for all viewports. */}
      <FloatingHome />
      {/* Phase H.2 · global deep-mode hint · sees focused input, runs
          quick client classifier, chip appears bottom-right when
          verdict ≥ deep. One-tap to /reason. */}
      <DeepModeNudge />
      {/* N.4 · global host for the focus-trap confirm Dialog · listens
          for megaConfirm() calls + renders the modal. */}
      <MegaConfirmHost />
      {/* Global brain-dump capture — Cmd/Ctrl+Shift+J from anywhere. */}
      <BrainDumpModal />
      {/* v7.3 · Apr 29 · BottomPulseTicker is GLOBAL now. Was scoped to
          HQ (Ultron) only. Lifted to layout so emerging brain signals
          (commitment scatter, late-night patterns, idle pulls) flow
          ambiently across every page — and the bell can drop the
          "EMERGING" tier entirely. Bell now reserved for true alerts. */}
      {/* May 02 · iPhone safe-area · pb extends the dark backdrop into
          the home-indicator zone so the colored strip + blur cover it
          rather than leaving the indicator floating over transparent
          content. h-5 BottomPulseTicker stays its 21px above the inset. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] bg-[var(--bg-void)]/60"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <BottomPulseTicker />
      </div>
    </NourStateProvider>
    </TRPCProvider>
  );
}
