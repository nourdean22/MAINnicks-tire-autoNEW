/**
 * SiteMap — customer-facing site directory.
 *
 * Two purposes:
 *   1. USER: a single page where someone can find any page on the site.
 *      Better than a footer stuffed with 150 links.
 *   2. SEO: one page that internally links to every other page — Google
 *      crawlers discover the full site structure in one hop. Also creates
 *      a hub of link equity that flows back to deep pages.
 *
 * Sections:
 *   - Services (11 service pages + SEO landings)
 *   - Cities (20+ city landing pages)
 *   - Problems (symptom-based troubleshooting landings)
 *   - Blog posts (pulled live from trpc.content.blog.list — 12+ posts)
 *   - Customer tools (Booking, Estimator, Diagnose, Tracker)
 *   - Legal / About
 */

import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { CITIES } from "@shared/cities";
import { NEIGHBORHOODS } from "@shared/neighborhoods";
import { SERVICES } from "@shared/services";
import { GUIDES } from "@shared/guides";
import { ALL_ROUTES } from "@shared/routes";
import {
  Wrench, MapPin, AlertTriangle, BookOpen, PhoneCall, FileText,
  Gauge, Shield, Zap, DollarSign, Settings, Calendar,
} from "lucide-react";

interface LinkItem { label: string; href: string; note?: string; }

interface BlogSummary { slug: string; title: string; category?: string | null; }

const FEATURED_SERVICES: LinkItem[] = [
  { label: "Brake Repair", href: "/brakes", note: "From $149 per axle" },
  { label: "Synthetic Oil Change", href: "/synthetic-oil-change", note: "From $80" }, // keep in sync with OIL_PRICE
  { label: "Wheel Alignment", href: "/alignment" },
  { label: "Check Engine Light", href: "/diagnostics", note: "Free code scan" },
  { label: "Tires (New & Used)", href: "/tires", note: "Used from $25 (select 12-inch; most $40-80), new from $89" },
  { label: "Auto Repair (All Makes)", href: "/auto-repair-near-me" },
  { label: "Tire Shop Near Me", href: "/tire-shop-near-me" },
  { label: "Oil Change", href: "/oil-change", note: "From $49" }, // keep in sync with OIL_PRICE
  { label: "Emissions / E-Check", href: "/emissions" },
  { label: "AC Repair", href: "/ac-repair" },
  { label: "Transmission", href: "/transmission" },
  { label: "Battery Service", href: "/battery" },
  { label: "Electrical", href: "/electrical" },
  { label: "Exhaust", href: "/exhaust" },
  { label: "Cooling System", href: "/cooling" },
  { label: "Starter & Alternator", href: "/starter-alternator" },
  { label: "Belts & Hoses", href: "/belts-hoses" },
  { label: "Pre-Purchase Inspection", href: "/pre-purchase-inspection" },
  // 2026-10-07 · site crawl as Googlebot: these sitemap pages had no inbound
  // link from any page, so nothing but the sitemap file told Google they exist.
  { label: "Custom Wheels & OEM Rims", href: "/wheels" },
  { label: "Tire Rebates & Deals", href: "/tire-rebates" },
  { label: "Muffler Shop Open Sunday", href: "/muffler-shop-open-sunday-cleveland" },
];

/**
 * Tire-size landing pages, from the registry rather than a hand list: the
 * 2026-10-07 crawl found 11 of them with zero inbound links, and a list typed
 * here would drift the same way. Sitemap-only, like everything else on this page.
 */
