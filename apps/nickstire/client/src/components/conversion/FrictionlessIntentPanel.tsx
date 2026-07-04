/**
 * FrictionlessIntentPanel — the fast lane past the Year/Make/Model maze.
 *
 * Two zero-friction paths to a live quote:
 *  1. Text "TIRE" to the shop line — opens the phone's SMS composer
 *     pre-filled (the single lowest-friction action on a phone).
 *  2. License plate + phone → trpc.lead.submit. That pipeline already
 *     writes the pending lead row, fires the owner's Telegram alert,
 *     and texts the customer a confirmation — no bespoke endpoint.
 *
 * iOS-PWA rule: no window.confirm/alert/prompt anywhere in here —
 * validation feedback goes through sonner toasts, success state is
 * in-DOM (see nickstire-ios-pwa-primitives).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getUtmData } from "@/lib/utm";
import { trackEvent } from "@/components/SEO";
import { BUSINESS } from "@shared/business";
import { CheckCircle2, Loader2, MessageSquareText, Zap } from "lucide-react";

// sms: URI with a prefilled body — the `?&body=` form works on both iOS
// and Android (iOS ignores a bare `?body=` on some versions).
const SMS_QUOTE_HREF = "sms:+12168620005?&body=TIRE";

export default function FrictionlessIntentPanel() {
  const [plate, setPlate] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const quoteMutation = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      trackEvent("form_completed", { type: "tire_plate_quote" });
    },
    onError: () =>
      toast.error(`Couldn't send your request. Call or text us at ${BUSINESS.phone.display}.`),
  });

  const handleSubmit = () => {
    const phoneDigits = phone.replace(/\D/g, "");
    if (!name.trim()) {
      toast.error("Your name is required.");
      return;
    }
    if (phoneDigits.length < 10) {
      toast.error("Please enter a valid 10-digit phone number.");
      return;
    }
    if (!plate.trim()) {
      toast.error("Enter your license plate so we can look up your exact fitment.");
      return;
    }
    quoteMutation.mutate({
      name: name.trim(),
      phone: phone.trim(),
      vehicle: `Plate: ${plate.trim().toUpperCase()}`,
      problem: `TIRE QUOTE (plate lookup) — plate ${plate.trim().toUpperCase()}. Customer wants a live tire quote; look up fitment and text back within 5 minutes.`,
      source: "popup",
      ...getUtmData(),
    });
  };

  return (
    <section
      aria-label="Get a live tire quote fast"
      className="bg-linear-to-br from-primary/10 via-card to-card border border-primary/25 rounded-xl p-6 sm:p-8 text-left"
    >
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4 text-primary" />
        <span className="text-[10px] font-semibold text-primary tracking-[0.15em] uppercase">
          Skip the menus — quote in under 5 minutes
        </span>
      </div>
      <h2 className="text-xl sm:text-2xl font-semibold text-foreground mt-1">
        Don't know your tire size? You don't need to.
      </h2>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
        A real person at the shop pulls your exact fitment and texts you a straight quote —
        tire, install, taxes, everything. Two ways in:
      </p>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Path 1: text TIRE */}
        <a
          href={SMS_QUOTE_HREF}
          onClick={() => trackEvent("sms_quote_click", { source: "tires_intent_panel" })}
          className="group flex flex-col justify-between bg-primary text-primary-foreground rounded-lg p-5 hover:bg-primary/90 transition-colors min-h-[48px]"
        >
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="w-5 h-5" />
              <span className="text-sm font-bold uppercase tracking-wide">Fastest</span>
            </div>
            <p className="text-lg font-extrabold mt-2 leading-snug">
              Text “TIRE” to {BUSINESS.phone.display}
            </p>
            <p className="text-xs mt-1.5 opacity-80 leading-relaxed">
              Tap to open your messages pre-filled. A human — not a bot queue — replies with a
              live quote, usually in under 5 minutes during shop hours.
            </p>
          </div>
          <span className="mt-4 text-xs font-semibold underline underline-offset-2 group-hover:no-underline">
            Open Messages →
          </span>
        </a>

        {/* Path 2: plate lookup */}
        <div className="bg-background/60 border border-border/30 rounded-lg p-5">
          {submitted ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-2" />
              <p className="text-sm font-semibold text-foreground">On it. Watch your texts.</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                We're looking up your fitment now and will text your quote to {phone || "your phone"}.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground">Or: plate lookup</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                Your plate tells us the exact factory tire size — no door-jamb sticker hunting.
              </p>
              <div className="space-y-2.5">
                <div>
                  <label htmlFor="intent-plate" className="sr-only">License plate</label>
                  <input
                    id="intent-plate"
                    type="text"
                    value={plate}
                    onChange={(e) => setPlate(e.target.value)}
                    placeholder="License plate (e.g. HXK4821)"
                    autoCapitalize="characters"
                    maxLength={10}
                    className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-sm text-foreground font-mono tracking-widest uppercase focus:outline-none focus:border-primary/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="intent-name" className="sr-only">Your name</label>
                    <input
                      id="intent-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Name"
                      className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label htmlFor="intent-phone" className="sr-only">Phone number</label>
                    <input
                      id="intent-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Phone"
                      className="w-full bg-background border border-border/50 rounded-md px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={quoteMutation.isPending}
                  className="w-full bg-foreground text-background py-3 rounded-md font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px]"
                >
                  {quoteMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  ) : (
                    "Text Me My Quote"
                  )}
                </button>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  We only use your plate to decode the factory tire size. One quote text — no spam,
                  no list.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
