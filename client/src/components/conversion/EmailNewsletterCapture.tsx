/**
 * EmailNewsletterCapture — slim email capture for the footer area.
 *
 * Submits to trpc.lead.submit with source="newsletter". Real submission;
 * server can decide whether to wire it through to a list provider later.
 *
 * Lead-magnet promise: "Cleveland Driver's Tip Sheet" (a free 1-page PDF
 * sent on signup). The promise is concrete and deliverable — not a vague
 * "newsletter" tease that fails the reciprocity test.
 */

import { useState, useCallback } from "react";
import { Mail, Loader2, CheckCircle, FileDown } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function EmailNewsletterCapture() {
  const [email, setEmail] = useState("");
  const [zip, setZip] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setError(null);
    },
    onError: () => {
      setError("Couldn't sign you up — try again or skip.");
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedEmail = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError("Email doesn't look right — double-check?");
        return;
      }
      mutation.mutate({
        // lead.submit requires name + phone — for newsletter we supply
        // synthetic placeholders so the schema validates while the real
        // signal (email + zip + source) flows through.
        name: "Newsletter signup",
        phone: "0000000000",
        email: trimmedEmail,
        problem: zip ? `Newsletter signup · ZIP ${zip.trim()}` : "Newsletter signup",
        source: "newsletter",
      });
    },
    [email, zip, mutation]
  );

  if (submitted) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-start gap-3">
        <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">You're in.</p>
          <p className="text-xs text-foreground/65 mt-0.5 leading-relaxed">
            We'll send the Cleveland Driver's Tip Sheet within the hour. One email a week after that. Fewer if nothing's worth saying.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-card/40 p-5">
      <div className="flex items-center gap-2 mb-2">
        <FileDown className="w-4 h-4 text-primary" />
        <span className="text-[11px] uppercase tracking-[0.18em] font-bold text-primary">
          Free · Cleveland Driver's Tip Sheet
        </span>
      </div>
      <h3 className="font-semibold text-foreground text-base leading-tight mb-1">
        One car-care tip a week. Cleveland-specific. No spam.
      </h3>
      <p className="text-foreground/55 text-[13px] leading-relaxed mb-4">
        Pothole season, salt damage, winter prep, summer AC — the things that strand drivers on the East Side. Sign up and we'll email you the tip sheet right away.
      </p>
      <form onSubmit={handleSubmit} className="space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-2">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="next"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-card/60 border border-border/40 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:outline-none transition-colors"
            required
          />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            enterKeyHint="send"
            pattern="[0-9]*"
            maxLength={5}
            placeholder="ZIP"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
            className="bg-card/60 border border-border/40 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary/50 focus:outline-none transition-colors text-center"
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-bold text-sm uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Reserving your tip sheet...
            </>
          ) : (
            <>
              <Mail className="w-4 h-4" />
              Send Me the Tip Sheet
            </>
          )}
        </button>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <p className="text-foreground/35 text-[10px] leading-relaxed">
          We won't sell your email. Unsubscribe links in every send. ZIP helps us keep tips relevant to your area's road conditions.
        </p>
      </form>
    </div>
  );
}