const TIRE_SIZE_PAGES: LinkItem[] = ALL_ROUTES.filter((r) => r.group === "tire-size" && r.sitemap).map((r) => ({
  // "/tires/225-65r17" → "225/65R17"
  label: r.path.replace(/^\/tires\//, "").replace(/^(\d+)-(\d+)r(\d+)$/i, "$1/$2R$3"),
  href: r.path,
}));

const GUIDE_PAGES: LinkItem[] = GUIDES.map((g) => ({
  label: g.title.replace(/\s*\|\s*Nick's Tire & Auto\s*$/, ""),
  href: `/guides/${g.slug}`,
  note: g.category.replace(/-/g, " "),
}));

const PROBLEM_PAGES: LinkItem[] = [
  { label: "Brakes Grinding", href: "/brakes-grinding" },
  { label: "Car Shaking While Driving", href: "/car-shaking-while-driving" },
  { label: "Steering Wheel Shaking", href: "/steering-wheel-shaking" },
  { label: "Car Pulling to One Side", href: "/car-pulling-to-one-side" },
  { label: "Car Overheating", href: "/car-overheating" },
  { label: "Check Engine Light On", href: "/check-engine-light-on" },
  { label: "Check Engine Light Flashing", href: "/check-engine-light-flashing" },
  { label: "Car Won't Start", href: "/car-wont-start" },
  { label: "Grinding Noise When Braking", href: "/grinding-noise-when-braking" },
  { label: "Transmission Slipping", href: "/transmission-slipping" },
  { label: "AC Not Blowing Cold", href: "/ac-not-blowing-cold" },
  { label: "Battery Keeps Dying", href: "/battery-keeps-dying" },
  { label: "Oil Leak Under Car", href: "/oil-leak-under-car" },
];

const CUSTOMER_TOOLS: LinkItem[] = [
  { label: "Schedule Drop-Off", href: "/booking", note: "Fill out, we confirm by text" },
  { label: "AI Repair Estimator", href: "/estimate", note: "Describe the problem, get a cost range" },
  { label: "Diagnose My Car", href: "/diagnose", note: "AI symptom checker" },
  { label: "Cost Estimator", href: "/cost-estimator" },
  { label: "Track My Job", href: "/status", note: "See where your car is in service" },
  { label: "My Garage", href: "/my-garage", note: "Your service history" },
  { label: "Payment Programs", href: "/financing", note: "4 providers; each decides approval" },
  { label: "Rewards & Loyalty", href: "/rewards" },
  { label: "Leave a Review", href: "/reviews" },
  { label: "Request Callback", href: "/contact" },
];

const ABOUT_LEGAL: LinkItem[] = [
  { label: "About Nick's", href: "/about" },
  { label: "Reviews", href: "/reviews" },
  { label: "Blog & Guides", href: "/blog" },
  { label: "FAQ", href: "/faq" },
  { label: "Areas Served", href: "/areas-served" },
  { label: "Pricing Guide", href: "/pricing" },
  { label: "Specials", href: "/specials" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
  { label: "Formerly Moe's Tire Euclid", href: "/moes-tire-euclid" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms", href: "/terms" },
];

function Section({ icon, title, description, items }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  items: LinkItem[];
}) {
  return (
    <section className="mb-12">
      <div className="flex items-center gap-3 mb-2">
        <div className="text-primary">{icon}</div>
        <h2 className="font-bold text-2xl text-foreground tracking-tight uppercase">{title}</h2>
        <span className="text-[11px] text-foreground/40 font-mono">({items.length})</span>
      </div>
      <p className="text-foreground/60 text-sm mb-5 max-w-2xl">{description}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between gap-3 bg-card/40 border border-border/30 rounded px-4 py-2.5 hover:bg-card/70 hover:border-primary/30 transition-all group"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-foreground/90 group-hover:text-primary transition-colors truncate">
                {item.label}
              </div>
              {item.note && (
                <div className="text-[11px] text-foreground/50 truncate mt-0.5">{item.note}</div>
              )}
            </div>
            <span className="text-foreground/30 group-hover:text-primary transition-colors shrink-0">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function SiteMap() {
  // Pull live blog posts so the sitemap reflects current content.
  // Falls back to an empty array if the endpoint errors (page still renders).
  const { data: blogPosts } = trpc.content.publishedArticles.useQuery(undefined, {
    staleTime: 30 * 60 * 1000, // 30 min
    retry: 1,
  });

  const cityLinks: LinkItem[] = CITIES.map((c) => ({
    label: c.name,
    href: `/${c.slug}`,
    note: c.driveTime ? `${c.driveTime} away` : undefined,
  }));

  const neighborhoodLinks: LinkItem[] = NEIGHBORHOODS.slice(0, 20).map((n) => ({
    label: n.name,
    href: `/${n.slug}`,
  }));

  const blogLinks: LinkItem[] = (blogPosts as BlogSummary[] | undefined)?.map((p) => ({
    label: p.title,
    href: `/blog/${p.slug}`,
    note: p.category || undefined,
  })) || [];

  const totalPages =
    FEATURED_SERVICES.length + TIRE_SIZE_PAGES.length + PROBLEM_PAGES.length + cityLinks.length +
    neighborhoodLinks.length + GUIDE_PAGES.length + CUSTOMER_TOOLS.length + ABOUT_LEGAL.length +
    blogLinks.length + 1; // +1 for homepage

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Site Map | Nick's Tire & Auto — All Pages, Cleveland OH"
        description="Full directory of services, city pages, problem guides, blog posts, and customer tools on Nick's Tire & Auto. Find anything in one click."
        canonicalPath="/site-map"
      />

      <section className="pt-24 pb-12 bg-background">
        <div className="container max-w-6xl">
          <Breadcrumbs items={[{ label: "Site Map" }]} />

          <div className="mt-4">
            <h1 className="font-heading font-bold text-4xl sm:text-5xl uppercase text-foreground tracking-tight">
              Site Map
            </h1>
            <p className="text-foreground/60 mt-3 max-w-2xl">
              Every page on Nick&apos;s Tire &amp; Auto in one place. {totalPages} pages
              covering services, locations, repair guides, tools, and articles. Find
              what you need or call <a href="tel:+12168620005" className="text-primary hover:underline">(216) 862-0005</a>.
            </p>
          </div>

          <div className="mt-10">
            <Section
              icon={<Wrench className="w-5 h-5" />}
              title="Services"
              description="Everything we work on. Walk-ins welcome 7 days — most services done same day."
              items={FEATURED_SERVICES}
            />

            <Section
              icon={<Gauge className="w-5 h-5" />}
              title="Tires by Size"
              description="Installed-price pages for the sizes Cleveland drivers ask for most. Don't see yours? Every size is searchable on the Tires page."
              items={TIRE_SIZE_PAGES}
            />

            <Section
              icon={<MapPin className="w-5 h-5" />}
              title="Cleveland-Area Cities"
              description="City-specific auto repair information. We serve the whole Cleveland metro — from Euclid to Parma, Lakewood to Mentor."
              items={cityLinks}
            />

            {neighborhoodLinks.length > 0 && (
              <Section
                icon={<MapPin className="w-5 h-5" />}
                title="Neighborhoods"
                description="Hyperlocal pages for specific Cleveland neighborhoods. (Top 20 shown — see Areas Served for the full list.)"
                items={neighborhoodLinks}
              />
            )}

            <Section
              icon={<AlertTriangle className="w-5 h-5" />}
              title="Problem &amp; Symptom Guides"
              description="Deep-dives for common car problems. What&apos;s actually wrong, real fix costs, when it&apos;s urgent."
              items={PROBLEM_PAGES}
            />

            <Section
              icon={<BookOpen className="w-5 h-5" />}
              title="Car Care Guides"
              description="Long-form guides from our mechanics: tire sizes, maintenance intervals, E-Check, what things cost in Cleveland."
              items={GUIDE_PAGES}
            />

            {blogLinks.length > 0 && (
              <Section
                icon={<BookOpen className="w-5 h-5" />}
                title="Blog"
                description="Honest answers on maintenance, repairs, and cost expectations. No fluff."
                items={blogLinks}
              />
            )}

            <Section
              icon={<PhoneCall className="w-5 h-5" />}
              title="Customer Tools"
              description="Booking, estimating, symptom-check tools — everything you can do without picking up the phone."
              items={CUSTOMER_TOOLS}
            />

            <Section
              icon={<FileText className="w-5 h-5" />}
              title="About &amp; Company"
              description="Who we are, what we stand for, legal pages."
              items={ABOUT_LEGAL}
            />
          </div>
        </div>
      </section>
    </PageLayout>
  );
}

// Icon imports used (prevents tree-shaking warnings in dev):
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
void [Shield, Zap, DollarSign, Settings, Calendar];
