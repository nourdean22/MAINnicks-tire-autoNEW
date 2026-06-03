/**
 * /womens-safety — Women's Safety & Pit Stop Experience page
 * Addresses safety concerns for women getting car service in Cleveland.
 * Highlights the "stay in your car" tire-install model + drop-off-and-go for repairs vs. traditional shops that hold your car hostage in a lobby.
 */

import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import UberDropoffWidget from "@/components/UberDropoffWidget";
import { Shield, X, Check } from "lucide-react";

/* ─── COMPARISON DATA ──────────────────────────────────── */

const OLD_WAY = [
  "Forced to hand over your keys and sit in a lobby for hours",
  "Pressure to approve repairs on the spot",
  "No way to verify what's actually being done",
  "Stuck without transportation for hours",
  "Uncomfortable environment, no privacy",
  "Hard to leave if you feel unsafe",
];

const PIT_STOP_WAY = [
  "Sit in your car while we do your tire — the crew works outside",
  "Drop off and go — Uber code provided on request",
  "Every repair explained before work begins, no pressure",
  "Photo and video updates sent directly to your phone",
  "We text you the moment your car is ready",
  "Clean, well-lit shop with staff introductions",
  "You're never trapped — leave any time, no questions asked",
];

/* ─── COMPARISON GRID ──────────────────────────────────── */

function ComparisonGrid() {
  return (
    <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
      {/* Left — The Old Way */}
      <div className="bg-secondary rounded-2xl p-6 sm:p-8">
        <h3 className="text-red-400 font-black text-xl uppercase tracking-tight mb-5">
          The Old Way
        </h3>
        <ul className="space-y-3">
          {OLD_WAY.map((item) => (
            <li key={item} className="flex items-start gap-3 text-foreground/80 text-sm leading-relaxed">
              <X className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Right — The Pit Stop Way */}
      <div className="bg-secondary border-2 border-primary rounded-2xl p-6 sm:p-8">
        <h3 className="text-primary font-black text-xl uppercase tracking-tight mb-5">
          The Pit Stop Way
        </h3>
        <ul className="space-y-3">
          {PIT_STOP_WAY.map((item) => (
            <li key={item} className="flex items-start gap-3 text-gray-100 text-sm leading-relaxed">
              <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ─────────────────────────────────────────── */

export default function WomensSafetyPage() {
  return (
    <PageLayout>
      <SEOHead
        title="Women's Safety at Nick's Tire & Auto · Cleveland | Stay In Your Car"
        description="Stay in your car or drop off and Uber out. Nick's Cleveland — no pressure, no pushy mechanics. Free check. Written quote. You don't pay until you say yes. Walk-ins 7 days."
        canonicalPath="/womens-safety"
      />
      {/* v1.7 SEO · BreadcrumbList */}
      <Breadcrumbs items={[{ label: "Women's Safety" }]} />

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="bg-card pt-24 pb-16 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          {/* Shield badge */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-primary/10 border border-primary/30 rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-primary" />
            </div>
          </div>

          <h1 className="text-primary font-black text-4xl sm:text-5xl lg:text-6xl uppercase tracking-tight leading-none mb-4">
            STAY IN YOUR SEAT.
          </h1>

          <p className="text-foreground text-xl sm:text-2xl font-semibold mb-4">
            The safest way to get your car fixed in Cleveland.
          </p>

          <p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            You should never feel uncomfortable getting your car serviced. At Nick's,
            you're in control — stay in your car, drop off and Uber out, or wait in
            a clean, welcoming space. Your call, every time.
          </p>
          <p className="text-foreground/80 text-base sm:text-lg leading-relaxed max-w-xl mx-auto mt-6">
            Free check. Written quote. <span className="text-primary font-semibold">You don't pay until you say yes.</span>
          </p>
        </div>
      </section>

      {/* ── Comparison Grid ──────────────────────────────── */}
      <section className="bg-card py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-foreground font-black text-2xl sm:text-3xl uppercase tracking-tight text-center mb-10">
            Why It's Different Here
          </h2>
          <ComparisonGrid />
        </div>
      </section>

      {/* ── Uber Drop-off Widget ─────────────────────────── */}
      <section className="bg-card py-16 px-4">
        <div className="max-w-lg mx-auto">
          <h2 className="text-foreground font-black text-2xl sm:text-3xl uppercase tracking-tight text-center mb-8">
            Ready to Drop Off?
          </h2>
          <UberDropoffWidget />
        </div>
      </section>

      {/* ── Trust Footer Strip ───────────────────────────── */}
      <section className="bg-card border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Nick's Tire & Auto has served Cleveland since 2018. We're a
            family-run shop that believes every customer — regardless of gender —
            deserves honest, transparent, pressure-free service. If you ever feel
            uncomfortable, tell us. We'll make it right.
          </p>
          <p className="text-primary font-semibold text-sm mt-4">
            📍 Cleveland, OH &nbsp;·&nbsp; Open 7 Days &nbsp;·&nbsp; 1,700+ Five-Star Reviews
          </p>
        </div>
      </section>
    </PageLayout>
  );
}
