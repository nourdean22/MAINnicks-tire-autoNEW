/**
 * Instant Quote Page — Real-time quote builder powered by statenour-os data.
 *
 * Flow: Select vehicle → Pick services (real labor ops) → Add tires → See total → Book
 */
import { useState, useEffect, useCallback } from "react";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FinancingCTA from "@/components/FinancingCTA";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BUSINESS } from "@shared/business";
import {
  Wrench, CircleDot, ChevronRight, Phone, CheckCircle2,
  DollarSign, Clock, ShieldCheck, Loader2, ArrowLeft,
} from "lucide-react";

// ─── Vehicle Data ──────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 15 }, (_, i) => String(CURRENT_YEAR - i));

const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge",
  "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia", "Lexus",
  "Lincoln", "Mazda", "Mercedes-Benz", "Nissan", "Ram", "Subaru", "Toyota", "Volkswagen", "Other",
];

const COMMON_SIZES = [
  "205/55R16", "215/55R17", "225/45R17", "225/65R17",
  "235/65R17", "265/70R17", "275/55R20", "245/75R16", "195/65R15",
];

// ─── Types ─────────────────────────────────────────────
interface LaborOp {
  id: string;
  operationName: string;
  category: string;
  laborHours: number;
  laborCost: number;
  difficulty?: string;
}

interface TireResult {
  id: string;
  brand: string;
  model: string;
  size: string;
  retailPrice: number;
}

type Step = "vehicle" | "services" | "tires" | "review" | "done";

