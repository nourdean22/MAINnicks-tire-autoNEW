/**
 * TIRE FINDER — Full e-commerce tire search, browse, and order page
 * Customers search by size → browse options → place order → track status
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Phone, Search, ShieldCheck, Truck, Clock, ChevronRight, ArrowLeft,
  Star, Check, X, Filter, ArrowUpDown, Package, CircleDot, Loader2,
  CheckCircle2, MapPin, Info,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ─── HELPERS ──────────────────────────────────────────
const COMMON_SIZES = [
  "205/55R16", "215/60R16", "225/65R17", "235/65R18",
  "215/55R17", "225/60R18", "245/60R18", "265/70R17",
  "195/65R15", "225/45R17", "235/55R19", "275/55R20",
];

function formatSizeForSearch(size: string): string {
  return size.replace(/[\/Rr\s-]/g, "");
}

type SortOption = "price-low" | "price-high" | "warranty" | "brand";
type CategoryFilter = "all" | "budget" | "mid" | "premium";

// ─── NAVBAR ───────────────────────────────────────────
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

// ─── ORDER MODAL ──────────────────────────────────────
interface OrderModalProps {
  tire: {
    name: string;
    brand: string;
    model: string;
    size: string;
    shopPrice: number;
    pricePerTireCents: number;
  } | null;
  quantity: number;
  serviceFee: number;
  onClose: () => void;
}

function OrderModal({ tire, quantity, serviceFee, onClose }: OrderModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; totalAmount: number } | null>(null);

  const orderMutation = trpc.gatewayTire.placeOrder.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setOrderResult({ orderNumber: data.orderNumber!, totalAmount: data.totalAmount! });
      } else {
        toast.error("Something went wrong. Please call us at (216) 862-0005.");
      }
    },
    onError: () => toast.error("Something went wrong. Please call us at (216) 862-0005."),
  });

  if (!tire) return null;

  const tireTotal = tire.shopPrice * quantity;
  const serviceTotal = serviceFee * quantity;
  const grandTotal = tireTotal + serviceTotal;

  // Success state
  if (orderResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-card border border-border/50 rounded-lg p-8 max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <h3 className="text-2xl font-semibold text-foreground mb-2">Order Placed</h3>
          <p className="text-sm text-primary font-medium mb-4">Order #{orderResult.orderNumber}</p>
          <p className="text-muted-foreground mb-6 leading-relaxed text-sm">
            We will confirm availability and contact you within 1 business hour to finalize your order and schedule installation.
          </p>
          <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6 text-left">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Total</span>
              <span className="text-foreground font-medium">${orderResult.totalAmount.toFixed(2)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">No charge until you approve. We confirm pricing and availability first.</p>
          </div>
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
        className="relative bg-card border border-border/50 rounded-lg p-6 sm:p-8 max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-semibold text-foreground mb-1">Order Tires</h3>
        <p className="text-muted-foreground text-sm mb-6">{quantity}x {tire.brand} {tire.model}</p>

        {/* Price breakdown */}
        <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">{tire.brand} {tire.model} x{quantity}</span>
            <span className="text-foreground">${tireTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Mounting, Balancing & Disposal x{quantity}</span>
            <span className="text-foreground">${serviceTotal.toFixed(2)}</span>
          </div>
          <div className="border-t border-border/30 mt-3 pt-3 flex justify-between">
            <span className="font-medium text-foreground">Estimated Total</span>
            <span className="font-semibold text-primary text-lg">${grandTotal.toFixed(2)}</span>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Full Name *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Phone Number *</label>
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="(216) 555-0123"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Email (for order updates)</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Vehicle (Year Make Model)</label>
            <input
              type="text" value={vehicle} onChange={(e) => setVehicle(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="2020 Honda Civic"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Notes (optional)</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none"
              placeholder="Preferred day/time for installation..."
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
              tireBrand: tire.brand,
              tireModel: tire.model,
              tireSize: tire.size,
              quantity,
              pricePerTireCents: tire.pricePerTireCents,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              customerEmail: email.trim() || undefined,
              vehicleInfo: vehicle.trim() || undefined,
              customerNotes: notes.trim() || undefined,
            });
          }}
          disabled={orderMutation.isPending}
          className="w-full mt-6 bg-primary text-primary-foreground py-3 rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {orderMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Placing Order...</>
          ) : (
            "Place Order"
          )}
        </button>

        <p className="text-xs text-muted-foreground text-center mt-4">
          No charge until we confirm. We verify pricing and availability before processing.
        </p>
      </motion.div>
    </div>
  );
}

