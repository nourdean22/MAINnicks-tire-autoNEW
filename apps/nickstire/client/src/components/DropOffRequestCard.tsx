/**
 * DropOffRequestCard — "I'm heading over" heads-up form (feat/home-v2 Wave B).
 *
 * The audit's highest-ROI capture gap: a visitor who decides to drop off
 * had NO way to tell the shop they're coming — they either called or just
 * showed up. This card turns that intent into a lead the desk can see.
 *
 * Rides the EXISTING callback pipeline end-to-end (callback.submit):
 * DB row + dedup + TCPA compliance log + instant confirmation SMS via the
 * shop line + Telegram staff alert + after-hours branch. Zero new backend.
 *
 * FCFS discipline (standing operator rule): this is a HEADS-UP, never a
 * reservation. No "hold my spot", no time slots, no promised start time —
 * the copy says so explicitly.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { trackEvent } from "@/components/SEO";
import { getUtmData } from "@/lib/utm";

export default function DropOffRequestCard() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [carAndNeed, setCarAndNeed] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.callback.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      trackEvent("form_completed", { type: "dropoff_request" });
    },
    onError: () => toast.error("Could not send. Call (216) 862-0005 and we'll expect you."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (!name.trim()) { toast.error("Add your name so the desk knows who's coming."); return; }
    if (digits.length < 10) { toast.error("Enter a 10-digit phone."); return; }
    submit.mutate({
      name: name.trim(),
      phone: phone.trim(),
      context: `Drop-off heads-up${carAndNeed.trim() ? ` — ${carAndNeed.trim().slice(0, 300)}` : ""}`,
      sourcePage: window.location.pathname + "?capture=dropoff-request",
      // Extra keys from getUtmData (gclid etc.) are stripped by zod —
      // same contract UrgencyWidget already relies on.
      ...getUtmData(),
    });
  }

  if (submitted) {
    return (
      <div className="mx-auto mt-8 max-w-xl rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center" role="status">
        <Check className="mx-auto h-7 w-7 text-emerald-400" />
        <h3 className="mt-2 text-lg font-bold text-foreground">Got it — the desk knows you're coming.</h3>
        <p className="mt-1 text-sm text-foreground/60">
          We'll text you back to confirm. Pull up whenever — the line is first come, first served.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-xl rounded-xl border border-border/50 bg-background/60 p-6">
      <div className="flex items-center gap-2.5">
        <KeyRound className="h-5 w-5 text-nick-yellow shrink-0" />
        <h3 className="font-heading text-xl font-black uppercase tracking-tight text-foreground">
          Heading over? Give us a heads-up.
        </h3>
      </div>
      <p className="mt-2 text-sm text-foreground/60">
        We'll text you back so you know we got it. This isn't a reservation — there are no
        appointment slots, just the line — but the desk will know to expect you.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          aria-label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          disabled={submit.isPending}
          className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <input
          aria-label="Phone number"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(216) 555-1234"
          disabled={submit.isPending}
          className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <input
          aria-label="Car and what it needs (optional)"
          value={carAndNeed}
          onChange={(e) => setCarAndNeed(e.target.value)}
          placeholder="Car + what it needs (optional) — e.g. 2014 Civic, brakes"
          disabled={submit.isPending}
          className="sm:col-span-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/35 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={submit.isPending}
          className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-nick-yellow px-6 py-3 font-bold text-nick-dark transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          LET THE SHOP KNOW
        </button>
      </form>
    </div>
  );
}
