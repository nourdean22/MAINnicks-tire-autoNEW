/**
 * TIRE FINDER — Customer-facing tire search & order page
 * Tesla-quality design: ultra-clean, minimal, high-contrast
 * Powered by Gateway Tire wholesale data with shop markup
 */

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Phone, Search, ShieldCheck, Truck, Clock, ChevronRight, ArrowLeft, Star, Check, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ─── TIRE SIZE HELPER ──────────────────────────────────
const COMMON_SIZES = [
  "205/55R16", "215/60R16", "225/65R17", "235/65R18",
  "215/55R17", "225/60R18", "245/60R18", "265/70R17",
  "195/65R15", "225/45R17", "235/55R19", "275/55R20",
];

function formatSizeForSearch(size: string): string {
  // Strip slashes, R, spaces → just digits
  return size.replace(/[\/Rr\s-]/g, "");
}

// ─── NAVBAR (minimal) ──────────────────────────────────
function TireNavbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border/30">
      <div className="container flex items-center justify-between h-16">
        <a href="/" className="flex items-center gap-3 group">
          <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
              <span className="font-semibold text-primary-foreground text-sm">N</span>
            </div>
            <span className="font-semibold text-foreground text-sm tracking-wide hidden sm:block">NICK'S TIRE & AUTO</span>
          </div>
        </a>
        <a href="tel:2168620005" className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors text-sm font-medium">
          <Phone className="w-4 h-4" />
          <span className="hidden sm:block">(216) 862-0005</span>
        </a>
      </div>
    </nav>
  );
}

// ─── ORDER MODAL ───────────────────────────────────────
interface OrderModalProps {
  tire: { name: string; size: string; shopPrice: number; brand: string } | null;
  quantity: number;
  onClose: () => void;
}

function OrderModal({ tire, quantity, onClose }: OrderModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const orderMutation = trpc.gatewayTire.requestOrder.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Something went wrong. Please call us at (216) 862-0005."),
  });

  if (!tire) return null;

  const total = tire.shopPrice * quantity;

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-nick-charcoal border border-border/50 rounded-lg p-8 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-2xl font-semibold text-foreground mb-3">Order Request Received</h3>
          <p className="text-muted-foreground mb-6 leading-relaxed">
            We will confirm availability and reach out within 1 business hour to schedule your installation.
          </p>
          <button onClick={onClose} className="w-full bg-primary text-primary-foreground py-3 rounded-md font-medium hover:bg-primary/90 transition-colors">
            Done
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-nick-charcoal border border-border/50 rounded-lg p-6 sm:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-semibold text-foreground mb-1">Request This Tire</h3>
        <p className="text-muted-foreground text-sm mb-6">{quantity}x {tire.name}</p>

        {/* Price summary */}
        <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">{tire.name}</span>
            <span className="text-foreground">${tire.shopPrice.toFixed(2)} ea</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Quantity</span>
            <span className="text-foreground">{quantity}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Mounting & Balancing</span>
            <span className="text-primary font-medium">Included</span>
          </div>
          <div className="border-t border-border/30 mt-3 pt-3 flex justify-between">
            <span className="font-medium text-foreground">Estimated Total</span>
            <span className="font-semibold text-primary text-lg">${total.toFixed(2)}</span>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Full Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Phone Number *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="(216) 555-0123"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Vehicle (Year Make Model)</label>
            <input
              type="text"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="2020 Honda Civic"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none"
              placeholder="Any special requests..."
            />
          </div>
        </div>

        <button
          onClick={() => {
            if (!name.trim() || !phone.trim()) {
              toast.error("Name and phone number are required.");
              return;
            }
            orderMutation.mutate({
              tireName: tire.name,
              tireSize: tire.size,
              quantity,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              customerEmail: email.trim() || undefined,
              vehicleInfo: vehicle.trim() || undefined,
              notes: notes.trim() || undefined,
            });
          }}
          disabled={orderMutation.isPending}
          className="w-full mt-6 bg-primary text-primary-foreground py-3 rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {orderMutation.isPending ? "Submitting..." : "Request This Tire"}
        </button>

        <p className="text-xs text-muted-foreground text-center mt-4">
          We will confirm pricing and availability before processing. No charge until you approve.
        </p>
      </motion.div>
    </div>
  );
}