function fmt(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Main Component ────────────────────────────────────
export default function InstantQuote() {
  // Vehicle state
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");

  // Service selection
  const [categories, setCategories] = useState<Record<string, LaborOp[]>>({});
  const [selectedOps, setSelectedOps] = useState<LaborOp[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);

  // Tire selection
  const [tireSize, setTireSize] = useState("");
  const [tireResults, setTireResults] = useState<TireResult[]>([]);
  const [selectedTires, setSelectedTires] = useState<{ tire: TireResult; qty: number }[]>([]);
  const [loadingTires, setLoadingTires] = useState(false);

  // Customer info + quote
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [step, setStep] = useState<Step>("vehicle");
  const [quoteResult, setQuoteResult] = useState<{ quoteNumber: string; grandTotal: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch categories on mount
  const loadCategories = useCallback(async () => {
    setLoadingOps(true);
    try {
      const res = await fetch("/api/trpc/nourOsQuote.laborCategories", { method: "GET" });
      // tRPC wraps in { result: { data } }
      const json = await res.json();
      const data = json?.result?.data ?? json;
      if (data?.categories) setCategories(data.categories);
    } catch {
      // Fall back silently
    }
    setLoadingOps(false);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // Tire search
  const searchTires = useCallback(async (size: string) => {
    if (size.length < 5) return;
    setLoadingTires(true);
    try {
      const res = await fetch(`/api/trpc/nourOsQuote.searchTires?input=${encodeURIComponent(JSON.stringify({ size }))}`);
      const json = await res.json();
      const data = json?.result?.data ?? json;
      setTireResults(data?.tires ?? []);
    } catch {
      setTireResults([]);
    }
    setLoadingTires(false);
  }, []);

  // Toggle service
  const toggleOp = (op: LaborOp) => {
    setSelectedOps((prev) =>
      prev.find((o) => o.id === op.id) ? prev.filter((o) => o.id !== op.id) : [...prev, op]
    );
  };

  // Add tire
  const addTire = (tire: TireResult) => {
    if (selectedTires.find((t) => t.tire.id === tire.id)) return;
    setSelectedTires((prev) => [...prev, { tire, qty: 4 }]);
  };

  const removeTire = (id: string) => {
    setSelectedTires((prev) => prev.filter((t) => t.tire.id !== id));
  };

  // Totals
  const laborTotal = selectedOps.reduce((s, o) => s + o.laborCost, 0);
  const tireTotal = selectedTires.reduce((s, t) => s + t.tire.retailPrice * t.qty, 0);
  const grandTotal = laborTotal + tireTotal;

  // Submit quote
  const submitQuote = async () => {
    if (!year || !make || !model) { toast.error("Please enter vehicle info"); return; }
    if (selectedOps.length === 0 && selectedTires.length === 0) { toast.error("Select at least one service or tire"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/trpc/nourOsQuote.createQuote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleYear: parseInt(year),
          vehicleMake: make,
          vehicleModel: model,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          services: selectedOps.map((o) => o.id),
          tires: selectedTires.map((t) => ({ id: t.tire.id, qty: t.qty })),
          source: "website",
        }),
      });
      const json = await res.json();
      const data = json?.result?.data ?? json;
      if (data?.quoteNumber) {
        setQuoteResult({ quoteNumber: data.quoteNumber, grandTotal: data.grandTotal });
        setStep("done");
        toast.success("Quote created!");
      } else {
        toast.error("Failed to create quote");
      }
    } catch {
      toast.error("Something went wrong");
    }
    setSubmitting(false);
  };

  return (
    <PageLayout>
      <SEOHead
        title="Instant Quote — Nick's Tire & Auto"
        description="Get a real-time repair and tire quote. Select your vehicle, pick services, and see your total instantly."
        canonicalPath="/instant-quote"
      />
      <LocalBusinessSchema />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Instant Quote</h1>
          <p className="text-gray-600 text-lg">Get your price in 60 seconds. No surprises.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(["vehicle", "services", "tires", "review"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step === s ? "bg-red-600 text-white" : step === "done" || i < ["vehicle", "services", "tires", "review"].indexOf(step) ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500"
                }`}
              >
                {i + 1}
              </div>
              {i < 3 && <ChevronRight className="w-4 h-4 text-gray-400" />}
            </div>
          ))}
        </div>

        {/* STEP 1: Vehicle */}
        {step === "vehicle" && (
          <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Wrench className="w-5 h-5 text-red-600" /> What's your vehicle?
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select year</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                <select
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select make</option>
                  {MAKES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. Civic, Camry, F-150"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <button
              onClick={() => year && make && model ? setStep("services") : toast.error("Fill in all vehicle fields")}
              className="w-full bg-red-600 text-white rounded-lg py-3 font-semibold hover:bg-red-700 transition"
            >
              Next: Select Services <ChevronRight className="inline w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 2: Services */}
        {step === "services" && (
          <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Wrench className="w-5 h-5 text-red-600" /> Select Services
              </h2>
              <button onClick={() => setStep("vehicle")} className="text-sm text-gray-500 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>

            <p className="text-sm text-gray-500">{year} {make} {model}</p>

            {loadingOps ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-red-600" />
              </div>
            ) : Object.keys(categories).length === 0 ? (
              <p className="text-gray-500 py-8 text-center">No operations available right now. Call us for a quote.</p>
            ) : (
              <div className="space-y-4 max-h-[50vh] overflow-y-auto">
                {Object.entries(categories).map(([cat, ops]) => (
                  <div key={cat}>
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{cat}</h3>
                    <div className="space-y-1">
                      {(ops as LaborOp[]).map((op) => {
                        const selected = selectedOps.find((o) => o.id === op.id);
                        return (
                          <button
                            key={op.id}
                            onClick={() => toggleOp(op)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition ${
                              selected ? "bg-red-50 border border-red-200 text-red-800" : "bg-gray-50 hover:bg-gray-100"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              {selected && <CheckCircle2 className="w-4 h-4 text-red-600" />}
                              {op.operationName}
                            </span>
                            <span className="font-mono font-semibold">{fmt(op.laborCost)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedOps.length > 0 && (
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-sm text-gray-600">{selectedOps.length} service{selectedOps.length > 1 ? "s" : ""} selected</span>
                <span className="font-mono font-bold text-lg">{fmt(laborTotal)}</span>
              </div>
            )}

            <button
              onClick={() => setStep("tires")}
              className="w-full bg-red-600 text-white rounded-lg py-3 font-semibold hover:bg-red-700 transition"
            >
              Next: Add Tires (Optional) <ChevronRight className="inline w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 3: Tires */}
        {step === "tires" && (
          <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CircleDot className="w-5 h-5 text-red-600" /> Add Tires (Optional)
              </h2>
              <button onClick={() => setStep("services")} className="text-sm text-gray-500 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>

            {/* Quick size selector */}
            <div className="flex flex-wrap gap-2">
              {COMMON_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => { setTireSize(s); searchTires(s); }}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    tireSize === s ? "bg-red-600 text-white border-red-600" : "border-gray-300 hover:border-red-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={tireSize}
                onChange={(e) => setTireSize(e.target.value)}
                placeholder="Enter tire size (e.g. 225/65R17)"
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => searchTires(tireSize)}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium"
              >
                Search
              </button>
            </div>

            {loadingTires ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-red-600" />
              </div>
            ) : tireResults.length > 0 ? (
              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {tireResults.map((tire) => {
                  const added = selectedTires.find((t) => t.tire.id === tire.id);
                  return (
                    <div
                      key={tire.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                        added ? "bg-green-50 border border-green-200" : "bg-gray-50"
                      }`}
                    >
                      <div>
                        <p className="font-medium">{tire.brand} {tire.model}</p>
                        <p className="text-xs text-gray-500">{tire.size}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold">{fmt(tire.retailPrice)}/ea</span>
                        {added ? (
                          <button
                            onClick={() => removeTire(tire.id)}
                            className="text-xs text-red-600 underline"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            onClick={() => addTire(tire)}
                            className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium"
                          >
                            Add (×4)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : tireSize.length >= 5 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No tires found for that size.</p>
            ) : null}

            {selectedTires.length > 0 && (
              <div className="border-t pt-3">
                {selectedTires.map((t) => (
                  <div key={t.tire.id} className="flex items-center justify-between text-sm py-1">
                    <span>{t.tire.brand} {t.tire.model} ×{t.qty}</span>
                    <span className="font-mono">{fmt(t.tire.retailPrice * t.qty)}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setStep("review")}
              className="w-full bg-red-600 text-white rounded-lg py-3 font-semibold hover:bg-red-700 transition"
            >
              Review Quote <ChevronRight className="inline w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 4: Review */}
        {step === "review" && (
          <div className="bg-white rounded-xl shadow-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Review Your Quote</h2>
              <button onClick={() => setStep("tires")} className="text-sm text-gray-500 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-700">{year} {make} {model}</p>
            </div>

            {selectedOps.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Services</h3>
                {selectedOps.map((op) => (
                  <div key={op.id} className="flex justify-between text-sm py-1">
                    <span>{op.operationName}</span>
                    <span className="font-mono">{fmt(op.laborCost)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                  <span>Labor subtotal</span>
                  <span className="font-mono">{fmt(laborTotal)}</span>
                </div>
              </div>
            )}

            {selectedTires.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Tires</h3>
                {selectedTires.map((t) => (
                  <div key={t.tire.id} className="flex justify-between text-sm py-1">
                    <span>{t.tire.brand} {t.tire.model} ×{t.qty}</span>
                    <span className="font-mono">{fmt(t.tire.retailPrice * t.qty)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                  <span>Tire subtotal</span>
                  <span className="font-mono">{fmt(tireTotal)}</span>
                </div>
              </div>
            )}

            <div className="bg-red-50 rounded-lg p-4 flex justify-between items-center">
              <span className="text-lg font-bold text-red-900">Estimated Total</span>
              <span className="text-2xl font-bold font-mono text-red-600">{fmt(grandTotal)}</span>
            </div>

            {/* Customer info */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Your Info (optional — speeds up booking)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Name"
                  className="border rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Phone"
                  className="border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <button
              onClick={submitQuote}
              disabled={submitting}
              className="w-full bg-red-600 text-white rounded-lg py-3 font-semibold hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating Quote...</>
              ) : (
                <>Get My Quote <CheckCircle2 className="w-4 h-4" /></>
              )}
            </button>
          </div>
        )}

        {/* STEP 5: Done */}
        {step === "done" && quoteResult && (
          <div className="bg-white rounded-xl shadow-md p-8 text-center space-y-4">
            <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto" />
            <h2 className="text-2xl font-bold">Quote Ready!</h2>
            <p className="text-gray-600">Your quote number is:</p>
            <p className="text-3xl font-mono font-bold text-red-600">{quoteResult.quoteNumber}</p>
            <p className="text-xl font-semibold">Total: {fmt(quoteResult.grandTotal)}</p>
            <p className="text-sm text-gray-500">Save this quote number. It&apos;s valid for 7 days.</p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
              <a
                href={`tel:${BUSINESS.phone}`}
                className="inline-flex items-center justify-center gap-2 bg-red-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-red-700 transition"
              >
                <Phone className="w-4 h-4" /> Call to Book
              </a>
              <button
                onClick={() => {
                  setStep("vehicle");
                  setSelectedOps([]);
                  setSelectedTires([]);
                  setQuoteResult(null);
                }}
                className="inline-flex items-center justify-center gap-2 border border-gray-300 rounded-lg px-6 py-3 font-semibold hover:bg-gray-50 transition"
              >
                New Quote
              </button>
            </div>
          </div>
        )}

        {/* Trust badges */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center text-sm text-gray-600">
          <div className="flex flex-col items-center gap-1">
            <ShieldCheck className="w-6 h-6 text-green-600" />
            <span>No Surprises</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Clock className="w-6 h-6 text-blue-600" />
            <span>Valid 7 Days</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <DollarSign className="w-6 h-6 text-red-600" />
            <span>Financing Available</span>
          </div>
        </div>

        <FinancingCTA className="mt-8" />
      </div>
    </PageLayout>
  );
}
