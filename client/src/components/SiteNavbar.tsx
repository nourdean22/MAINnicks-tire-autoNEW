/**
 * Shared Tesla-style Navbar — used across all pages.
 * Minimal wordmark, 5 nav items, Diagnose CTA, phone pill.
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { trackPhoneClick } from "@/components/SEO";
import { Phone, Menu, X } from "lucide-react";
import { motion } from "framer-motion";

const NAV_LINKS = [
  { label: "Services", href: "/#services" },
  { label: "Reviews", href: "/reviews" },
  { label: "Specials", href: "/specials" },
  { label: "About", href: "/about" },
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

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-nick-dark/90 backdrop-blur-xl" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="text-nick-yellow font-semibold text-lg tracking-tight">Nick's Tire & Auto</span>
        </Link>

        <div className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm font-medium tracking-wide transition-colors ${l.href === activeHref ? "text-foreground" : "text-foreground/70 hover:text-foreground"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-4">
          <Link href="/diagnose" className="text-sm font-medium text-nick-yellow hover:text-nick-gold transition-colors">
            Diagnose My Car
          </Link>
          <a
            href="tel:2168620005"
            onClick={() => trackPhoneClick("navbar")}
            className="text-sm font-medium bg-foreground text-background px-5 py-2 rounded-full hover:bg-foreground/90 transition-colors"
            aria-label="Call Nick's Tire and Auto"
          >
            (216) 862-0005
          </a>
        </div>

        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2" aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="lg:hidden fixed inset-0 top-16 bg-nick-dark/98 backdrop-blur-xl z-40">
          <div className="container py-12 flex flex-col gap-6">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="text-2xl font-semibold text-foreground/80 hover:text-foreground transition-colors tracking-tight">
                {l.label}
              </Link>
            ))}
            <Link href="/diagnose" onClick={() => setMobileOpen(false)} className="text-2xl font-semibold text-nick-yellow tracking-tight">
              Diagnose My Car
            </Link>
            <div className="pt-6 border-t border-border">
              <a href="tel:2168620005" onClick={() => trackPhoneClick("navbar-mobile")} className="inline-flex items-center gap-2 text-lg text-foreground/60" aria-label="Call Nick's Tire and Auto">
                <Phone className="w-4 h-4" />
                (216) 862-0005
              </a>
            </div>
          </div>
        </motion.div>
      )}
    </nav>
  );
}
