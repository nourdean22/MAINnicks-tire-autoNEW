/**
 * NonstopNickJoin — the Join card for the $7.99/mo membership (last-mile, chunk).
 *
 * One-tap-as-possible signup (friction is the enemy in a breakage/volume game):
 * just a phone number → Stripe hosted Checkout. The phone is the counter's lookup
 * key (carried as Stripe metadata → bound to the membership row by the webhook).
 *
 * Honest degrade: if Stripe isn't wired yet (no STRIPE_NONSTOP_NICK_PRICE_ID),
 * startCheckout returns a call-us message and we show the call/walk-in path —
 * true, because you CAN sign up in person. Never a fake "it worked".
 *
 * Uses a real <input> (NOT window.prompt — suppressed in iOS PWA standalone per
 * nickstire-ios-pwa-primitives).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { trackEvent } from "@/components/SEO";

/**
 * `source` = which surface sold the membership (carried as Stripe metadata
 * `signup_source` so the operator can attribute signups per page):
 * "membership_page" (/nonstop-nick, default) · "booking_page" · "tires_page".
 * Values are snake_case — PR #615 briefly renamed booking_page to
 * "booking-page", silently forking the Stripe signup_source taxonomy
 * (server docs + membership-launch.test.ts use snake_case); reverted.
 */
export default function NonstopNickJoin({ source = "membership_page" }: { source?: string } = {}) {
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState<"nonstop-nick" | "nonstop-nick-plus">("nonstop-nick");
  const [msg, setMsg] = useState<string | null>(null);
  // Stripe Checkout returns to /nonstop-nick?joined=1 — show the welcome
  // state instead of the join form. Guarded for prerender (no window there).
  const [joined] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("joined") === "1",
  );

  const start = trpc.memberships.startCheckout.useMutation({
    onSuccess: (res) => {
      if (res.url) {
        // Hand off to Stripe's hosted checkout.
        window.location.href = res.url;
      } else {
        // Honest fallback — Stripe not wired yet, or a validation message.
        setMsg(res.error || "Membership signup isn't online yet — call or text (216) 862-0005, or ask at the counter.");
      }
    },
    onError: () =>
      setMsg("Couldn't start signup right now — call or text (216) 862-0005, or ask at the counter."),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setMsg("Please enter a valid 10-digit phone number.");
      return;
    }
    trackEvent("nonstop_join_start", { source, plan });
    start.mutate({ phone: digits, plan, source });
  };

  const price = plan === "nonstop-nick-plus" ? "$9.99" : "$7.99";

  // Post-checkout welcome — Stripe redirected back with ?joined=1. The
  // webhook is creating/activating the membership row in the background;
  // nothing else for the member to do until they pull up.
  if (joined) {
    return (
      <section className="bg-[#FDB913]/[0.06] border-y border-[#FDB913]/20 py-10">
        <div className="container max-w-xl text-center">
          <CheckCircle2 className="w-10 h-10 text-[#FDB913] mx-auto mb-3" />
          <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-2">
            You're in. Pull up when you need us.
          </h2>
          <p className="text-foreground/70 text-sm mb-1">
            We'll look you up by phone at the counter — nothing to print, nothing to carry.
          </p>
          <p className="text-foreground/70 text-sm">
            First visit, we'll register your covered vehicle. Takes a second.
          </p>
          <p className="text-foreground/40 text-[12px] mt-4">
            Questions? Call or text (216) 862-0005 — 17625 Euclid Ave, Cleveland.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[#FDB913]/[0.06] border-y border-[#FDB913]/20 py-10">
      <div className="container max-w-xl text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#FDB913] mb-2">
          Join Nonstop Nick
        </p>
        <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-1">
          Pull up anytime. Pick your plan.
        </h2>
        <p className="text-foreground/60 text-sm mb-5">
          Drop your number and you're in — about a minute. Cancel any time you want.
        </p>

        {/* Two tiers — base peace-of-mind vs the fuller plan with repair savings. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 text-left">
          <button
            type="button"
            onClick={() => setPlan("nonstop-nick")}
            className={`rounded-lg border p-4 transition-colors ${plan === "nonstop-nick" ? "border-[#FDB913] bg-[#FDB913]/10" : "border-border hover:border-[#FDB913]/40"}`}
            aria-pressed={plan === "nonstop-nick"}
          >
            <p className="font-black text-foreground">$7.99<span className="text-foreground/50 text-sm font-normal">/mo</span></p>
            <p className="text-[12px] text-foreground/60 mt-1">Flats, valve stems, rotation, rim cleans, air-ups — pull up anytime.</p>
          </button>
          <button
            type="button"
            onClick={() => setPlan("nonstop-nick-plus")}
            className={`rounded-lg border p-4 transition-colors relative ${plan === "nonstop-nick-plus" ? "border-[#FDB913] bg-[#FDB913]/10" : "border-border hover:border-[#FDB913]/40"}`}
            aria-pressed={plan === "nonstop-nick-plus"}
          >
            <span className="absolute -top-2 right-3 text-[9px] font-bold tracking-wide bg-[#FDB913] text-black px-2 py-0.5 rounded">BEST VALUE</span>
            <p className="font-black text-foreground">$9.99<span className="text-foreground/50 text-sm font-normal">/mo</span></p>
            <p className="text-[12px] text-foreground/60 mt-1">Everything above <span className="text-foreground/80 font-semibold">+ 15% off any repair</span> (parts &amp; labor).</p>
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 justify-center">
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(216) 555-0123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="flex-1 max-w-xs mx-auto sm:mx-0 rounded-md border border-border bg-background px-4 py-3 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-[#FDB913]"
            aria-label="Your phone number"
          />
          <button
            type="submit"
            disabled={start.isPending}
            className="inline-flex items-center justify-center gap-1.5 bg-[#FDB913] text-black px-6 py-3 rounded-md font-bold tracking-wide hover:bg-[#FDB913]/90 transition-colors disabled:opacity-60"
          >
            {start.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
              : <>Join — {price}/mo <ChevronRight className="w-4 h-4" /></>}
          </button>
        </form>

        {msg && (
          <p className="text-foreground/70 text-sm mt-4">{msg}</p>
        )}
        <p className="text-foreground/40 text-[12px] mt-4">
          Rather do it in person? Pull up to 17625 Euclid Ave or call (216) 862-0005.
        </p>
      </div>
    </section>
  );
}