// ─── TIRE CARD ────────────────────────────────────────
interface TireCardProps {
  tire: {
    id: string;
    name: string;
    brand: string;
    model: string;
    size: string;
    category: "budget" | "mid" | "premium";
    shopPrice: number;
    pricePerTireCents: number;
    warranty: string;
    features: string[];
    speedRating: string;
    loadIndex: string;
    inStock: boolean;
    estimatedDelivery: string;
  };
  quantity: number;
  onSelect: () => void;
}

const categoryLabels: Record<string, { label: string; color: string }> = {
  budget: { label: "Value", color: "text-green-400 bg-green-500/10" },
  mid: { label: "Popular", color: "text-blue-400 bg-blue-500/10" },
  premium: { label: "Premium", color: "text-amber-400 bg-amber-500/10" },
};

function TireCard({ tire, quantity, onSelect }: TireCardProps) {
  const cat = categoryLabels[tire.category] || categoryLabels.mid;
  const setPrice = (tire.shopPrice * quantity).toFixed(2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="group bg-card border border-border/30 rounded-lg p-5 hover:border-primary/30 transition-all duration-200"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-medium tracking-wider uppercase px-2 py-0.5 rounded-full ${cat.color}`}>
              {cat.label}
            </span>
            {tire.inStock && (
              <span className="text-[10px] font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CircleDot className="w-2.5 h-2.5" /> In Stock
              </span>
            )}
          </div>
          <h3 className="text-foreground font-medium leading-snug">{tire.brand}</h3>
          <p className="text-sm text-muted-foreground">{tire.model}</p>
        </div>
      </div>

      {/* Specs */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-3">
        <span>Size: {tire.size}</span>
        {tire.loadIndex && <span>Load: {tire.loadIndex}</span>}
        {tire.speedRating && <span>Speed: {tire.speedRating}</span>}
      </div>

      {/* Features */}
      {tire.features.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {tire.features.map((f) => (
            <span key={f} className="text-[10px] text-muted-foreground border border-border/30 rounded-full px-2 py-0.5">
              {f}
            </span>
          ))}
        </div>
      )}

      {/* Warranty */}
      {tire.warranty && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-primary/60" />
          <span>{tire.warranty} warranty</span>
        </div>
      )}

      {/* Price + CTA */}
      <div className="flex items-end justify-between pt-3 border-t border-border/20">
        <div>
          <span className="text-2xl font-semibold text-foreground">${tire.shopPrice.toFixed(2)}</span>
          <span className="text-xs text-muted-foreground ml-1">/tire</span>
          <p className="text-xs text-muted-foreground mt-0.5">${setPrice} for {quantity}</p>
        </div>
        <button
          onClick={onSelect}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Order
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Delivery */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3">
        <Truck className="w-3.5 h-3.5" />
        <span>{tire.estimatedDelivery}</span>
      </div>
    </motion.div>
  );
}

// ─── ORDER TRACKER ────────────────────────────────────
function OrderTracker() {
  const [orderNum, setOrderNum] = useState("");
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);

  const { data: order, refetch, isLoading } = trpc.gatewayTire.checkOrder.useQuery(
    { orderNumber: orderNum, phone },
    { enabled: false }
  );

  const handleTrack = () => {
    if (!orderNum.trim() || !phone.trim()) {
      toast.error("Enter your order number and phone number.");
      return;
    }
    setSearching(true);
    refetch().finally(() => setSearching(false));
  };

  const statusSteps = ["received", "confirmed", "ordered", "in_transit", "delivered", "scheduled", "installed"];

  return (
    <div className="bg-card border border-border/30 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Package className="w-5 h-5 text-primary" />
        Track Your Order
      </h3>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text" value={orderNum} onChange={(e) => setOrderNum(e.target.value)}
          placeholder="Order # (e.g. TO-20260320-123)"
          className="flex-1 bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50"
        />
        <input
          type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          className="flex-1 bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50"
        />
        <button
          onClick={handleTrack}
          disabled={searching || isLoading}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {searching ? "Searching..." : "Track"}
        </button>
      </div>

      {searching === false && order === null && orderNum && (
        <p className="text-sm text-muted-foreground">No order found. Check your order number and phone number.</p>
      )}

      {order && (
        <div className="mt-4 border-t border-border/30 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-foreground">{order.quantity}x {order.tireBrand} {order.tireModel}</p>
              <p className="text-xs text-muted-foreground">Size: {order.tireSize} — Total: ${order.totalAmount.toFixed(2)}</p>
            </div>
            <span className={`text-xs font-medium px-3 py-1 rounded-full bg-primary/10 text-primary`}>
              {order.statusLabel}
            </span>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-1 mt-4">
            {statusSteps.map((step, i) => {
              const currentIdx = statusSteps.indexOf(order.status);
              const isComplete = i <= currentIdx;
              return (
                <div key={step} className="flex-1">
                  <div className={`h-1.5 rounded-full ${isComplete ? "bg-primary" : "bg-border/30"}`} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Received</span>
            <span>Installed</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function TireFinder() {
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [quantity, setQuantity] = useState(4);
  const [sortBy, setSortBy] = useState<SortOption>("price-low");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedTire, setSelectedTire] = useState<any>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const searchQuery = useMemo(() => formatSizeForSearch(activeSearch), [activeSearch]);

  const { data, isLoading, isError } = trpc.gatewayTire.publicSearch.useQuery(
    { size: searchQuery, category: categoryFilter, sortBy },
    { enabled: !!activeSearch }
  );

  const handleSearch = () => {
    if (searchInput.trim().length < 3) {
      toast.error("Please enter a valid tire size (e.g. 215/60R16).");
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
      <section className="pt-28 pb-12 sm:pt-36 sm:pb-20">
        <div className="container max-w-3xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="text-xs font-medium text-primary tracking-[0.2em] uppercase">Online Tire Shop</span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-foreground mt-4 leading-[1.1] tracking-tight">
              Order Tires Online
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Search your tire size. Compare options. Place your order. We handle the rest.
            </p>
          </motion.div>

          {/* Search bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-10"
          >
            <div className="flex items-center bg-card border border-border/50 rounded-lg overflow-hidden focus-within:border-primary/50 transition-colors">
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

            {/* Track order link */}
            <button
              onClick={() => setShowTracker(!showTracker)}
              className="mt-4 text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 mx-auto"
            >
              <Package className="w-3.5 h-3.5" />
              {showTracker ? "Hide order tracker" : "Already ordered? Track your order"}
            </button>
          </motion.div>

          {/* Order tracker */}
          <AnimatePresence>
            {showTracker && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 overflow-hidden"
              >
                <OrderTracker />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ─── RESULTS ─── */}
      <AnimatePresence>
        {activeSearch && (
          <section ref={resultsRef} className="pb-20">
            <div className="container max-w-5xl mx-auto">
              {isLoading ? (
                <div className="text-center py-16">
                  <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">Searching available tires...</p>
                </div>
              ) : isError ? (
                <div className="text-center py-16">
                  <p className="text-muted-foreground mb-4">Unable to search tires right now.</p>
                  <a href="tel:2168620005" className="text-primary hover:underline">Call us at (216) 862-0005</a>
                </div>
              ) : data?.tires && data.tires.length > 0 ? (
                <>
                  {/* Results header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-semibold text-foreground">
                        {data.tires.length} Tires Available
                      </h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Size: {data.sizeFormatted} — Prices include mounting & balancing (${data.serviceFee}/tire)
                      </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Quantity selector */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Qty:</span>
                        {[2, 4].map((q) => (
                          <button
                            key={q}
                            onClick={() => setQuantity(q)}
                            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                              quantity === q
                                ? "bg-primary text-primary-foreground"
                                : "bg-card text-muted-foreground hover:text-foreground border border-border/30"
                            }`}
                          >
                            {q}
                          </button>
                        ))}
                      </div>

                      {/* Category filter */}
                      <div className="flex items-center gap-1.5">
                        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                        {(["all", "budget", "mid", "premium"] as CategoryFilter[]).map((cat) => (
                          <button
                            key={cat}
                            onClick={() => setCategoryFilter(cat)}
                            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors capitalize ${
                              categoryFilter === cat
                                ? "bg-primary/10 text-primary border border-primary/30"
                                : "text-muted-foreground hover:text-foreground border border-border/30"
                            }`}
                          >
                            {cat === "all" ? "All" : cat}
                          </button>
                        ))}
                      </div>

                      {/* Sort */}
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="text-xs bg-card border border-border/30 rounded-md px-3 py-1.5 text-muted-foreground focus:outline-none focus:border-primary/50"
                      >
                        <option value="price-low">Price: Low to High</option>
                        <option value="price-high">Price: High to Low</option>
                        <option value="warranty">Best Warranty</option>
                        <option value="brand">Brand A-Z</option>
                      </select>
                    </div>
                  </div>

                  {/* Tire grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.tires.map((tire) => (
                      <TireCard
                        key={tire.id}
                        tire={tire}
                        quantity={quantity}
                        onSelect={() => { setSelectedTire(tire); setShowOrder(true); }}
                      />
                    ))}
                  </div>

                  {/* Set pricing callout */}
                  <div className="mt-8 bg-card border border-border/30 rounded-lg p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Starting at</p>
                    <p className="text-3xl font-semibold text-foreground">
                      ${((Math.min(...data.tires.map(t => t.shopPrice)) + data.serviceFee) * quantity).toFixed(2)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      for a set of {quantity} — installed, balanced, and ready to roll
                    </p>
                  </div>

                  {/* Info note */}
                  <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>Prices shown are estimates based on current wholesale availability. We confirm exact pricing before processing your order. No charge until you approve.</p>
                  </div>
                </>
              ) : (
                <div className="text-center py-16">
                  <p className="text-muted-foreground mb-2">No tires found for "{activeSearch}"</p>
                  <p className="text-sm text-muted-foreground">
                    Try a different size or <a href="tel:2168620005" className="text-primary hover:underline">call us</a> for help.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
      </AnimatePresence>

      {/* ─── TRUST SIGNALS (when no search active) ─── */}
      {!activeSearch && (
        <section className="pb-20">
          <div className="container max-w-4xl mx-auto">
            {/* How it works */}
            <div className="mb-16">
              <h2 className="text-2xl font-semibold text-foreground text-center mb-10">How It Works</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
                {[
                  { step: "01", icon: <Search className="w-5 h-5" />, label: "Search your tire size", desc: "Enter your size from the tire sidewall" },
                  { step: "02", icon: <Filter className="w-5 h-5" />, label: "Compare options", desc: "Filter by price, brand, and warranty" },
                  { step: "03", icon: <Package className="w-5 h-5" />, label: "Place your order", desc: "We confirm availability and pricing" },
                  { step: "04", icon: <Check className="w-5 h-5" />, label: "We install it", desc: "Come in and we handle the rest" },
                ].map((s) => (
                  <div key={s.step} className="text-center">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3 text-primary">
                      {s.icon}
                    </div>
                    <span className="text-xs text-primary/50 font-medium">{s.step}</span>
                    <h3 className="font-medium text-foreground text-sm mt-1">{s.label}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Trust signals */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
              {[
                { icon: <ShieldCheck className="w-6 h-6" />, title: "Honest Pricing", desc: "No hidden fees. Prices include professional mounting and balancing." },
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

            {/* Where to find tire size */}
            <div className="bg-card border border-border/30 rounded-lg p-6 mb-16">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Info className="w-5 h-5 text-primary" />
                Where to Find Your Tire Size
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                Your tire size is printed on the sidewall of your current tires. It looks like <strong className="text-foreground">215/60R16</strong> or <strong className="text-foreground">P225/65R17</strong>.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                You can also find it on the sticker inside your driver's door jamb, or in your vehicle owner's manual. Not sure? <a href="tel:2168620005" className="text-primary hover:underline">Call us</a> and we will help you find it.
              </p>
            </div>

            {/* Reviews */}
            <div className="bg-card border border-border/30 rounded-lg p-8 text-center">
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
            Mon-Sat 9AM-6PM — <a href="/" className="text-primary hover:underline">Back to Main Site</a>
          </p>
        </div>
      </footer>

      {/* ─── ORDER MODAL ─── */}
      {showOrder && (
        <OrderModal
          tire={selectedTire}
          quantity={quantity}
          serviceFee={data?.serviceFee || 35}
          onClose={() => { setShowOrder(false); setSelectedTire(null); }}
        />
      )}
    </div>
  );
}
