/**
 * InternalLinks — Cross-page SEO linking component.
 * Displays contextually relevant links to other pages on the site.
 * Rotates links based on the current page to avoid duplicate content.
 */
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { BUSINESS } from "@shared/business";

interface LinkItem {
  href: string;
  label: string;
  desc: string;
}

const ALL_LINKS: LinkItem[] = [
  { href: "/tires", label: "Tire Sales & Service", desc: "New tires, mounting, balancing, TPMS" },
  { href: "/brakes", label: "Brake Repair", desc: "Pads, rotors, calipers, ABS diagnostics" },
  { href: "/diagnostics", label: "Engine Diagnostics", desc: "Check engine light, OBD-II scanning" },
  { href: "/emissions", label: "Emissions & E-Check", desc: "Ohio E-Check repair and testing" },
  { href: "/oil-change", label: "Oil Change", desc: "Conventional and synthetic oil changes" },
  { href: "/general-repair", label: "General Repair", desc: "Suspension, steering, exhaust, cooling" },
  { href: "/diagnose", label: "Diagnose My Car", desc: "AI-powered symptom analysis" },
  { href: "/pricing", label: "Price Estimator", desc: "Get an instant repair cost estimate" },
  { href: "/specials", label: "Specials & Coupons", desc: "Current deals and discounts" },
  { href: "/reviews", label: "Customer Reviews", desc: `4.9 stars from ${BUSINESS.reviews.countDisplay} reviews` },
  { href: "/blog", label: "Repair Tips Blog", desc: "Expert car care advice" },
  { href: "/faq", label: "FAQ", desc: "Common auto repair questions answered" },
  { href: "/contact", label: "Contact & Booking", desc: "Schedule your appointment today" },
  { href: "/fleet", label: "Fleet Accounts", desc: "Commercial vehicle maintenance" },
  { href: "/financing?utm_source=internal_links", label: "Payment Options", desc: "Lease-to-own & financing available" },
  { href: "/rewards", label: "Rewards Program", desc: "Earn points on every service" },
  { href: "/car-care-guide", label: "Car Care Guide", desc: "Seasonal maintenance tips" },
  { href: "/about", label: "About Us", desc: "Cleveland's trusted shop since day one" },
];

interface Props {
  title?: string;
  maxLinks?: number;
  exclude?: string[];
}

export default function InternalLinks({ title = "Explore More Services", maxLinks = 6, exclude = [] }: Props) {
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "/";

  const available = ALL_LINKS.filter(
    (l) => l.href !== currentPath && !exclude.includes(l.href)
  );

  const seed = currentPath.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const shuffled = [...available].sort((a, b) => {
    const hashA = (seed * 31 + a.href.charCodeAt(1)) % 1000;
    const hashB = (seed * 31 + b.href.charCodeAt(1)) % 1000;
    return hashA - hashB;
  });

  const links = shuffled.slice(0, maxLinks);

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
      <div className="container">
        <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-8">
          {title}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center justify-between p-4 border border-border/20 hover:border-primary/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                  {link.label}
                </p>
                <p className="text-xs text-foreground/40 mt-0.5 truncate">{link.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-primary shrink-0 ml-3 transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
