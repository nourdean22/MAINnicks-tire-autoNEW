import { useState, useMemo } from "react";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  DollarSign, Car, Wrench, Clock, Phone, AlertCircle, ChevronRight, Info,
} from "lucide-react";

const SERVICE_OPTIONS = [
  { value: "oil-change", label: "Oil Change (Conventional)" },
  { value: "oil-change-synthetic", label: "Oil Change (Full Synthetic)" },
  { value: "brake-pads-front", label: "Front Brake Pads" },
  { value: "brake-pads-rotors", label: "Brake Pads + Rotors (Per Axle)" },
  { value: "tire-mount-balance", label: "Tire Mount & Balance (Per Tire)" },
  { value: "tire-rotation", label: "Tire Rotation" },
  { value: "flat-repair", label: "Flat Tire Repair" },
  { value: "check-engine-diag", label: "Check Engine Light Diagnostics" },
  { value: "emissions-repair", label: "Emissions / E-Check Repair" },
  { value: "ac-recharge", label: "AC Recharge" },
  { value: "struts-pair", label: "Struts Replacement (Pair)" },
  { value: "alignment", label: "Wheel Alignment" },
];

const VEHICLE_CATEGORIES = [
  { value: "compact", label: "Compact Car", examples: "Civic, Corolla, Sentra" },
  { value: "midsize", label: "Midsize Sedan", examples: "Camry, Accord, Malibu" },
  { value: "full-size", label: "Full-Size Car", examples: "Impala, Charger, 300" },
  { value: "truck-suv", label: "Truck / SUV", examples: "F-150, Silverado, RAV4, Explorer" },
];

