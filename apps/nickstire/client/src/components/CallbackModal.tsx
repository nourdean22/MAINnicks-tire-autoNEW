/**
 * Callback Request Modal — lightweight "Call Me Back" floating button.
 * Appears on all pages. Captures name + phone only.
 * Submits to leads table with source "callback" and triggers owner notification.
 */
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PhoneCall, X, Check, Loader2 } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { ACIMA_COMPACT_DISCLOSURE } from "@/lib/acima";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export default function CallbackModal() {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // a11y: full focus trap — Tab cycles inside the dialog, Escape closes, the
  // name field is autofocused, and focus restores to the trigger on close —
  // via the shared useFocusTrap hook (same as LeadPopup). The prior hand-rolled
  // effect did Escape + autofocus + restore but NOT the Tab trap, so keyboard
  // focus escaped to the page behind this aria-modal dialog (WCAG 2.4.3 / 2.1.2).
  useFocusTrap(dialogRef, open, {
    onEscape: () => setOpen(false),
    initialFocusRef: firstFieldRef,
  });

  const mutation = trpc.callback.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setName("");
        setPhone("");
      }, 3000);
    },
    onError: () => toast.error("Couldn't request your callback. Please call us directly at (216) 862-0005."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      toast.error("Please enter a valid 10-digit phone number.");
      return;
    }
    mutation.mutate({
      name: name.trim(),
      phone: phone.trim(),
      sourcePage: window.location.pathname,
    });
  };

  return (
    <>
      {/* Floating button — bottom-right, above mobile CTA */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 lg:bottom-6 right-4 z-40 bg-primary text-primary-foreground w-14 h-14 rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
        aria-label="Request a callback"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <PhoneCall className="w-6 h-6" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="callback-modal-title"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={dialogRef} className="relative bg-nick-charcoal border border-border rounded-lg w-full max-w-sm p-6">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 p-1 text-foreground/70 hover:text-foreground transition-colors"
              aria-label="Close callback dialog"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>

            {submitted ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-6 h-6 text-green-400" aria-hidden="true" />
                </div>
                <h3 id="callback-modal-title" className="text-lg font-semibold text-foreground">We'll call you back</h3>
                <p className="text-foreground/70 text-sm mt-2">
                  Expect a call from {BUSINESS.phone.display} shortly.
                </p>
                <p className="text-[11px] text-emerald-400/60 mt-2">
                  Lease-to-own payment programs on the spot — no credit check
                </p>
                <p className="text-[10px] text-foreground/30 mt-1 leading-tight">{ACIMA_COMPACT_DISCLOSURE}</p>
              </div>
            ) : (
              <>
                <h3 id="callback-modal-title" className="text-lg font-semibold text-foreground mb-1">Request a Callback</h3>
                <p className="text-foreground/70 text-sm mb-5">
                  Leave your name and number. We'll call you back — usually within 30 minutes during business hours.
                </p>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <label htmlFor="callback-name" className="sr-only">Your name</label>
                  <input
                    ref={firstFieldRef}
                    id="callback-name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    className="w-full bg-background border border-border rounded-md px-4 py-3 text-sm text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-1 focus:ring-nick-yellow"
                  />
                  <label htmlFor="callback-phone" className="sr-only">Phone number</label>
                  <input
                    id="callback-phone"
                    type="tel"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    autoComplete="tel"
                    inputMode="tel"
                    className="w-full bg-background border border-border rounded-md px-4 py-3 text-sm text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-1 focus:ring-nick-yellow"
                  />
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full bg-primary text-primary-foreground py-3 rounded-md font-semibold text-sm hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {mutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Telling the front desk...
                      </>
                    ) : (
                      "Call Me Back"
                    )}
                  </button>
                </form>

                {mutation.isError && (
                  <p className="text-red-400 text-xs mt-2 text-center">
                    Couldn't request your callback. Please call us directly at {BUSINESS.phone.display}.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
