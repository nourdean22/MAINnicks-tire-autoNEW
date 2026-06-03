/**
 * /life · v10.0.529.51 · Wave 6 hub page
 *
 * Closes the audit finding: "Converge /mastery /learn /body /financial
 * /knowledge into a single 'Life' hub page that links them as cards.
 * All five are lifestyle-tracking surfaces with zero component-inbound
 * links, which means users can't discover them. One linked hub solves
 * all five at once."
 *
 * The hub is intentionally minimal:
 *   · 5 cards · one per destination
 *   · each card states the destination's actual top-1-line job
 *   · operator-style copy · lowercase · mono labels · gold-on-hover
 *   · no data fetching · pure-static · zero render cost
 *
 * Skills applied:
 *   · frontend-design (DFII · editorial-minimalist · ONE direction)
 *   · senior-frontend (Next.js Link · semantic nav)
 *   · baseline-ui (typography scale · lowercase · tabular)
 *   · fixing-accessibility (focus-visible · keyboard-navigable cards)
 *   · ELON delete-first (hub is a router · not a dashboard with
 *     20 widgets · those live on the destinations)
 */

import Link from "next/link";
import { Target, BookOpen, Activity, DollarSign, Library } from "lucide-react";
import { StandardPage } from "@/components/layout/standard-page";

interface HubItem {
  href: string;
  label: string;
  blurb: string;
  icon: typeof Target;
}

const ITEMS: HubItem[] = [
  {
    href: "/stats",
    label: "mastery",
    blurb: "8-axis growth radar · goals · domain evidence",
    icon: Target,
  },
  {
    href: "/body",
    label: "body",
    blurb: "weight · sleep · energy · the daily log",
    icon: Activity,
  },
  {
    href: "/business?tab=money",
    label: "financial",
    blurb: "net worth · revenue target · monthly snapshot",
    icon: DollarSign,
  },
  {
    href: "/knowledge",
    label: "knowledge",
    blurb: "curated knowledge base · categories · search",
    icon: Library,
  },
  {
    href: "/learn",
    label: "learn",
    blurb: "build-your-own-X tutorial catalog · Nick tool companion",
    icon: BookOpen,
  },
];

export default function LifePage() {
  return (
    <StandardPage
      eyebrow="Mastery"
      title="life"
      description="five surfaces · pick where to land"
    >
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" aria-label="Life surfaces">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group block rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] px-3 py-3 transition-colors hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.04] focus-visible:outline-none focus-visible:border-[var(--gold)]/60 focus-visible:bg-[var(--gold)]/[0.06]"
              >
                <div className="flex items-center gap-2">
                  <Icon
                    size={14}
                    strokeWidth={1.75}
                    className="text-[var(--text-tertiary)] group-hover:text-[var(--gold)] transition-colors"
                  />
                  <span className="text-[11px] font-mono lowercase tracking-[0.18em] text-[var(--text-primary)] group-hover:text-[var(--gold)] transition-colors">
                    {item.label}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                  {item.blurb}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] italic text-[var(--text-tertiary)] border-t border-[var(--border-default)]/30 pt-3">
        each card links to its full dashboard · the hub stays a router · the
        dashboards keep their depth
      </p>
    </StandardPage>
  );
}
