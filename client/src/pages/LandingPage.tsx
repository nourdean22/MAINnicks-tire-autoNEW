/**
 * Landing Pages (Feature 4)
 * High-conversion ad landing pages for specific services
 * Routes: /lp/brakes, /lp/tires, /lp/diagnostics, /lp/emergency
 * No navigation, no footer — conversion-only design
 */

import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { SEOHead } from "@/components/SEO";
import { getUtmData } from "@/lib/utm";
import { BUSINESS } from "@shared/business";
import { motion } from "framer-motion";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import InternalLinks from "@/components/InternalLinks";
import {
  Phone,
  CheckCircle,
  Star,
  Quote,
  AlertCircle,
  Loader,
  ChevronRight,
} from "lucide-react";

interface LandingVariant {
  headline: string;
  subline: string;
  offer: string;
  price: string;
  offerBadgeColor: string;
  trustBullets: string[];
  reviews: Array<{
    text: string;
    author: string;
    service: string;
  }>;
  urgencyMessage: string;
}

const VARIANTS: Record<string, LandingVariant> = {
  brakes: {
    headline: "BRAKE REPAIR — SAME DAY SERVICE",
    subline: "Safe, reliable braking for Cleveland drivers",
    offer: "FREE Brake Inspection",
    price: "from $149/axle",
    offerBadgeColor: "bg-red-500",
    trustBullets: [
      "Free brake inspection with every visit",
      "OEM and quality aftermarket pads available",
      "Most repairs done same day",
      "Warranty on parts and labor",
    ],
    reviews: [
      {
        text: "Nick's team found a brake issue I didn't know about. Fixed it right and the price was fair.",
        author: "Michael T.",
        service: "Brake Inspection",
      },
      {
        text: "Great service on our family's brakes. Professional and quick.",
        author: "Jennifer K.",
        service: "Full Brake Job",
      },
      {
        text: "Five stars. They explained what needed fixing and didn't push extra work.",
        author: "David L.",
        service: "Brake Pads",
      },
    ],
    urgencyMessage: "Same-Day Service • Walk-Ins Welcome",
  },
  tires: {
    headline: "NEW TIRES — INSTALLED TODAY",
    subline: "Quality tires for Cleveland roads and weather",
    offer: "FREE Tire Price Match",
    price: "from $89/each installed",
    offerBadgeColor: "bg-blue-500",
    trustBullets: [
      "Free tire price match on competitor quotes",
      "Tire rotation included with purchase",
      "Free balancing and mounting",
      "Same-day installation on stock",
    ],
    reviews: [
      {
        text: "Best tire deal in Cleveland. They beat other shops on price and service.",
        author: "Robert H.",
        service: "New Tires",
      },
      {
        text: "Quick, professional tire install. No upsell, just honest service.",
        author: "Sarah M.",
        service: "Tire Mount & Balance",
      },
      {
        text: "Love that they matched Costco's price. Made the decision easy.",
        author: "Chris P.",
        service: "Tire Purchase",
      },
    ],
    urgencyMessage: "Same-Day Service • Walk-Ins Welcome",
  },
  diagnostics: {
    headline: "CHECK ENGINE LIGHT ON?",
    subline: "Fast, accurate diagnostics to fix the real problem",
    offer: "Full Diagnostic Scan — $49",
    price: "from $49",
    offerBadgeColor: "bg-yellow-500",
    trustBullets: [
      "Computer diagnostic scan identifies the exact code",
      "Expert explanation of what it means",
      "Honest recommendation for repair",
      "$49 credit toward service if you book with us",
    ],
    reviews: [
      {
        text: "Diagnosed my check engine light in minutes. Turned out to be something simple. Great value.",
        author: "Tom B.",
        service: "Check Engine Diagnostic",
      },
      {
        text: "They explained the diagnostic clearly and didn't pressure me into expensive repairs.",
        author: "Lisa W.",
        service: "Emissions Scan",
      },
      {
        text: "Quick diagnostic service. Knew what the problem was before I left.",
        author: "Mark G.",
        service: "Check Engine Light",
      },
    ],
    urgencyMessage: "Walk-Ins Welcome • Same-Day Results",
  },
  emergency: {
    headline: "NEED A MECHANIC NOW?",
    subline: "Emergency auto repair for Cleveland drivers",
    offer: "Same-Day Emergency Service",
    price: "Call for quote",
    offerBadgeColor: "bg-orange-500",
    trustBullets: [
      "Quick diagnosis to get you back on the road",
      "Emergency service available during business hours",
      "Honest assessment of what can wait vs. urgent",
      "Most common emergencies fixed same day",
    ],
    reviews: [
      {
        text: "Had a breakdown on the way to work. Nick's got me fixed in 2 hours. Lifesaver.",
        author: "James D.",
        service: "Emergency Repair",
      },
      {
        text: "Thought my car was done for. They brought it back to life for a reasonable price.",
        author: "Amanda R.",
        service: "Roadside Repair",
      },
      {
        text: "Professional emergency service. No panic, no overcharge. Highly recommend.",
        author: "Kevin S.",
        service: "Tow & Repair",
      },
    ],
    urgencyMessage: "Call (216) 862-0005 • Available Now",
  },
};