export default function PriceEstimator() {
  const [service, setService] = useState("");
  const [vehicleCategory, setVehicleCategory] = useState<"compact" | "midsize" | "full-size" | "truck-suv" | "">("");
  const [showResult, setShowResult] = useState(false);

  const estimateQuery = trpc.pricing.estimate.useQuery(
    { serviceType: service, vehicleCategory: vehicleCategory as any },
    { enabled: showResult && !!service && !!vehicleCategory }
  );

  const handleEstimate = () => {
    if (service && vehicleCategory) {
      setShowResult(true);
    }
  };

  const reset = () => {
    setService("");
    setVehicleCategory("");
    setShowResult(false);
  };

  const selectedService = SERVICE_OPTIONS.find(s => s.value === service);
  const selectedVehicle = VEHICLE_CATEGORIES.find(v => v.value === vehicleCategory);

  return (
    <PageLayout activeHref="/pricing">
      <SEOHead
        title="Price Estimator | Nick's Tire & Auto — Cleveland, OH"
        description="Get a ballpark estimate for common auto repairs. Oil changes, brakes, tires, diagnostics, and more. Honest pricing from Cleveland's trusted shop."
        canonicalPath="/pricing"
      />

      {/* Hero */}
      <section className="section-dark pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-3xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Transparent Pricing</span>
          <h1 className="font-heading font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight">
            INSTANT <span className="text-gradient-yellow">PRICE ESTIMATE</span>
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
            Select your service and vehicle type for a ballpark estimate. No surprises. No hidden fees.
          </p>
        </div>
      </section>

      {/* Estimator */}
      <section className="section-darker py-12 lg:py-16">
        <div className="container max-w-3xl">
          {!showResult ? (
            <div className="card-vibrant bg-card/80 rounded-lg p-6 lg:p-8 space-y-8">
              {/* Step 1: Service */}
              <div>
                <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-3">
                  1. What service do you need?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {SERVICE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setService(s.value)}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-md font-mono text-sm text-left transition-all ${
                        service === s.value
                          ? "border-nick-yellow bg-nick-yellow/10 text-nick-yellow ring-1 ring-nick-yellow/30"
                          : "border-border/50 text-foreground/70 hover:border-nick-teal/40 hover:text-nick-teal"
                      }`}
                    >
                      <Wrench className="w-4 h-4 shrink-0" />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 2: Vehicle */}
              {service && (
                <div>
                  <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-3">
                    2. What type of vehicle?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {VEHICLE_CATEGORIES.map((v) => (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => setVehicleCategory(v.value as any)}
                        className={`flex items-center gap-3 px-4 py-3.5 border rounded-md text-left transition-all ${
                          vehicleCategory === v.value
                            ? "border-nick-yellow bg-nick-yellow/10 text-nick-yellow ring-1 ring-nick-yellow/30"
                            : "border-border/50 text-foreground/70 hover:border-nick-teal/40 hover:text-nick-teal"
                        }`}
                      >
                        <Car className="w-4 h-4 shrink-0" />
                        <div>
                          <div className="font-mono text-sm font-semibold">{v.label}</div>
                          <div className="text-xs opacity-60">{v.examples}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Get Estimate Button */}
              {service && vehicleCategory && (
                <div className="text-center pt-2">
                  <button
                    onClick={handleEstimate}
                    className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow"
                  >
                    <DollarSign className="w-5 h-5" />
                    GET ESTIMATE
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Result */
            <div className="space-y-6">
              {estimateQuery.isLoading ? (
                <div className="text-center py-12">
                  <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-foreground/60 font-mono text-sm">Calculating estimate...</p>
                </div>
              ) : estimateQuery.data ? (
                <>
                  <div className="card-vibrant bg-card/80 rounded-lg p-6 lg:p-8">
                    <div className="text-center mb-6">
                      <span className="font-mono text-nick-teal text-xs tracking-widest uppercase">Estimated Cost</span>
                      <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-2">
                        {selectedService?.label}
                      </h2>
                      <p className="text-foreground/60 font-mono text-sm mt-1">
                        {selectedVehicle?.label} ({selectedVehicle?.examples})
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-4 py-8">
                      <div className="text-center">
                        <span className="font-mono text-foreground/40 text-xs uppercase block mb-1">From</span>
                        <span className="font-heading font-bold text-4xl lg:text-5xl text-nick-teal">
                          ${estimateQuery.data.lowEstimate}
                        </span>
                      </div>
                      <div className="text-foreground/20 text-2xl">—</div>
                      <div className="text-center">
                        <span className="font-mono text-foreground/40 text-xs uppercase block mb-1">Up To</span>
                        <span className="font-heading font-bold text-4xl lg:text-5xl text-nick-yellow">
                          ${estimateQuery.data.highEstimate}
                        </span>
                      </div>
                    </div>

                    {estimateQuery.data.typicalHours && (
                      <div className="flex items-center justify-center gap-2 text-foreground/60 font-mono text-sm mb-4">
                        <Clock className="w-4 h-4 text-nick-teal" />
                        Typical time: {estimateQuery.data.typicalHours} hours
                      </div>
                    )}

                    {estimateQuery.data.notes && (
                      <div className="flex items-start gap-2 bg-background/40 border border-border/30 rounded-md p-4 text-sm text-foreground/60">
                        <Info className="w-4 h-4 text-nick-teal shrink-0 mt-0.5" />
                        {estimateQuery.data.notes}
                      </div>
                    )}
                  </div>

                  {/* Disclaimer */}
                  <div className="flex items-start gap-3 bg-nick-yellow/5 border border-nick-yellow/20 rounded-md p-4">
                    <AlertCircle className="w-5 h-5 text-nick-yellow shrink-0 mt-0.5" />
                    <div className="text-sm text-foreground/70">
                      <p className="font-semibold text-foreground mb-1">This is a ballpark estimate only.</p>
                      <p>
                        Final pricing depends on your specific vehicle, the exact parts needed, and what our technicians find during inspection.
                        We always explain the diagnosis and get your approval before starting any work. No surprises.
                      </p>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <a
                      href="/book"
                      className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
                    >
                      BOOK THIS SERVICE
                    </a>
                    <a
                      href="tel:2168620005"
                      className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      CALL FOR EXACT QUOTE
                    </a>
                  </div>

                  <div className="text-center">
                    <button
                      onClick={reset}
                      className="text-nick-teal font-mono text-sm hover:underline"
                    >
                      ← Estimate another service
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 card-vibrant bg-card/80 rounded-lg p-8">
                  <AlertCircle className="w-12 h-12 text-nick-yellow/60 mx-auto mb-4" />
                  <h3 className="font-heading font-bold text-xl text-foreground mb-2">Estimate Not Available</h3>
                  <p className="text-foreground/60 max-w-md mx-auto mb-4">
                    We do not have pricing data for this combination yet. Call us for a personalized quote.
                  </p>
                  <a
                    href="tel:2168620005"
                    className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase"
                  >
                    <Phone className="w-4 h-4" />
                    CALL (216) 862-0005
                  </a>
                  <div className="mt-4">
                    <button onClick={reset} className="text-nick-teal font-mono text-sm hover:underline">
                      ← Try another service
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Trust Section */}
      <section className="section-dark py-12 lg:py-16">
        <div className="container max-w-3xl text-center">
          <h2 className="font-heading font-bold text-2xl text-foreground tracking-tight mb-4">
            WHY OUR PRICING IS DIFFERENT
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8">
            {[
              { title: "No Hidden Fees", desc: "The price we quote is the price you pay. Period." },
              { title: "Approval First", desc: "We explain the diagnosis and get your OK before any work starts." },
              { title: "Fair Parts Pricing", desc: "We use quality parts at competitive prices. No markups on markups." },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <h3 className="font-heading font-bold text-sm text-nick-yellow tracking-wider mb-2">{item.title}</h3>
                <p className="text-foreground/60 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
