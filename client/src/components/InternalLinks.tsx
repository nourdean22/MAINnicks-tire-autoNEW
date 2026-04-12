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
  // Core services
  { href: "/tires", label: "Tire Shop Near Me", desc: "New & used tires, mounting, balancing, TPMS — walk-ins" },
  { href: "/brakes", label: "Brake Repair Cleveland", desc: "Expert brake repair — walk-ins welcome" },
  { href: "/diagnostics", label: "Check Engine Light Near Me", desc: "Free scan with repair — OBD-II diagnostics" },
  { href: "/emissions", label: "Emissions & E-Check", desc: "Ohio E-Check repair and testing" },
  { href: "/oil-change", label: "Oil Change Cleveland", desc: "Quick oil change service — conventional and synthetic" },
  { href: "/general-repair", label: "Auto Repair Near Me", desc: "Suspension, steering, exhaust, cooling — full service" },
  { href: "/ac-repair", label: "AC & Heating Repair", desc: "AC diagnosis, recharge, compressor repair" },
  { href: "/transmission", label: "Transmission Repair", desc: "Shifting problems, fluid service, diagnostics" },
  { href: "/electrical", label: "Electrical Repair", desc: "Wiring, sensors, modules diagnostics" },
  { href: "/battery", label: "Battery Service", desc: "Free testing, quality replacement with warranty" },
  { href: "/alignment", label: "Wheel Alignment Cleveland", desc: "Precision wheel alignment — fix pulling and uneven tire wear" },
  { href: "/exhaust", label: "Muffler Shop Near Me", desc: "Muffler, catalytic converter, exhaust repair" },
  { href: "/cooling", label: "Cooling System", desc: "Radiator, thermostat, water pump service" },
  { href: "/starter-alternator", label: "Starter & Alternator", desc: "Car won't start? We diagnose and fix it" },
  { href: "/belts-hoses", label: "Belts & Hoses", desc: "Timing belt, serpentine belt replacement" },
  { href: "/pre-purchase-inspection", label: "Pre-Purchase Inspection", desc: "Know what you're buying before you sign" },
  // Tools & resources
  { href: "/diagnose", label: "Diagnose My Car", desc: "AI-powered symptom analysis" },
  { href: "/pricing", label: "Price Estimator", desc: "Get an instant repair cost estimate" },
  { href: "/services", label: "All Services", desc: "Complete list of everything we do" },
  { href: "/specials", label: "Specials & Coupons", desc: "Current deals and discounts" },
  { href: "/reviews", label: "Customer Reviews", desc: `4.9 stars from ${BUSINESS.reviews.countDisplay} reviews` },
  { href: "/blog", label: "Repair Tips Blog", desc: "Expert car care advice" },
  { href: "/guides", label: "Auto Repair Guides", desc: "In-depth guides from Cleveland mechanics" },
  { href: "/guides/how-to-read-tire-size", label: "How to Read Tire Size", desc: "Complete guide to tire size markings" },
  { href: "/guides/when-to-replace-tires", label: "When to Replace Tires", desc: "Tread depth, age, and warning signs" },
  { href: "/guides/new-vs-used-tires-cleveland", label: "New vs Used Tires", desc: "Honest comparison for Cleveland drivers" },
  { href: "/guides/annual-car-maintenance-cost-guide", label: "Annual Maintenance Cost", desc: "What Cleveland drivers actually spend" },
  { href: "/faq", label: "FAQ", desc: "Common auto repair questions answered" },
  { href: "/contact", label: "Contact & Booking", desc: "Schedule your appointment today" },
  { href: "/booking", label: "Book Appointment", desc: "Online scheduling — walk-ins also welcome" },
  { href: "/fleet", label: "Fleet Accounts", desc: "Commercial vehicle maintenance" },
  { href: "/financing", label: "Financing Options", desc: "No credit check — 4 providers, apply in 2 min" },
  { href: "/rewards", label: "Rewards Program", desc: "Earn points on every service" },
  { href: "/car-care-guide", label: "Car Care Guide", desc: "Seasonal maintenance tips" },
  { href: "/about", label: "About Us", desc: "Cleveland's trusted shop since day one" },
  { href: "/careers", label: "Careers at Nick's", desc: "Join our team — mechanics and service advisors" },
  // City pages for local SEO
  { href: "/cleveland-auto-repair", label: "Cleveland Auto Repair", desc: "Serving Cleveland drivers 7 days a week" },
  { href: "/euclid-auto-repair", label: "Euclid Auto Repair", desc: "Your neighborhood auto shop on Euclid Ave" },
  { href: "/lakewood-auto-repair", label: "Lakewood Auto Repair", desc: "Lakewood's trusted tire and repair shop" },
  { href: "/parma-auto-repair", label: "Parma Auto Repair", desc: "Serving Parma with honest auto repair" },
  { href: "/shaker-heights-auto-repair", label: "Shaker Heights Auto Repair", desc: "Quality service for Shaker Heights vehicles" },
  { href: "/cleveland-heights-auto-repair", label: "Cleveland Heights Repair", desc: "Trusted by Cleveland Heights drivers" },
  { href: "/mentor-auto-repair", label: "Mentor Auto Repair", desc: "Mentor's go-to for tires and repair" },
  // Hub pages
  { href: "/areas-served", label: "All Areas Served", desc: "150+ locations across Northeast Ohio" },
];

interface Props {
  title?: string;
  maxLinks?: number;
  exclude?: string[];
}

export default function InternalLinks({ title = "Explore More Services", maxLinks = 12, exclude = [] }: Props) {
  // Safe for SSR/prerender: always attempt to read pathname, fallback to "/"
  let currentPath = "/";
  try {
    if (typeof window !== "undefined" && window.location?.pathname) {
      currentPath = window.location.pathname;
    }
  } catch {
    // SSR or prerender environment — use fallback
  }

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
        <h3 className="text-xs font-semibold text-foreground/60 uppercase tracking-widest mb-8">
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
                <p className="text-xs text-foreground/70 mt-0.5 truncate">{link.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-primary shrink-0 ml-3 transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