// ─── TIRE CARD ─────────────────────────────────────────
interface TireCardProps {
  tire: {
    name: string;
    brand: string;
    model: string;
    size: string;
    shopPrice: number;
    loadRating: string;
    speedRating: string;
    warranty: string;
    inStock: boolean;
  };
  onSelect: () => void;
}

function TireCard({ tire, onSelect }: TireCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group bg-nick-charcoal border border-border/30 rounded-lg p-5 hover:border-primary/30 transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs font-medium text-primary/80 tracking-wide">{tire.brand}</span>
          <h3 className="text-foreground font-medium mt-0.5 leading-snug">{tire.model || tire.name}</h3>
        </div>
        {tire.inStock && (
          <span className="text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-medium">
            In Stock
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
        <span>Size: {tire.size}</span>
        {tire.loadRating && <span>Load: {tire.loadRating}</span>}
        {tire.speedRating && <span>Speed: {tire.speedRating}</span>}
        {tire.warranty && <span>Warranty: {tire.warranty}</span>}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <span className="text-2xl font-semibold text-foreground">${tire.shopPrice.toFixed(2)}</span>
          <span className="text-xs text-muted-foreground ml-1">per tire</span>
        </div>
        <button
          onClick={onSelect}
          className="flex items-center gap-1.5 bg-primary/10 text-primary px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/20 transition-colors"
        >
          Select
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────
export default function TireFinder() {
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [quantity, setQuantity] = useState(4);
  const [selectedTire, setSelectedTire] = useState<any>(null);
  const [showOrder, setShowOrder] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = trpc.gatewayTire.publicSearch.useQuery(
    { size: formatSizeForSearch(activeSearch) },
    { enabled: !!activeSearch }
  );

  const handleSearch = () => {
    if (searchInput.trim().length < 3) {
      toast.error("Please enter a valid tire size.");
      return;
    }
    setActiveSearch(searchInput.trim());
  };

  useEffect(() => {
    if (data && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [data]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TireNavbar />

      {/* ─── HERO ─── */}
      <section className="pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="container max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="text-xs font-medium text-primary tracking-[0.2em] uppercase">Tire Finder</span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-foreground mt-4 leading-[1.1] tracking-tight">
              Find Your Perfect Tires
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Search by tire size. See pricing. Request installation. We handle everything.
            </p>
          </motion.div>

          {/* ─── SEARCH BAR ─── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-10"
          >
            <div className="flex items-center bg-nick-charcoal border border-border/50 rounded-lg overflow-hidden focus-within:border-primary/50 transition-colors">
              <Search className="w-5 h-5 text-muted-foreground ml-4 shrink-0" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Enter tire size (e.g. 215/60R16)"
                className="flex-1 bg-transparent px-4 py-4 text-foreground text-base focus:outline-none placeholder:text-muted-foreground/50"
              />
              <button
                onClick={handleSearch}
                disabled={isLoading}
                className="bg-primary text-primary-foreground px-6 py-4 font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
              >
                {isLoading ? "Searching..." : "Search"}
              </button>
            </div>

            {/* Quick sizes */}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <span className="text-xs text-muted-foreground mr-1 self-center">Popular:</span>
              {COMMON_SIZES.slice(0, 6).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSearchInput(s); setActiveSearch(s); }}
                  className="text-xs text-muted-foreground hover:text-primary border border-border/30 rounded-full px-3 py-1 hover:border-primary/30 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── RESULTS ─── */}
      <AnimatePresence>
        {activeSearch && (
          <section ref={resultsRef} className="pb-20">
            <div className="container max-w-5xl mx-auto">
              {isLoading ? (
                <div className="text-center py-16">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">Searching available tires...</p>
                </div>
              ) : isError ? (
                <div className="text-center py-16">
                  <p className="text-muted-foreground mb-4">Unable to search tires right now.</p>
                  <a href="tel:2168620005" className="text-primary hover:underline">Call us at (216) 862-0005</a>
                </div>
              ) : data?.tires && data.tires.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">
                        {data.tires.length} Tires Available
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Size: {activeSearch} — Prices include mounting & balancing
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Qty:</span>
                      {[2, 4].map((q) => (
                        <button
                          key={q}
                          onClick={() => setQuantity(q)}
                          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                            quantity === q
                              ? "bg-primary text-primary-foreground"
                              : "bg-nick-charcoal text-muted-foreground hover:text-foreground border border-border/30"
                          }`}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.tires.map((tire, i) => (
                      <TireCard
                        key={`${tire.name}-${i}`}
                        tire={tire}
                        onSelect={() => { setSelectedTire(tire); setShowOrder(true); }}
                      />
                    ))}
                  </div>

                  {/* Set of 4 pricing callout */}
                  <div className="mt-8 bg-nick-charcoal border border-border/30 rounded-lg p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Starting at</p>
                    <p className="text-3xl font-semibold text-foreground">
                      ${(Math.min(...data.tires.map(t => t.shopPrice)) * quantity).toFixed(2)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      for a set of {quantity} — installed, balanced, and ready to roll
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-center py-16">
                  <p className="text-muted-foreground mb-2">No tires found for "{activeSearch}"</p>
                  <p className="text-sm text-muted-foreground">Try a different size or <a href="tel:2168620005" className="text-primary hover:underline">call us</a> for help.</p>
                </div>
              )}
            </div>
          </section>
        )}
      </AnimatePresence>

      {/* ─── TRUST SIGNALS ─── */}
      {!activeSearch && (
        <section className="pb-20">
          <div className="container max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { icon: <ShieldCheck className="w-6 h-6" />, title: "Honest Pricing", desc: "No hidden fees. The price you see includes professional mounting and balancing." },
                { icon: <Truck className="w-6 h-6" />, title: "Fast Delivery", desc: "Most tires arrive within 1-2 business days from our regional warehouse." },
                { icon: <Clock className="w-6 h-6" />, title: "Same-Day Install", desc: "In-stock tires can be installed the same day. Walk-ins welcome." },
              ].map((item) => (
                <div key={item.title} className="text-center p-6">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
                    {item.icon}
                  </div>
                  <h3 className="font-medium text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* How it works */}
            <div className="mt-16 text-center">
              <h2 className="text-2xl font-semibold text-foreground mb-8">How It Works</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                {[
                  { step: "01", label: "Search your tire size" },
                  { step: "02", label: "Choose your tire" },
                  { step: "03", label: "Submit your request" },
                  { step: "04", label: "We install it" },
                ].map((s) => (
                  <div key={s.step} className="flex flex-col items-center">
                    <span className="text-3xl font-semibold text-primary/30 mb-2">{s.step}</span>
                    <span className="text-sm text-foreground font-medium">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reviews callout */}
            <div className="mt-16 bg-nick-charcoal border border-border/30 rounded-lg p-8 text-center">
              <div className="flex justify-center gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-lg text-foreground font-medium mb-1">4.9 Stars — 1,683+ Reviews</p>
              <p className="text-sm text-muted-foreground">
                Cleveland's most trusted tire shop. Serving Euclid, Lakewood, Parma, and all of Northeast Ohio.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-border/30 py-8">
        <div className="container text-center">
          <p className="text-xs text-muted-foreground">
            Nick's Tire & Auto — 17625 Euclid Ave, Cleveland, OH 44112 — (216) 862-0005
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Mon–Sat 9AM–6PM — <a href="/" className="text-primary hover:underline">Back to Main Site</a>
          </p>
        </div>
      </footer>

      {/* ─── ORDER MODAL ─── */}
      {showOrder && (
        <OrderModal
          tire={selectedTire}
          quantity={quantity}
          onClose={() => { setShowOrder(false); setSelectedTire(null); }}
        />
      )}
    </div>
  );
}
