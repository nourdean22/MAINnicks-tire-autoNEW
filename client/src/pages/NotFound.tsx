/**
 * 404 Page with Lead Capture
 * Turns dead-end 404s into lead opportunities
 * Matches the site's dark industrial design
 */

import { useState } from "react";
import { Link } from "wouter";
import { SEOHead, trackPhoneClick } from "@/components/SEO";
import { Phone, ArrowLeft, Wrench, CheckCircle } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { trackLeadSubmission, getUserDataForCAPI } from "@/lib/metaPixel";
import { getUtmData } from "@/lib/utm";
import FadeIn from "@/components/FadeIn";

export default function NotFound() {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    problem: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;

    const eventId = trackLeadSubmission({ source: "404-page", problem: form.problem.trim() });
    const userData = getUserDataForCAPI();
    const utmData = getUtmData();

    submitLead.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      problem: form.problem.trim() || undefined,
      source: "popup",
      pixelEventId: eventId,
      pixelUserData: userData,
      ...utmData,
    });
  };

  const inputCls =
    "w-full bg-foreground/[0.04] border border-[oklch(0.17_0.004_260)] rounded-lg text-foreground px-4 py-3 text-[13px] placeholder:text-foreground/25 focus:border-primary/30 focus:outline-none transition-all";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEOHead
        title="Page Not Found | Nick's Tire & Auto Cleveland"
        description="Page not found. Tell us what you're looking for and we'll help. Get a free assessment from Nick's Tire & Auto."
        canonicalPath="/404"
      />

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-3xl">
          {/* 404 Header Section */}
          <FadeIn>
            <div className="text-center mb-12">
              {/* Big 404 */}
              <div className="relative mb-8">
                <span className="font-bold text-[10rem] sm:text-[14rem] leading-none text-border/30 select-none">
                  404
                </span>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Wrench className="w-16 h-16 sm:w-24 sm:h-24 text-primary" />
                </div>
              </div>

              <h1 className="font-bold text-3xl sm:text-4xl text-foreground tracking-tight mb-4">
                PAGE NOT FOUND
              </h1>

              <p className="text-foreground/60 text-lg max-w-md mx-auto mb-8 leading-relaxed">
                The page you are looking for may have been moved or no longer exists.
              </p>

              {/* Quick nav buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-opacity"
                >
                  <ArrowLeft className="w-4 h-4" />
                  BACK TO HOME
                </Link>
                <button
                  onClick={() => trackPhoneClick("404-page")}
                  className="inline-flex items-center justify-center gap-2 border-2 border-nick-teal/50 text-nick-teal px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:bg-nick-teal/10 hover:border-nick-teal transition-colors"
                >
                  <a href={BUSINESS.phone.href} className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    CALL {BUSINESS.phone.display}
                  </a>
                </button>
              </div>
            </div>
          </FadeIn>

          {/* Lead Capture Section */}
          <FadeIn delay={0.1}>
            <div className="mt-16 border-t border-border/50 pt-12">
              <div className="max-w-md mx-auto">
                {!submitted ? (
                  <>
                    <h2 className="font-bold text-2xl text-foreground tracking-tight mb-2 text-center">
                      Can't find what you need?
                    </h2>
                    <p className="text-foreground/50 text-center text-sm mb-8 leading-relaxed">
                      Tell us what's going on with your car and we'll call you back with an honest assessment.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <input
                        type="text"
                        placeholder="Your name *"
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        required
                        className={inputCls}
                      />
                      <input
                        type="tel"
                        placeholder="Phone number *"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        required
                        className={inputCls}
                      />
                      <textarea
                        placeholder="What's going on with your car?"
                        value={form.problem}
                        onChange={e => setForm(f => ({ ...f, problem: e.target.value }))}
                        rows={4}
                        className={`${inputCls} resize-none`}
                      />
                      <button
                        type="submit"
                        disabled={submitLead.isPending}
                        className="w-full bg-primary text-primary-foreground py-3.5 rounded-lg font-semibold text-[14px] tracking-[-0.01em] hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {submitLead.isPending ? "Submitting..." : "Get a Free Assessment"}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="py-8 text-center">
                    <CheckCircle className="w-12 h-12 text-primary mx-auto mb-4" />
                    <h3 className="font-bold text-[20px] text-foreground tracking-[-0.02em]">
                      Got it. We'll call you.
                    </h3>
                    <p className="text-foreground/40 text-[13px] mt-3 leading-relaxed">
                      Expect a call from {BUSINESS.phone.display} soon.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
