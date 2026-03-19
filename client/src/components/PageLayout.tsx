/**
 * Shared page layout wrapper for all secondary pages.
 * Provides consistent Navbar, Footer, MobileCTA, and optional ChatWidget.
 */
import { useEffect } from "react";
import SiteNavbar from "@/components/SiteNavbar";
import SiteFooter from "@/components/SiteFooter";
import SiteMobileCTA from "@/components/SiteMobileCTA";
import ChatWidget from "@/components/ChatWidget";
import CallbackModal from "@/components/CallbackModal";
import NotificationBar from "@/components/NotificationBar";
import { SkipToContent } from "@/components/SEO";

interface PageLayoutProps {
  children: React.ReactNode;
  activeHref?: string;
  showChat?: boolean;
}

export default function PageLayout({ children, activeHref, showChat = false }: PageLayoutProps) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <SkipToContent />
      <NotificationBar />
      <SiteNavbar activeHref={activeHref} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <SiteMobileCTA />
      <CallbackModal />
      {showChat && <ChatWidget />}
    </div>
  );
}
