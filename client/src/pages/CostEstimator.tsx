/**
 * Cost Estimator Page (Feature 3)
 * Real-time repair cost estimates based on vehicle and service selection
 */

import { useState, useMemo } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import PageLayout from "@/components/PageLayout";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import InternalLinks from "@/components/InternalLinks";
import { BUSINESS } from "@shared/business";
import { SERVICE_TYPES, SERVICE_CATEGORIES } from "@shared/serviceTypes";
import { trpc } from "@/lib/trpc";
import { motion } from "framer-motion";
import {
  DollarSign,
  Search,
  CheckCircle2,
  AlertCircle,
  Phone,
  Wrench,
  Clock,
  Shield,
  ChevronDown,
  Loader,
} from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 38 }, (_, i) => String(CURRENT_YEAR - i));

const MAKES = [
  "Acura",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ford",
  "GMC",
  "Honda",
  "Hyundai",
  "Infiniti",
  "Jeep",
  "Kia",
  "Lexus",
  "Lincoln",
  "Mazda",
  "Mercedes-Benz",
  "Mitsubishi",
  "Nissan",
  "Ram",
  "Subaru",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
  "Other",
];

const FAQ_ITEMS = [
  {
    question: "Why do repair costs vary so much?",
    answer:
      "Labor rates differ by shop, vehicle complexity, and the condition of surrounding parts. We use Cleveland-area rates at our facility.",
  },
  {
    question: "What's included in the estimate?",
    answer:
      "Parts and labor at our standard rates. Actual price may vary if additional repairs are needed after inspection.",
  },
  {
    question: "How accurate are these estimates?",
    answer:
      "Our estimates are based on typical Cleveland-market pricing. An in-shop inspection may reveal additional needed work.",
  },
  {
    question: "Can you match competitor pricing?",
    answer:
      "We focus on honest, transparent pricing. Bring us a quote and we'll discuss fair alternatives.",
  },
  {
    question: "Do you offer payment plans?",
    answer:
      "Yes—Synchrony Car Care (6 months 0% on $199+) and Sunbit (up to 72 months). Ask at the counter.",
  },
  {
    question: "What if I need emergency service?",
    answer:
      "Same-day emergency repairs available. Call (216) 862-0005 to confirm availability before arriving.",
  },
  {
    question: "Can you estimate without the exact year?",
    answer:
      "Better estimates with exact year/make/model, but we can give a ballpark for vehicle types.",
  },
  {
    question: "Do you work on imports?",
    answer:
      "Absolutely—we service most brands including BMW, Audi, Lexus, Subaru, Honda, and more.",
  },
];

