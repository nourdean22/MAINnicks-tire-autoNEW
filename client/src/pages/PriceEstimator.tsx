import { useState } from "react";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  DollarSign, Car, Wrench, Clock, Phone, AlertCircle, ChevronRight, Info, CreditCard,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { QueryError } from "@/components/QueryState";

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
    <PageLayout activeHref="/pricing" showChat={true}>
      <SEOHead
        title="Auto Repair Pricing — Nick's Tire & Auto Cleveland"
        description="Transparent auto repair pricing at Nick's Tire & Auto, Cleveland. Get estimates for brakes, tires, oil changes, diagnostics, and more."
        canonicalPath="/pricing"
      />
      <Breadcrumbs items={[{ label: "Cost Estimator", href: "/estimate" }]} />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="bg-[oklch(0.065_0.004_260)] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-3xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-wide">Transparent Pricing</span>
          <h1 className="font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight">
            INSTANT <span className="text-primary">PRICE ESTIMATE</span>
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
            Select your service and vehicle type for a ballpark estimate. No surprises. No hidden fees.
          </p>
        </div>
      </section>

      {/* Estimator */}
      <section className="bg-[oklch(0.055_0.004_260)] py-12 lg:py-16">
        <div className="container max-w-3xl">
          {!showResult ? (
            <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 space-y-8">
              {/* Step 1: Service */}
              <div>
                <label className="text-[12px] text-nick-teal/80 tracking-wide block mb-3">
                  1. What service do you need?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {SERVICE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setService(s.value)}
                      className={`flex items-center gap-3 px-4 py-3.5 border rounded-md text-[13px] text-left transition-all ${
                        service === s.value
                          ? "border-primary bg-primary/10 text-primary ring-1 ring-nick-yellow/30"
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
                  <label className="text-[12px] text-nick-teal/80 tracking-wide block mb-3">
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
                            ? "border-primary bg-primary/10 text-primary ring-1 ring-nick-yellow/30"
                            : "border-border/50 text-foreground/70 hover:border-nick-teal/40 hover:text-nick-teal"
                        }`}
                      >
                        <Car className="w-4 h-4 shrink-0" />
                        <div>
                          <div className="text-[13px] font-semibold">{v.label}</div>
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
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors hover:opacity-90 transition-opacity"
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
                  <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-foreground/60 text-[13px]">Calculating estimate...</p>
                </div>
              ) : estimateQuery.data ? (
                <>
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8">
                    <div className="text-center mb-6">
                      <span className="font-mono text-nick-teal text-xs tracking-wide">Estimated Cost</span>
                      <h2 className="font-bold text-3xl lg:text-4xl text-foreground mt-2">
                        {selectedService?.label}
                      </h2>
                      <p className="text-foreground/60 text-[13px] mt-1">
                        {selectedVehicle?.label} ({selectedVehicle?.examples})
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-4 py-8">
                      <div className="text-center">
                        <span className="font-mono text-foreground/40 text-xs uppercase block mb-1">From</span>
                        <span className="font-bold text-4xl lg:text-5xl text-nick-teal">
                          ${estimateQuery.data.lowEstimate}
                        </span>
                      </div>
                      <div className="text-foreground/20 text-2xl">—</div>
                      <div className="text-center">
                        <span className="font-mono text-foreground/40 text-xs uppercase block mb-1">Up To</span>
                        <span className="font-bold text-4xl lg:text-5xl text-primary">
                          ${estimateQuery.data.highEstimate}
                        </span>
                      </div>
                    </div>

                    {estimateQuery.data.typicalHours && (
                      <div className="flex items-center justify-center gap-2 text-foreground/60 text-[13px] mb-4">
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
                  <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 rounded-md p-4">
                    <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
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
                      href="/booking"
                      className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
                    >
                      BOOK THIS SERVICE
                    </a>
                    <a
                      href={BUSINESS.phone.href}
                      className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      CALL FOR EXACT QUOTE
                    </a>
                  </div>

                  <div className="text-center">
                    <button
                      onClick={reset}
                      className="text-nick-teal text-[13px] hover:underline"
                    >
                      ← Estimate another service
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-8">
                  <AlertCircle className="w-12 h-12 text-primary/60 mx-auto mb-4" />
                  <h3 className="font-bold text-xl text-foreground mb-2">Estimate Not Available</h3>
                  <p className="text-foreground/60 max-w-md mx-auto mb-4">
                    We do not have pricing data for this combination yet. Call us for a personalized quote.
                  </p>
                  <a
                    href={BUSINESS.phone.href}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-bold text-sm tracking-wide"
                  >
                    <Phone className="w-4 h-4" />
                    CALL {BUSINESS.phone.display}
                  </a>
                  <div className="mt-4">
                    <button onClick={reset} className="text-nick-teal text-[13px] hover:underline">
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
      <section className="bg-[oklch(0.065_0.004_260)] py-12 lg:py-16">
        <div className="container max-w-3xl text-center">
          <h2 className="font-bold text-2xl text-foreground tracking-tight mb-4">
            WHY OUR PRICING IS DIFFERENT
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
            {[
              { title: "No Hidden Fees", desc: "The price we quote is the price you pay. Period." },
              { title: "Approval First", desc: "We explain the diagnosis and get your OK before any work starts." },
              { title: "Fair Parts Pricing", desc: "We use quality parts at competitive prices. No markups on markups." },
              { title: "Acima Lease-to-Own Accepted", desc: "Get repairs done today for $10 initial payment. No credit history needed. 90-day early purchase option.", accent: true },
            ].map((item) => (
              <div key={item.title} className={`text-center ${(item as any).accent ? "bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4" : ""}`}>
                {(item as any).accent && <CreditCard className="w-5 h-5 text-emerald-400 mx-auto mb-2" />}
                <h3 className={`font-bold text-sm tracking-[-0.01em] mb-2 ${(item as any).accent ? "text-emerald-400" : "text-primary"}`}>{item.title}</h3>
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