export default function LandingPage() {
  const location = useLocation();
  const pathname = location[0];

  // Extract service from URL: /lp/brakes → brakes
  const service = pathname.split("/").pop() || "brakes";
  const variant = VARIANTS[service] || VARIANTS.brakes;

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    vehicle: "",
    problem: "",
  });

  const leadMutation = trpc.lead.submit.useMutation();

  const handleFormChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const utm = getUtmData();

    try {
      await leadMutation.mutateAsync({
        name: formData.name,
        phone: formData.phone,
        vehicle: formData.vehicle,
        problem: formData.problem,
        source: "manual",
        utmSource: utm.utmSource,
        utmMedium: utm.utmMedium,
        utmCampaign: utm.utmCampaign,
        landingPage: pathname,
      });

      // Show success state and redirect to booking after delay
      setTimeout(() => {
        window.location.href = "/booking?submitted=true";
      }, 1000);
    } catch (e) {
      console.error("Lead submission failed:", e);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0A] text-white">
      <SEOHead
        title={`${variant.headline} | Nick's Tire & Auto Cleveland`}
        description={`${variant.subline}. ${variant.offer}. Call (216) 862-0005 for same-day service.`}
        canonicalPath={`/lp/${service}`}
        robots="noindex, nofollow"
      />
      <LocalBusinessSchema />
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0A0A0A]/95 backdrop-blur-sm">
        <div className="container flex items-center justify-between h-16">
          <div className="font-bold text-lg">Nick's Tire & Auto</div>
          <a
            href={BUSINESS.phone.href}
            className="flex items-center gap-2 text-yellow-400 font-semibold hover:text-yellow-300 transition-colors"
          >
            <Phone className="w-4 h-4" />
            {BUSINESS.phone.display}
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-white/5 to-transparent py-12 lg:py-16">
        <div className="container max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-4"
          >
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight">
              {variant.headline}
            </h1>
            <p className="text-lg text-white/70">{variant.subline}</p>
            <div className="flex items-center justify-center gap-3 text-sm">
              <span className="flex items-center gap-1">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                {BUSINESS.reviews.rating}★
              </span>
              <span className="text-white/60">
                ({BUSINESS.reviews.countDisplay} Google Reviews)
              </span>
            </div>

            {/* Offer Badge */}
            <div className={`inline-block ${variant.offerBadgeColor} text-white px-4 py-2 rounded-full font-bold text-sm`}>
              {variant.offer}
            </div>

            <div className="text-3xl lg:text-4xl font-bold text-yellow-400">
              {variant.price}
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA Bar */}
      <section className="bg-white/5 border-y border-white/10 py-4 sticky top-16 z-30">
        <div className="container flex gap-3 flex-col sm:flex-row">
          <a
            href={BUSINESS.phone.href}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Phone className="w-5 h-5" />
            CALL NOW: {BUSINESS.phone.display}
          </a>
          <button className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
            BOOK ONLINE
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* Trust Bullets */}
      <section className="py-12 lg:py-16">
        <div className="container max-w-2xl">
          <div className="grid md:grid-cols-2 gap-4">
            {variant.trustBullets.map((bullet, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.1 }}
                className="flex gap-3"
              >
                <CheckCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-1" />
                <p className="text-white/80">{bullet}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-12 lg:py-16 border-t border-white/10">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white mb-2">What Customers Say</h2>
            <p className="text-white/60">
              {BUSINESS.reviews.rating}★ from {BUSINESS.reviews.countDisplay} Google Reviews
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {variant.reviews.map((review, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.1 }}
                className="bg-white/5 border border-white/10 rounded-lg p-5 space-y-3"
              >
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-4 h-4 fill-yellow-400 text-yellow-400"
                    />
                  ))}
                </div>
                <p className="text-white/80 italic">"{review.text}"</p>
                <div>
                  <p className="font-semibold text-white">{review.author}</p>
                  <p className="text-xs text-white/60">{review.service}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Urgency Banner */}
      <section className="bg-yellow-400/10 border-y border-yellow-400/20 py-6">
        <div className="container text-center">
          <p className="text-white font-semibold text-lg">
            {variant.urgencyMessage}
          </p>
        </div>
      </section>

      {/* Booking Form */}
      <section className="py-12 lg:py-16">
        <div className="container max-w-2xl">
          <h2 className="text-2xl font-bold text-center text-white mb-8">
            Get Started Today
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4 bg-white/5 border border-white/10 rounded-xl p-6 lg:p-8">
            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Name
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => handleFormChange("name", e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 hover:bg-white/15 hover:border-white/20 transition-all focus:outline-none focus:border-yellow-400"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Phone
              </label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => handleFormChange("phone", e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 hover:bg-white/15 hover:border-white/20 transition-all focus:outline-none focus:border-yellow-400"
                placeholder="(216) 555-1234"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Vehicle (optional)
              </label>
              <input
                type="text"
                value={formData.vehicle}
                onChange={(e) => handleFormChange("vehicle", e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 hover:bg-white/15 hover:border-white/20 transition-all focus:outline-none focus:border-yellow-400"
                placeholder="2020 Honda Civic"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                What's the issue? (optional)
              </label>
              <textarea
                value={formData.problem}
                onChange={(e) => handleFormChange("problem", e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 hover:bg-white/15 hover:border-white/20 transition-all focus:outline-none focus:border-yellow-400"
                placeholder="Describe the problem..."
                rows={3}
              />
            </div>

            <button
              type="submit"
              disabled={leadMutation.isPending}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {leadMutation.isPending ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  Send My Info
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>

            {leadMutation.isError && (
              <p className="text-orange-400 text-sm text-center">
                Error submitting form. Please call {BUSINESS.phone.display} instead.
              </p>
            )}
          </form>

          {leadMutation.isSuccess && (
            <div className="mt-6 bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-center text-green-400 font-semibold">
              Thanks! We'll contact you shortly.
            </div>
          )}
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-12 border-t border-white/10">
        <div className="container">
          <div className="flex flex-wrap items-center justify-center gap-6 text-center">
            <div>
              <p className="font-bold text-yellow-400 text-xl">
                {BUSINESS.reviews.rating}★
              </p>
              <p className="text-xs text-white/60">Google Rated</p>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <div>
              <p className="font-bold text-yellow-400 text-xl">
                {BUSINESS.reviews.countDisplay}+
              </p>
              <p className="text-xs text-white/60">Reviews</p>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <div>
              <p className="font-bold text-yellow-400 text-xl">Since 2005</p>
              <p className="text-xs text-white/60">Trusted Shop</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 lg:py-16 bg-gradient-to-t from-white/5 to-transparent border-t border-white/10">
        <div className="container max-w-2xl text-center space-y-6">
          <h2 className="text-3xl font-bold text-white">Ready to Get Fixed?</h2>
          <div className="space-y-3">
            <a
              href={BUSINESS.phone.href}
              className="block bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-lg transition-colors"
            >
              Call Now: {BUSINESS.phone.display}
            </a>
            <button className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-4 rounded-lg transition-colors">
              Book Online Appointment
            </button>
          </div>
        </div>
      </section>

      <InternalLinks />

      {/* Tiny Footer */}
      <footer className="border-t border-white/10 py-4 text-center text-xs text-white/60">
        <p>
          {BUSINESS.address.full} • {BUSINESS.phone.display}
        </p>
      </footer>
    </div>
  );
}