export default function CostEstimator() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const estimate = trpc.costEstimator.estimate.useMutation();

  // Group services by category
  const groupedServices = useMemo(() => {
    const groups: Record<string, typeof SERVICE_TYPES> = {};
    SERVICE_CATEGORIES.forEach((cat) => {
      groups[cat] = SERVICE_TYPES.filter((s) => s.category === cat);
    });
    return groups;
  }, []);

  // Filter services by search
  const filteredServices = useMemo(() => {
    if (!searchTerm) return groupedServices;
    const lower = searchTerm.toLowerCase();
    const result: Record<string, typeof SERVICE_TYPES> = {};
    Object.entries(groupedServices).forEach(([category, services]) => {
      const filtered = services.filter((s) =>
        s.name.toLowerCase().includes(lower)
      );
      if (filtered.length > 0) {
        result[category] = filtered;
      }
    });
    return result;
  }, [searchTerm, groupedServices]);

  const selectedService = SERVICE_TYPES.find((s) => s.id === serviceId);

  const handleEstimate = async () => {
    if (!year || !make || !model || !serviceId) return;

    const service = SERVICE_TYPES.find((s) => s.id === serviceId);
    if (!service) return;

    try {
      await estimate.mutateAsync({
        year: parseInt(year, 10),
        make,
        model,
        serviceType: service.name,
      });
      setShowResult(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      console.error("Estimate failed:", e);
    }
  };

  const handleReset = () => {
    setYear("");
    setMake("");
    setModel("");
    setServiceId("");
    setShowResult(false);
    setSearchTerm("");
  };

  const vehicleLabel = year && make && model ? `${year} ${make} ${model}` : "";
  const vehicleComplete = year && make && model;
  const ready = vehicleComplete && serviceId;

  return (
    <PageLayout activeHref="/cost-estimator">
      <SEOHead
        title="Auto Repair Cost Estimator | Cleveland Repair Prices"
        description="Get instant repair cost estimates for your vehicle. Brake repair, tires, diagnostics, and more. Transparent pricing from Nick's Tire & Auto in Cleveland, OH."
        canonicalPath="/cost-estimator"
      />
      <Breadcrumbs
        items={[{ label: "Cost Estimator", href: "/cost-estimator" }]}
      />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="bg-[#0A0A0A] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-3xl text-center">
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-mono text-yellow-400 text-sm tracking-wide"
          >
            TRANSPARENT PRICING
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-bold text-4xl lg:text-5xl text-white mt-3 tracking-tight"
          >
            How Much Will My <span className="text-yellow-400">Repair Cost?</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-white/70 text-lg max-w-xl mx-auto"
          >
            Get a real estimate in 10 seconds. No hidden fees. Based on actual
            Cleveland-area shop rates.
          </motion.p>
        </div>
      </section>

      {/* Estimator Form */}
      <section className="bg-[#0A0A0A] py-12 lg:py-16">
        <div className="container max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/5 border border-white/10 rounded-2xl p-6 lg:p-8 space-y-8 backdrop-blur-sm"
          >
            {!showResult ? (
              <>
                {/* Vehicle Selection */}
                <div>
                  <label className="text-xs text-yellow-400/80 tracking-wide block mb-3 font-semibold">
                    STEP 1: YOUR VEHICLE
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Year */}
                    <div className="relative">
                      <select
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 appearance-none cursor-pointer hover:bg-white/15 hover:border-white/20 transition-all"
                      >
                        <option value="">Year</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-white/50 pointer-events-none" />
                    </div>

                    {/* Make */}
                    <div className="relative">
                      <select
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
                        disabled={!year}
                        className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 appearance-none cursor-pointer hover:bg-white/15 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Make</option>
                        {MAKES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-white/50 pointer-events-none" />
                    </div>

                    {/* Model */}
                    <div>
                      <input
                        type="text"
                        placeholder="Model"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={!make}
                        className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 hover:bg-white/15 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {vehicleComplete && (
                    <div className="mt-3 flex items-center gap-2 text-yellow-400/80 text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{vehicleLabel}</span>
                    </div>
                  )}
                </div>

                {/* Service Selection */}
                <div>
                  <label className="text-xs text-yellow-400/80 tracking-wide block mb-3 font-semibold">
                    STEP 2: WHAT SERVICE?
                  </label>

                  {/* Search */}
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-3.5 w-4 h-4 text-white/50" />
                    <input
                      type="text"
                      placeholder="Search services..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-lg bg-white/10 border border-white/10 text-white placeholder-white/50 hover:bg-white/15 hover:border-white/20 transition-all"
                    />
                  </div>

                  {/* Services by Category */}
                  <div className="space-y-4">
                    {Object.entries(filteredServices).map(
                      ([category, services]) => (
                        <div key={category}>
                          <h3 className="text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">
                            {category}
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {services.map((service) => (
                              <button
                                key={service.id}
                                type="button"
                                onClick={() => setServiceId(service.id)}
                                className={`px-4 py-3 rounded-lg border-2 text-left text-sm font-medium transition-all ${
                                  serviceId === service.id
                                    ? "bg-yellow-400/20 border-yellow-400 text-yellow-400"
                                    : "bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20"
                                }`}
                              >
                                {service.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {selectedService && (
                    <div className="mt-3 flex items-center gap-2 text-yellow-400/80 text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{selectedService.name}</span>
                    </div>
                  )}
                </div>

                {/* CTA */}
                <button
                  onClick={handleEstimate}
                  disabled={!ready || estimate.isPending}
                  className="w-full py-4 rounded-lg bg-yellow-400 text-black font-bold text-lg hover:bg-yellow-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {estimate.isPending ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Calculating...
                    </>
                  ) : (
                    <>
                      <DollarSign className="w-5 h-5" />
                      Get My Estimate
                    </>
                  )}
                </button>
              </>
            ) : estimate.isSuccess && estimate.data ? (
              <>
                {/* Result */}
                <div className="text-center space-y-6">
                  <div>
                    <p className="text-white/70 text-sm mb-2">
                      Estimated total for {vehicleLabel}
                    </p>
                    <p className="text-5xl lg:text-6xl font-bold text-yellow-400">
                      ${estimate.data.totalLow} – ${estimate.data.totalHigh}
                    </p>
                  </div>

                  {/* Breakdown */}
                  <div className="bg-white/5 border border-white/10 rounded-lg p-6 space-y-3 text-left">
                    <h3 className="font-semibold text-white mb-4">Breakdown</h3>

                    <div className="flex justify-between items-center text-sm">
                      <span className="text-white/70">Labor:</span>
                      <span className="text-white font-medium">
                        {estimate.data.laborHoursLow}–
                        {estimate.data.laborHoursHigh} hours ×{" "}
                        ${estimate.data.laborRate}/hr
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-sm">
                      <span className="text-white/70">Labor cost:</span>
                      <span className="text-white font-medium">
                        ${estimate.data.laborCostLow} – ${estimate.data.laborCostHigh}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-sm">
                      <span className="text-white/70">Parts:</span>
                      <span className="text-white font-medium">
                        ${estimate.data.partsLow} – ${estimate.data.partsHigh}
                      </span>
                    </div>

                    <div className="border-t border-white/10 pt-3 mt-3 flex justify-between items-center">
                      <span className="font-semibold text-white">Total:</span>
                      <span className="text-yellow-400 font-bold text-lg">
                        ${estimate.data.totalLow} – ${estimate.data.totalHigh}
                      </span>
                    </div>
                  </div>

                  {/* Confidence */}
                  <div className="flex items-center justify-center gap-2">
                    {estimate.data.confidence === "high" && (
                      <div className="flex items-center gap-2 text-green-400">
                        <Shield className="w-5 h-5" />
                        <span className="text-sm font-medium">High Confidence</span>
                      </div>
                    )}
                    {estimate.data.confidence === "medium" && (
                      <div className="flex items-center gap-2 text-yellow-400">
                        <AlertCircle className="w-5 h-5" />
                        <span className="text-sm font-medium">Medium Confidence</span>
                      </div>
                    )}
                    {estimate.data.confidence === "low" && (
                      <div className="flex items-center gap-2 text-orange-400">
                        <AlertCircle className="w-5 h-5" />
                        <span className="text-sm font-medium">In-Shop Estimate Recommended</span>
                      </div>
                    )}
                  </div>

                  {/* Disclaimer */}
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-xs text-white/70 text-left">
                    {estimate.data.disclaimer}
                  </div>

                  {/* CTAs */}
                  <div className="space-y-3 pt-4">
                    <Link href="/book">
                      <button className="w-full py-4 rounded-lg bg-yellow-400 text-black font-bold hover:bg-yellow-300 transition-all">
                        Lock In This Price — Book Now
                      </button>
                    </Link>

                    <a href={`tel:${BUSINESS.phone.href}`}>
                      <button className="w-full py-3 rounded-lg border-2 border-yellow-400 text-yellow-400 font-semibold hover:bg-yellow-400/10 transition-all flex items-center justify-center gap-2">
                        <Phone className="w-4 h-4" />
                        Call for Exact Quote: {BUSINESS.phone.display}
                      </button>
                    </a>
                  </div>

                  <button
                    onClick={handleReset}
                    className="w-full py-2 text-white/70 hover:text-white transition-all text-sm"
                  >
                    Get Another Estimate
                  </button>
                </div>
              </>
            ) : estimate.isError ? (
              <div className="text-center space-y-4">
                <AlertCircle className="w-12 h-12 text-orange-400 mx-auto" />
                <p className="text-white">
                  Unable to calculate estimate. Please try again or call us for a
                  quote.
                </p>
                <button
                  onClick={handleReset}
                  className="py-2 px-4 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all"
                >
                  Try Again
                </button>
              </div>
            ) : null}
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-[#0A0A0A] py-16 lg:py-20 border-t border-white/10">
        <div className="container max-w-3xl">
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-12 text-center">
            Common Questions About Repair Costs
          </h2>

          <div className="space-y-4">
            {FAQ_ITEMS.map((item, idx) => (
              <motion.details
                key={idx}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, amount: 0.1 }}
                className="group bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 transition-all"
              >
                <summary className="cursor-pointer p-5 lg:p-6 flex items-center justify-between">
                  <span className="text-white font-semibold text-left">
                    {item.question}
                  </span>
                  <ChevronDown className="w-5 h-5 text-yellow-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="px-5 lg:px-6 pb-5 lg:pb-6 text-white/70 border-t border-white/10">
                  {item.answer}
                </div>
              </motion.details>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="bg-[#0A0A0A] py-16 lg:py-20 border-t border-white/10">
        <div className="container max-w-3xl">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="space-y-2"
            >
              <div className="text-3xl font-bold text-yellow-400">
                {BUSINESS.reviews.countDisplay}
              </div>
              <p className="text-white/70">Google Reviews</p>
              <p className="text-2xl font-bold text-white">4.9★</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="space-y-2"
            >
              <Wrench className="w-10 h-10 mx-auto text-yellow-400" />
              <p className="text-white font-semibold">No Surprise Fees</p>
              <p className="text-white/70">What we quote is what you pay</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="space-y-2"
            >
              <Clock className="w-10 h-10 mx-auto text-yellow-400" />
              <p className="text-white font-semibold">Same-Day Service</p>
              <p className="text-white/70">Most repairs completed today</p>
            </motion.div>
          </div>
        </div>
      </section>

      <InternalLinks />
    </PageLayout>
  );
}
