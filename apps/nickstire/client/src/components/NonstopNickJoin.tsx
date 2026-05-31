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
import { ChevronRight, Loader2 } from "lucide-react";

export default function NonstopNickJoin() {
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

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
    start.mutate({ phone: digits });
  };

  return (
    <section className="bg-[#FDB913]/[0.06] border-y border-[#FDB913]/20 py-10">
      <div className="container max-w-xl text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#FDB913] mb-2">
          Join Nonstop Nick
        </p>
        <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-1">
          $7.99/month. Pull up anytime.
        </h2>
        <p className="text-foreground/60 text-sm mb-5">
          Drop your number and you're in — about a minute. Cancel any time you want.
        </p>

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
              : <>Join — $7.99/mo <ChevronRight className="w-4 h-4" /></>}
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
