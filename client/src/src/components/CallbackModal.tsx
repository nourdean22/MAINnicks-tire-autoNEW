/**
 * Callback Request Modal — lightweight "Call Me Back" floating button.
 * Appears on all pages. Captures name + phone only.
 * Submits to leads table with source "callback" and triggers owner notification.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PhoneCall, X, Check, Loader2 } from "lucide-react";
import { BUSINESS } from "@shared/business";

export default function CallbackModal() {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

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
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
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
      >
        <PhoneCall className="w-6 h-6" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-nick-charcoal border border-border rounded-lg w-full max-w-sm p-6">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 text-foreground/40 hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {submitted ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">We'll call you back</h3>
                <p className="text-foreground/50 text-sm mt-2">
                  Expect a call from {BUSINESS.phone.display} shortly.
                </p>
                <p className="text-[11px] text-emerald-400/60 mt-2">
                  Payment options available including lease-to-own from $10 down
                </p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground mb-1">Request a Callback</h3>
                <p className="text-foreground/50 text-sm mb-5">
                  Leave your name and number. We'll call you back — usually within 30 minutes during business hours.
                </p>

                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full bg-background border border-border rounded-md px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-nick-yellow"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="w-full bg-background border border-border rounded-md px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-nick-yellow"
                  />
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full bg-primary text-primary-foreground py-3 rounded-md font-semibold text-sm hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {mutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Call Me Back"
                    )}
                  </button>
                </form>

                {mutation.isError && (
                  <p className="text-red-400 text-xs mt-2 text-center">
                    Something went wrong. Please call us directly at {BUSINESS.phone.display}.
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
