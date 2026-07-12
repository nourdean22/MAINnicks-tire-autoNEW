/**
 * TireOrderModal — the shared tire-order + Stripe-checkout modal.
 * Extracted 2026-07-11 from TireFinderLegacy so the LIVE V2 funnel no
 * longer imports checkout code from a file named "Legacy". Pure move —
 * behavior is unchanged (locked by tire-finder OrderModal tests).
 */
import { useEffect, useRef, useState } from "react";
import { Check, Clock, Gift, Loader2, Wrench, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { trackEvent } from "@/components/SEO";
import { getSessionId } from "@/lib/session";
import { getUtmData } from "@/lib/utm";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";

function priceBreakdown(subtotalCents: number) {
  const tax = Math.round(subtotalCents * 0.08);
  const cardFee = Math.round((subtotalCents + tax) * 0.02);
  return { subtotal: subtotalCents, tax, cardFee, total: subtotalCents + tax + cardFee };
}

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
  packageValue: number;
  onClose: () => void;
  prefilledVehicle?: {
    year: string;
    make: string;
    model: string;
    option: string;
    speeds: string;
  } | null;
}

export function OrderModal({ tire, quantity, packageValue, onClose, prefilledVehicle }: OrderModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicleYear, setVehicleYear] = useState(prefilledVehicle?.year || "");
  const [vehicleMake, setVehicleMake] = useState(prefilledVehicle?.make || "");
  const [vehicleModel, setVehicleModel] = useState(prefilledVehicle?.model || "");
  const [vehicleOption, setVehicleOption] = useState(prefilledVehicle?.option || "");
  const [tireSize, setTireSize] = useState(tire?.size || "");
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"walk-in" | "drop-off-morning" | "drop-off-afternoon" | "ship">("walk-in");
  const [shippingAddress, setShippingAddress] = useState("");
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; invoiceNumber?: string; totalAmount: number } | null>(null);
  const [paymentSubmitted] = useState(false);

  useEffect(() => {
    if (prefilledVehicle) {
      setVehicleYear(prefilledVehicle.year);
      setVehicleMake(prefilledVehicle.make);
      setVehicleModel(prefilledVehicle.model);
      setVehicleOption(prefilledVehicle.option);
    }
  }, [prefilledVehicle]);

  useEffect(() => {
    if (tire?.size) {
      setTireSize(tire.size);
    }
  }, [tire]);

  const trackPartialOrder = () => {
    const phoneDigits = phone.replace(/\D/g, "");
    if (!phoneDigits && !name.trim()) return;

    const formattedVehicle = [
      vehicleYear.trim(),
      vehicleMake.trim(),
      vehicleModel.trim(),
      vehicleOption.trim() ? `(${vehicleOption.trim()})` : ""
    ].filter(Boolean).join(" ");

    const payload = JSON.stringify({
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      service: `Tire Order: ${quantity}x ${tire?.brand || "Custom"} ${tire?.model || "Request"} (${tireSize || tire?.size || "Unknown"})`,
      vehicle: formattedVehicle || undefined,
      formType: "tire_order",
      step: "order_modal_blur",
      sessionId: getSessionId(),
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track-abandoned", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/track-abandoned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  };

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedTrackPartialOrder = () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      trackPartialOrder();
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const orderMutation = trpc.gatewayTire.placeOrder.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setOrderResult({ orderNumber: data.orderNumber!, invoiceNumber: data.invoiceNumber, totalAmount: data.totalAmount! });
        trackEvent("form_completed", { type: "tire_order", orderNumber: data.orderNumber! });
      } else {
        toast.error("Something went wrong. Please call us at (216) 862-0005.");
      }
    },
    onError: () => toast.error("Something went wrong. Please call us at (216) 862-0005."),
  });

  // Online payment — opens Stripe's hosted checkout in this tab.
  const checkoutMutation = trpc.gatewayTire.createCheckout.useMutation({
    onSuccess: (data) => {
      if ("url" in data && data.url) {
        window.location.href = data.url;
      } else {
        const msg = "error" in data ? data.error : "Couldn't start checkout.";
        toast.error(`${msg} You can also call (216) 862-0005 to pay.`);
      }
    },
    onError: () => toast.error("Couldn't start checkout. Please call (216) 862-0005 to pay."),
  });

  // Escape closes the modal — standard keyboard/a11y expectation. Was
  // missing; only the X button and backdrop click closed the modal.
  // Direct browser audit found it. Registered globally on `window` so
  // it works whether or not focus is inside the modal form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tirePrice = tire ? tire.shopPrice : 0;
  const tirePriceCents = tire ? tire.pricePerTireCents : 0;
  const tireBrandName = tire ? tire.brand : "Custom Request";
  const tireModelName = tire ? tire.model : "Vehicle Fitment";

  const tireTotal = tirePrice * quantity;
  const bd = priceBreakdown(tirePriceCents * quantity);

  // Success state
  if (orderResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-card border border-border/50 rounded-lg p-6 sm:p-8 max-w-xl w-full max-h-[90vh] overflow-y-auto"
        >
          <button onClick={onClose} aria-label="Close" title="Close" className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>

          <h3 className="text-2xl font-bold text-foreground mb-1 text-center">Tire Request Submitted</h3>
          <p className="text-xs text-muted-foreground mb-6 text-center">
            Order <span className="font-mono text-primary font-semibold">#{orderResult.orderNumber}</span>
            {orderResult.invoiceNumber && ` · Invoice ${orderResult.invoiceNumber}`}
          </p>

          {/* 4-Step Vertical Timeline */}
          <div className="text-left space-y-6 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-border/30 mb-8 pl-1">
            
            {/* Step 1: Request Received */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center shrink-0 z-10">
                <Check className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">1. Request Received</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  We've received your request for {quantity}x {tireBrandName} {tireModelName} ({tireSize || "Unknown"}).
                </p>
              </div>
            </div>

            {/* Step 2: Staff Check */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 z-10">
                <Clock className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">2. Staff Confirms Availability & Fitment</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Nick's team is verifying local and warehouse stock. We will text or call you to confirm everything.
                </p>
                <p className="text-[10px] text-amber-500/95 font-medium mt-1">
                  No supplier reservation is guaranteed until staff confirms availability.
                </p>
              </div>
            </div>

            {/* Step 3: Pay Online (Optional) */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 z-10">
                <Gift className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-foreground">3. Pay Online (Optional) or Pay at Shop</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Prepaying locks in your order once confirmed, though payment does not guarantee supplier reservation. Otherwise, pay at the counter during your visit.
                </p>
                
                {/* Stripe Pay Now / Financing CTAs */}
                {!paymentSubmitted && (
                  <div className="mt-3 bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                    {tire && tire.shopPrice > 0 ? (
                      <>
                        <button
                          onClick={() => checkoutMutation.mutate({ orderNumber: orderResult.orderNumber, phone })}
                          disabled={checkoutMutation.isPending}
                          className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground py-2.5 rounded-md text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {checkoutMutation.isPending ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting secure checkout…</>
                          ) : (
                            <>Pay Now — ${(bd.total / 100).toFixed(2)}</>
                          )}
                        </button>
                        <p className="text-[9px] text-muted-foreground text-center">
                          Secure card payment via Stripe. Cards carry a 2% surcharge.
                        </p>
                        
                        <div className="border-t border-border/20 pt-3">
                          <p className="text-[10px] text-muted-foreground mb-2 text-center font-medium">Or apply for Snap/Acima payment programs:</p>
                          <div className="flex gap-2">
                            <a
                              href="https://getsnap.snapfinance.com/lease/en-US/consumer/apply?ep=store-locator&merchantId=490295617&externalMerchantId=77661"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-center bg-[#FF6B00] text-white py-2 rounded-md text-xs font-medium hover:bg-[#FF6B00]/90 transition-colors"
                            >
                              Snap Finance
                            </a>
                            <a
                              href="https://acima.us/1TjEOYtr6C"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-center bg-blue-600 text-white py-2 rounded-md text-xs font-medium hover:bg-blue-600/90 transition-colors"
                            >
                              Acima
                            </a>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-amber-500/90 font-medium text-center py-2">
                        Online payment will be available once staff confirms pricing.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Step 4: Visit Shop */}
            <div className="relative flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 z-10">
                <Wrench className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">4. Visit Shop for Installation</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {deliveryMethod === "ship"
                    ? "We'll confirm availability and contact you with shipping cost. Payment required before shipping."
                    : deliveryMethod.startsWith("drop-off")
                    ? "We'll confirm availability and contact you. Drop off your vehicle and we'll get it done — drop-offs are worked first come, first serve."
                    : "We'll confirm availability and contact you. Walk in anytime we're open — first come first serve!"}
                </p>
              </div>
            </div>

          </div>

          {/* Pricing Summary */}
          <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{quantity}x {tireBrandName} {tireModelName}</span>
              <span className="text-foreground font-medium">
                {tire && tire.shopPrice > 0 ? `$${(bd.subtotal / 100).toFixed(2)}` : "Pending confirmation"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ohio sales tax (8%)</span>
              <span className="text-foreground">
                {tire && tire.shopPrice > 0 ? `$${(bd.tax / 100).toFixed(2)}` : "Pending confirmation"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Card processing fee (2%)</span>
              <span className="text-foreground">
                {tire && tire.shopPrice > 0 ? `$${(bd.cardFee / 100).toFixed(2)}` : "Pending confirmation"}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border/30">
              <span className="font-medium text-foreground">Total Estimate</span>
              <span className="font-semibold text-primary">
                {tire && tire.shopPrice > 0 ? `$${(bd.total / 100).toFixed(2)}` : "Price Pending Confirmation"}
              </span>
            </div>
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
        <button onClick={onClose} aria-label="Close" title="Close" className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-semibold text-foreground mb-1">Request Tires</h3>
        <p className="text-muted-foreground text-sm mb-6">{quantity}x {tireBrandName} {tireModelName} {tireSize ? `(${tireSize})` : ""}</p>

        {/* Price breakdown — the psychology */}
        <div className="bg-background/50 border border-border/30 rounded-md p-4 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">{tireBrandName} {tireModelName} x{quantity}</span>
            <span className="text-foreground font-medium">{tire && tire.shopPrice > 0 ? `$${tireTotal.toFixed(2)}` : "Pending confirmation"}</span>
          </div>

          {/* FREE package — this is the genius part */}
          <div className="border-t border-border/20 mt-2 pt-2 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Professional Mounting x{quantity}</span>
              <span className="text-green-400 font-medium line-through-none">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Computer Balancing x{quantity}</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">New Valve Stems x{quantity}</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tire Disposal & Recycling x{quantity}</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">TPMS Sensor Reset</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">20-Point Safety Inspection</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Alignment Check</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">1-Year Free Rotation & Flat Repair</span>
              <span className="text-green-400 font-medium">Included</span>
            </div>
          </div>

          <div className="border-t border-border/30 mt-3 pt-3 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Installation package value</span>
              <span className="line-through">${packageValue}+</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tires x{quantity}</span>
              <span className="text-foreground">{tire && tire.shopPrice > 0 ? `$${(bd.subtotal / 100).toFixed(2)}` : "Pending confirmation"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ohio sales tax (8%)</span>
              <span className="text-foreground">{tire && tire.shopPrice > 0 ? `$${(bd.tax / 100).toFixed(2)}` : "Pending confirmation"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Card processing fee (2%)</span>
              <span className="text-foreground">{tire && tire.shopPrice > 0 ? `$${(bd.cardFee / 100).toFixed(2)}` : "Pending confirmation"}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-border/20">
              <span className="font-medium text-foreground">Estimated Total</span>
              <span className="font-semibold text-primary text-lg">{tire && tire.shopPrice > 0 ? `$${(bd.total / 100).toFixed(2)}` : "Price Pending Confirmation"}</span>
            </div>
            <p className="text-[10px] text-green-400 text-right font-medium">
              You save ${packageValue}+ on installation
            </p>
          </div>
        </div>

        {/* Install / Delivery Method */}
        <div className="mb-6">
          <label className="block text-sm text-muted-foreground mb-2">How do you want your tires installed?</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "walk-in" as const, icon: "🏪", title: "Walk In", desc: "Come anytime we're open", note: "Included" },
              { id: "drop-off-morning" as const, icon: "🌅", title: "Drop Off AM", desc: "Leave it before noon", note: "Included" },
              { id: "drop-off-afternoon" as const, icon: "🌇", title: "Drop Off PM", desc: "Leave it afternoon", note: "Included" },
              { id: "ship" as const, icon: "📦", title: "Ship to Me", desc: "We ship to your door", note: "Shipping extra" },
            ]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setDeliveryMethod(opt.id)}
                className={`p-3 rounded-md border text-left transition-colors ${
                  deliveryMethod === opt.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:border-border"
                }`}
              >
                <div className="font-medium text-sm">{opt.icon} {opt.title}</div>
                <div className="text-[11px] mt-0.5 opacity-70">{opt.desc}</div>
                <div className={`text-[11px] mt-1 font-medium ${opt.id === "ship" ? "text-muted-foreground" : "text-green-400"}`}>{opt.note}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Full Name *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Phone Number *</label>
            <input
              type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder={BUSINESS.phone.placeholder}
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Email (for order updates)</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
              placeholder="john@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Vehicle Year *</label>
              <input
                type="text"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="2020"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Vehicle Make *</label>
              <input
                type="text"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="Honda"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Vehicle Model *</label>
              <input
                type="text"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="Civic"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Option / Trim (optional)</label>
              <input
                type="text"
                value={vehicleOption}
                onChange={(e) => setVehicleOption(e.target.value)}
                onBlur={debouncedTrackPartialOrder}
                className="w-full bg-background border border-border/50 rounded-md px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors"
                placeholder="LX / EX"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Tire Size *</label>
            <input
              type="text"
              value={tireSize}
              onChange={(e) => setTireSize(e.target.value)}
              onBlur={debouncedTrackPartialOrder}
              disabled={!!tire}
              className={`w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors ${
                tire ? "opacity-60 cursor-not-allowed bg-muted/10" : ""
              }`}
              placeholder="e.g. 215/60R16"
            />
          </div>
          {deliveryMethod === "ship" && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">Shipping Address *</label>
              <textarea
                value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} rows={2}
                className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none"
                placeholder="123 Main St, Cleveland, OH 44112"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Prepayment required for shipping. We'll contact you with shipping cost before charging.</p>
            </div>
          )}
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">Notes (optional)</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-primary/50 transition-colors resize-none"
              placeholder={deliveryMethod === "ship" ? "Any special shipping instructions..." : "Preferred day/time for installation..."}
            />
          </div>
        </div>

        <button
          onClick={() => {
            const formattedVehicle = [
              vehicleYear.trim(),
              vehicleMake.trim(),
              vehicleModel.trim(),
              vehicleOption.trim() ? `(${vehicleOption.trim()})` : ""
            ].filter(Boolean).join(" ");

            const phoneDigits = phone.replace(/\D/g, "");
            if (!name.trim() || phoneDigits.length < 10) {
              toast.error(!name.trim() ? "Name is required." : "Please enter a valid 10-digit phone number");
              return;
            }
            if (!vehicleYear.trim() || !vehicleMake.trim() || !vehicleModel.trim()) {
              toast.error("Vehicle Year, Make, and Model are required.");
              return;
            }
            if (!tireSize.trim()) {
              toast.error("Tire Size is required.");
              return;
            }
            if (deliveryMethod === "ship" && !shippingAddress.trim()) {
              toast.error("Shipping address is required for delivery orders.");
              return;
            }
            if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
              toast.error("That email doesn't look right — fix it or leave it blank.");
              return;
            }
            const deliveryNote = deliveryMethod === "ship"
              ? `[SHIP TO: ${shippingAddress.trim()}] ${notes.trim()}`
              : notes.trim();
            orderMutation.mutate({
              tireBrand: tireBrandName,
              tireModel: tireModelName,
              tireSize: tireSize.trim(),
              quantity,
              pricePerTireCents: tirePriceCents,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              customerEmail: email.trim() || undefined,
              vehicleInfo: formattedVehicle || undefined,
              customerNotes: deliveryNote || undefined,
              installPreference: deliveryMethod,
              ...getUtmData(),
            });
          }}
          disabled={orderMutation.isPending}
          className="w-full mt-6 bg-primary text-primary-foreground py-3.5 rounded-md font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {orderMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Requesting Tires...</>
          ) : (tire && tire.shopPrice > 0) ? (
            <>Request These Tires — ${(bd.total / 100).toFixed(2)}</>
          ) : (
            <>Request Price Confirmation</>
          )}
        </button>

        {/* Merge: #41's 3-line structure + this wave's pay-at-the-shop
            option clarity. */}
        <div className="text-xs text-muted-foreground text-center mt-4 space-y-1">
          <p>No card required to request — paying online afterward is optional, or pay at the shop.</p>
          <p>Staff will confirm availability and fitment before final shop hand-off.</p>
          <p className="text-amber-500/80">Gateway/D&K availability can change until staff confirms.</p>
        </div>
      </motion.div>
    </div>
  );
}
