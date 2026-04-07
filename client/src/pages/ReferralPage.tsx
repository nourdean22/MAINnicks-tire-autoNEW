/**
 * /refer — Referral Program page
 * Refer a friend, both get $25 off.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Users, Gift, CheckCircle, Heart } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

export default function ReferralPage() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    referrerName: "", referrerPhone: "", referrerEmail: "",
    refereeName: "", refereePhone: "", refereeEmail: "",
  });

  const submitReferral = trpc.referrals.submit.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Something went wrong. Please try again."),
  });

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitReferral.mutate({
      ...form,
      referrerEmail: form.referrerEmail || undefined,
      refereeEmail: form.refereeEmail || undefined,
    });
  };

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Refer a Friend — Save $25 | Nick's Tire & Auto"
        description="Refer a friend to Nick's Tire & Auto and you both get $25 off your next service. Real rewards for real trust. Cleveland, Ohio."
        canonicalPath="/refer"
      />
      
      
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Refer a Friend" }]} />
      <LocalBusinessSchema />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <Heart className="w-6 h-6 text-primary" />
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Referral Program</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                REFER A FRIEND<br />
                <span className="text-primary">BOTH SAVE $25</span>
              </h1>
              <p className="mt-6 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Know someone who needs honest auto repair? Send them our way and you both get $25 off your next service. No gimmicks — just real rewards for real trust.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-12 lg:py-16 bg-[oklch(0.055_0.004_260)]">
          <div className="hidden" />
          <div className="container pt-12">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight text-center mb-10">
                HOW IT <span className="text-primary">WORKS</span>
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {[
                { num: "01", icon: <Users className="w-8 h-8" />, title: "Fill Out the Form", desc: "Enter your info and your friend's info below. Takes 30 seconds." },
                { num: "02", icon: <Gift className="w-8 h-8" />, title: "Friend Visits the Shop", desc: "When your friend comes in for service, we apply their $25 discount automatically." },
                { num: "03", icon: <CheckCircle className="w-8 h-8" />, title: "You Get $25 Off Too", desc: "After your friend's first visit, you get $25 off your next service. We will call you." },
              ].map((step, i) => (
                <FadeIn key={step.num} delay={i * 0.1}>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-primary/10 flex items-center justify-center rounded-md mx-auto mb-4 text-primary">
                      {step.icon}
                    </div>
                    <span className="font-semibold font-bold text-4xl text-primary/20">{step.num}</span>
                    <h3 className="font-semibold font-bold text-foreground text-lg tracking-wide mt-2">{step.title}</h3>
                    <p className="text-foreground/60 mt-2 leading-relaxed text-sm">{step.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Referral Form */}
        <section className="py-12 lg:py-16 bg-background">
          <div className="container max-w-2xl">
            {submitted ? (
              <FadeIn>
                <div className="text-center py-16">
                  <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
                  <h2 className="font-semibold font-bold text-3xl text-foreground tracking-[-0.01em] mb-4">REFERRAL SUBMITTED</h2>
                  <p className="text-foreground/70 text-lg leading-relaxed mb-8">
                    Thank you for the referral. When your friend visits, you will both receive $25 off. We will reach out to confirm.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button onClick={() => { setSubmitted(false); setForm({ referrerName: "", referrerPhone: "", referrerEmail: "", refereeName: "", refereePhone: "", refereeEmail: "" }); }} className="bg-primary text-primary-foreground px-6 py-3 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors">
                      REFER ANOTHER FRIEND
                    </button>
                    <Link href="/" className="border border-foreground/30 text-foreground px-6 py-3 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors text-center">
                      BACK TO HOME
                    </Link>
                  </div>
                </div>
              </FadeIn>
            ) : (
              <FadeIn>
                <h2 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-6">SUBMIT YOUR REFERRAL</h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Your Info */}
                  <div>
                    <h3 className="font-semibold font-bold text-nick-blue-light text-sm tracking-wide mb-4">YOUR INFORMATION</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Your Name *</label>
                        <input type="text" required value={form.referrerName} onChange={(e) => setForm({ ...form, referrerName: e.target.value })} className="w-full bg-background/50 border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Your Phone *</label>
                        <input type="tel" required value={form.referrerPhone} onChange={(e) => setForm({ ...form, referrerPhone: e.target.value })} className="w-full bg-background/50 border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-foreground/60 text-sm mb-1">Your Email (optional)</label>
                      <input type="email" value={form.referrerEmail} onChange={(e) => setForm({ ...form, referrerEmail: e.target.value })} className="w-full bg-background/50 border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                    </div>
                  </div>

                  {/* Friend's Info */}
                  <div>
                    <h3 className="font-semibold font-bold text-nick-blue-light text-sm tracking-wide mb-4">YOUR FRIEND'S INFORMATION</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Friend's Name *</label>
                        <input type="text" required value={form.refereeName} onChange={(e) => setForm({ ...form, refereeName: e.target.value })} className="w-full bg-background/50 border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Friend's Phone *</label>
                        <input type="tel" required value={form.refereePhone} onChange={(e) => setForm({ ...form, refereePhone: e.target.value })} className="w-full bg-background/50 border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-foreground/60 text-sm mb-1">Friend's Email (optional)</label>
                      <input type="email" value={form.refereeEmail} onChange={(e) => setForm({ ...form, refereeEmail: e.target.value })} className="w-full bg-background/50 border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                    </div>
                  </div>

                  <p className="text-foreground/40 text-xs">
                    By submitting, you confirm your friend is aware of the referral. Both parties receive $25 off services of $75 or more.
                  </p>

                  <button type="submit" disabled={submitReferral.isPending} className="w-full bg-primary text-primary-foreground py-3.5 font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors disabled:opacity-50">
                    {submitReferral.isPending ? "SUBMITTING..." : "SUBMIT REFERRAL"}
                  </button>
                </form>
              </FadeIn>
            )}
          </div>
        </section>

        {/* Footer */}
        

    
      <InternalLinks />
</PageLayout>
  );
}
