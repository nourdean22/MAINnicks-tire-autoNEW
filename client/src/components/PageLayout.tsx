/**
 * Shared page layout wrapper for all secondary pages.
 * Provides consistent Navbar, Footer, MobileCTA, and optional ChatWidget.
 */
import { useEffect } from "react";
import SiteNavbar from "@/components/SiteNavbar";
import SiteFooter from "@/components/SiteFooter";
import SiteMobileCTA from "@/components/SiteMobileCTA";
import StickyTrustBar from "@/components/StickyTrustBar";
import FomoTicker from "@/components/FomoTicker";
import ChatWidget from "@/components/ChatWidget";
import CallbackModal from "@/components/CallbackModal";
import NotificationBar from "@/components/NotificationBar";
import ReviewCTA from "@/components/ReviewCTA";
import ScrollProgressBar from "@/components/ScrollProgressBar";
import UrgencyWidget from "@/components/conversion/UrgencyWidget";
import ExitIntentModal from "@/components/conversion/ExitIntentModal";

interface PageLayoutProps {
  children: React.ReactNode;
  activeHref?: string;
  showChat?: boolean;
}

export default function PageLayout({
  children,
  activeHref,
  showChat = false,
}: PageLayoutProps) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* 2026-05-06 wave-32 · site-wide ambient grain layer.
          A fixed pointer-events-none pseudo-element sits above the
          background but below all interactive content (z-30 keeps it
          under sticky nav z-50 + modals). 3% opacity with mix-blend
          overlay sells the "real photo on Euclid Ave" texture across
          every page surface — the hero already has a similar
          .photo-grain class scoped to itself; this generalizes it.
          Performance-safe: GPU-only, no scroll listeners, no reflow. */}
      <div
        className="pointer-events-none fixed inset-0 z-30 photo-grain opacity-[0.04] mix-blend-overlay"
        aria-hidden="true"
      />
      {/* ScrollProgressBar — yellow fill + rolling CSS tire on desktop.
          Ambient brand reinforcement on every customer-facing page. */}
      <ScrollProgressBar />
      <NotificationBar />
      <SiteNavbar activeHref={activeHref} />
      <StickyTrustBar />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <ReviewCTA />
      <SiteFooter />
      <SiteMobileCTA />
      <FomoTicker />
      <CallbackModal />
      {/* Conversion-architecture wiring (Batch 1 of v1.1 spec).
          Both components self-suppress on /admin /booking /contact and
          have their own localStorage TTLs so they don't double-prompt. */}
      <UrgencyWidget />
      <ExitIntentModal />
      {showChat && <ChatWidget />}
    </div>
  );
}
