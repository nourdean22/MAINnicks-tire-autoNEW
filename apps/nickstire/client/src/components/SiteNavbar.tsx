/**
 * Premium Navbar — Tesla-grade minimal design.
 * Wordmark left, nav center, actions right. Glass morphism on scroll.
 */
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { trackPhoneClick } from "@/components/SEO";
import { Phone, Menu, X, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";
import { useBusinessHours } from "@/hooks/useBusinessHours";
import BrandMark from "@/components/BrandMark";
import NonstopNickTopBar from "@/components/NonstopNickTopBar";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// Tires sits FIRST — highest customer intent. Without this entry, tire-
// buyers landing on the homepage had no nav-level path to /tires (they
// had to scroll past the hero into the symptom grid to find "GET TIRES
// TODAY"). Direct browser audit found this was the single biggest
// discovery gap in the customer journey.
const NAV_LINKS = [
  { label: "Tires", href: "/tires" },
  { label: "Services", href: "/services" },
  { label: "Financing", href: "/financing" },
  { label: "Reviews", href: "/reviews" },
  { label: "Specials", href: "/specials" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export default function SiteNavbar({ activeHref }: { activeHref?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isOpen } = useBusinessHours();
  const hasEmergencyBanner = !isOpen;
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Focus trap + Escape + initial focus + focus restoration for the mobile
  // menu — same contract every other overlay gets via useFocusTrap.
  useFocusTrap(menuRef, mobileOpen, {
    onEscape: () => setMobileOpen(false),
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <nav
      className={`fixed left-0 right-0 z-50 transition-all duration-500 ${
        hasEmergencyBanner ? "top-[56px] sm:top-[48px]" : "top-0"
      } ${
        scrolled
          ? "bg-[oklch(0.06_0.004_260/0.92)] backdrop-blur-2xl shadow-[0_1px_0_oklch(0.17_0.004_260/0.5)]"
          : "bg-transparent"
      }`}
    >
      {/* Membership band lives INSIDE the fixed nav cluster (2026-07-04
          overlap fix — see NonstopNickTopBar header). Collapses once the
          page scrolls so the persistent strip is only ever the navbar.
          Hidden while the emergency closed-banner is up: that banner
          already offsets the nav by 56px and stacking three strips is
          exactly what the original LCP note forbids. */}
      {!hasEmergencyBanner && <NonstopNickTopBar collapsed={scrolled} />}
      <div className="container flex items-center justify-between h-[60px]">
        {/* ─── BRAND MARK + WORDMARK ─── */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <BrandMark variant="compact" size={36} className="shrink-0 group-hover:opacity-90 transition-opacity" />
          <span className="text-primary font-bold text-[17px] tracking-[-0.02em] group-hover:opacity-80 transition-opacity hidden sm:inline">
            Nick&apos;s Tire &amp; Auto
          </span>
        </Link>

        {/* ─── CENTER NAV ─── */}
        <div className="hidden lg:flex items-center gap-4 xl:gap-7">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[13px] font-medium tracking-[-0.005em] transition-colors duration-200 ${
                l.href === activeHref
                  ? "text-foreground"
                  : "text-foreground/70 hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* ─── RIGHT ACTIONS ─── */}
        <div className="hidden lg:flex items-center gap-2 xl:gap-3">
          <Link
            href="/diagnose"
            className="text-[13px] font-medium text-primary/80 hover:text-primary transition-colors duration-200"
          >
            Diagnose
          </Link>
          <Link
            href="/pricing"
            className="text-[13px] font-medium text-foreground/70 hover:text-foreground transition-colors duration-200"
          >
            Estimate
          </Link>
          <a
            href={BUSINESS.phone.href}
            onClick={() => trackPhoneClick("navbar")}
            className="flex items-center gap-1.5 text-[13px] font-semibold bg-foreground/[0.08] border border-foreground/[0.08] text-foreground px-4 py-2 min-h-[44px] rounded-full hover:bg-foreground/[0.12] hover:border-foreground/[0.12] transition-all duration-200"
            aria-label="Call Nick's Tire and Auto"
          >
            <Phone className="w-3.5 h-3.5" />
            {BUSINESS.phone.display}
          </a>
        </div>

        {/* ─── MOBILE TOGGLE ─── */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden text-foreground/70 hover:text-foreground p-2 -mr-2 transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* ─── MOBILE MENU ─── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            ref={menuRef}
            id="mobile-nav-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={`lg:hidden fixed inset-0 ${hasEmergencyBanner ? "top-[116px] sm:top-[108px]" : "top-[60px]"} bg-[oklch(0.06_0.004_260/0.98)] backdrop-blur-2xl z-40`}
          >
            <div className="container py-10 flex flex-col gap-1">
              {NAV_LINKS.map((l, i) => (
                <motion.div
                  key={l.href}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.2 }}
                >
                  <Link
                    href={l.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-between py-4 border-b border-foreground/[0.06] text-[22px] font-semibold text-foreground/80 hover:text-foreground tracking-[-0.02em] transition-colors"
                  >
                    {l.label}
                    <ArrowRight className="w-4 h-4 text-foreground/20" />
                  </Link>
                </motion.div>
              ))}

              <div className="mt-6 flex flex-col gap-3">
                <Link
                  href="/diagnose"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 py-3.5 bg-primary/10 border border-primary/20 text-primary font-semibold text-[15px] rounded-lg"
                >
                  Diagnose My Car
                </Link>
                <Link
                  href="/pricing"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 py-3.5 bg-foreground/[0.05] border border-foreground/[0.08] text-foreground/70 font-semibold text-[15px] rounded-lg"
                >
                  Get Estimate
                </Link>
              </div>

              <div className="mt-8 pt-6 border-t border-foreground/[0.06]">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("navbar-mobile")}
                  className="flex items-center justify-center gap-2.5 min-h-[48px] py-3 px-4 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
                  aria-label="Call Nick's Tire and Auto"
                >
                  <Phone className="w-5 h-5" />
                  <span className="text-[16px] font-semibold">Call {BUSINESS.phone.display}</span>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
