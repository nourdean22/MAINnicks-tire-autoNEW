/**
 * Premium Navbar — Tesla-grade minimal design.
 * Wordmark left, nav center, actions right. Glass morphism on scroll.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trackPhoneClick } from "@/components/SEO";
import { Phone, Menu, X, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";

const NAV_LINKS = [
  { label: "Services", href: "/#services" },
  { label: "Reviews", href: "/reviews" },
  { label: "Specials", href: "/specials" },
  { label: "About", href: "/about" },
  { label: "Ask a Mechanic", href: "/ask-mechanic" },
  { label: "Contact", href: "/contact" },
];

export default function SiteNavbar({ activeHref }: { activeHref?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[oklch(0.06_0.004_260/0.92)] backdrop-blur-2xl shadow-[0_1px_0_oklch(0.17_0.004_260/0.5)]"
          : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between h-[60px]">
        {/* ─── WORDMARK ─── */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-primary font-bold text-[17px] tracking-[-0.02em] group-hover:opacity-80 transition-opacity">
            Nick's Tire & Auto
          </span>
        </Link>

        {/* ─── CENTER NAV ─── */}
        <div className="hidden lg:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[13px] font-medium tracking-[-0.005em] transition-colors duration-200 ${
                l.href === activeHref
                  ? "text-foreground"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* ─── RIGHT ACTIONS ─── */}
        <div className="hidden lg:flex items-center gap-3">
          <Link
            href="/diagnose"
            className="text-[13px] font-medium text-primary/80 hover:text-primary transition-colors duration-200"
          >
            Diagnose
          </Link>
          <Link
            href="/estimate"
            className="text-[13px] font-medium text-foreground/50 hover:text-foreground transition-colors duration-200"
          >
            Estimate
          </Link>
          <a
            href={BUSINESS.phone.href}
            onClick={() => trackPhoneClick("navbar")}
            className="flex items-center gap-1.5 text-[13px] font-semibold bg-foreground/[0.08] border border-foreground/[0.08] text-foreground px-4 py-[7px] rounded-full hover:bg-foreground/[0.12] hover:border-foreground/[0.12] transition-all duration-200"
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
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* ─── MOBILE MENU ─── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="lg:hidden fixed inset-0 top-[60px] bg-[oklch(0.06_0.004_260/0.98)] backdrop-blur-2xl z-40"
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
                  href="/estimate"
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
                  className="flex items-center gap-2.5 text-foreground/40 hover:text-foreground transition-colors"
                  aria-label="Call Nick's Tire and Auto"
                >
                  <Phone className="w-4 h-4" />
                  <span className="text-[15px] font-medium">{BUSINESS.phone.display}</span>
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
