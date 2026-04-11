/**
 * /womens-safety — Women's Safety & Pit Stop Experience page
 * Addresses safety concerns for women getting car service in Cleveland.
 * Highlights the "stay in your car" drop-off model vs. traditional waiting rooms.
 */

import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import UberDropoffWidget from "@/components/UberDropoffWidget";
import { Shield, X, Check } from "lucide-react";

/* ─── COMPARISON DATA ──────────────────────────────────── */

const OLD_WAY = [
  "Sit alone in a waiting room with strangers",
  "Pressure to approve repairs on the spot",
  "No way to verify what's actually being done",
  "Stuck without transportation for hours",
  "Uncomfortable environment, no privacy",
  "Hard to leave if you feel unsafe",
];

const PIT_STOP_WAY = [
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
      <div className="bg-gray-800 rounded-2xl p-6 sm:p-8">
        <h3 className="text-red-400 font-black text-xl uppercase tracking-tight mb-5">
          The Old Way
        </h3>
        <ul className="space-y-3">
          {OLD_WAY.map((item) => (
            <li key={item} className="flex items-start gap-3 text-gray-300 text-sm leading-relaxed">
              <X className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Right — The Pit Stop Way */}
      <div className="bg-gray-800 border-2 border-yellow-400 rounded-2xl p-6 sm:p-8">
        <h3 className="text-yellow-400 font-black text-xl uppercase tracking-tight mb-5">
          The Pit Stop Way
        </h3>
        <ul className="space-y-3">
          {PIT_STOP_WAY.map((item) => (
            <li key={item} className="flex items-start gap-3 text-gray-100 text-sm leading-relaxed">
              <Check className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
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
        title="Women's Safety at Nick's Tire & Auto | Cleveland's Safest Auto Shop"
        description="Stay in your car or drop off and go. Nick's Tire & Auto in Cleveland is built around your comfort and safety — no pressure, full transparency, Uber drop-off available."
        canonical="/womens-safety"
      />

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="bg-gray-900 pt-24 pb-16 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          {/* Shield badge */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-yellow-400/10 border border-yellow-400/30 rounded-full flex items-center justify-center">
              <Shield className="w-8 h-8 text-yellow-400" />
            </div>
          </div>

          <h1 className="text-yellow-400 font-black text-4xl sm:text-5xl lg:text-6xl uppercase tracking-tight leading-none mb-4">
            STAY IN YOUR SEAT.
          </h1>

          <p className="text-white text-xl sm:text-2xl font-semibold mb-4">
            The safest way to get your car fixed in Cleveland.
          </p>

          <p className="text-gray-400 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            You should never feel uncomfortable getting your car serviced. At Nick's,
            you're in control — stay in your car, drop off and Uber out, or wait in
            a clean, welcoming space. Your call, every time.
          </p>
        </div>
      </section>

      {/* ── Comparison Grid ──────────────────────────────── */}
      <section className="bg-gray-900 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-white font-black text-2xl sm:text-3xl uppercase tracking-tight text-center mb-10">
            Why It's Different Here
          </h2>
          <ComparisonGrid />
        </div>
      </section>

      {/* ── Uber Drop-off Widget ─────────────────────────── */}
      <section className="bg-gray-900 py-16 px-4">
        <div className="max-w-lg mx-auto">
          <h2 className="text-white font-black text-2xl sm:text-3xl uppercase tracking-tight text-center mb-8">
            Ready to Drop Off?
          </h2>
          <UberDropoffWidget />
        </div>
      </section>

      {/* ── Trust Footer Strip ───────────────────────────── */}
      <section className="bg-gray-900 border-t border-gray-800 py-12 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-gray-500 text-sm leading-relaxed">
            Nick's Tire & Auto has served Cleveland for over 20 years. We're a
            family-owned shop that believes every customer — regardless of gender —
            deserves honest, transparent, pressure-free service. If you ever feel
            uncomfortable, tell us. We'll make it right.
          </p>
          <p className="text-yellow-400 font-semibold text-sm mt-4">
            📍 Cleveland, OH &nbsp;·&nbsp; Open 7 Days &nbsp;·&nbsp; 1,688+ Five-Star Reviews
          </p>
        </div>
      </section>
    </PageLayout>
  );
}
