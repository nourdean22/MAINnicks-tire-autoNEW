/**
 * /refer — Referral Program page
 * Refer a friend, both get $25 off.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import NotificationBar from "@/components/NotificationBar";
import SearchBar from "@/components/SearchBar";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Menu, X, Users, Gift, ChevronRight, CheckCircle, Heart } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

function ReferNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [
    { label: "Services", href: "/#services" },
    { label: "About", href: "/about" },
    { label: "Reviews", href: "/reviews" },
    { label: "Specials", href: "/specials" },
    { label: "Contact", href: "/contact" },
  ];
  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-lg shadow-nick-yellow/5" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-nick-yellow flex items-center justify-center rounded-md glow-yellow"><span className="font-heading font-bold text-nick-dark text-lg">N</span></div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-nick-yellow text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-nick-teal text-xs tracking-widest uppercase font-medium">Cleveland, Ohio</span>
          </div>
        </Link>
        <div className="hidden lg:flex items-center gap-6">
          <SearchBar />
          {links.map((l) => (<Link key={l.href} href={l.href} className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-nick-yellow transition-colors">{l.label}</Link>))}
          <a href="tel:2168620005" className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-5 py-2.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow"><Phone className="w-4 h-4" />(216) 862-0005</a>
        </div>
        <div className="lg:hidden flex items-center gap-1">
          <SearchBar />
          <button onClick={() => setMobileOpen(!mobileOpen)} className="text-foreground p-2">{mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
        </div>
      </div>
      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-t border-nick-yellow/20">
          <div className="container py-6 flex flex-col gap-4">
            {links.map((l) => (<Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-nick-yellow transition-colors py-2">{l.label}</Link>))}
          </div>
        </div>
      )}
    </nav>
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
    <div className="min-h-screen flex flex-col">
      <SEOHead
        title="Refer a Friend — Both Save $25 | Nick's Tire & Auto Cleveland"
        description="Refer a friend to Nick's Tire & Auto and you both get $25 off your next service. Real rewards for real trust. Cleveland, Ohio."
        canonicalPath="/refer"
      />
      <SkipToContent />
      <NotificationBar />
      <ReferNavbar />

      <main id="main-content">
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Refer a Friend" }]} />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <Heart className="w-6 h-6 text-nick-yellow" />
                <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Referral Program</span>
              </div>
              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                REFER A FRIEND<br />
                <span className="text-gradient-yellow">BOTH SAVE $25</span>
              </h1>
              <p className="mt-6 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Know someone who needs honest auto repair? Send them our way and you both get $25 off your next service. No gimmicks — just real rewards for real trust.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-12 lg:py-16 section-darker">
          <div className="caution-stripe h-2 w-full" />
          <div className="container pt-12">
            <FadeIn>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground tracking-tight text-center mb-10">
                HOW IT <span className="text-gradient-yellow">WORKS</span>
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
                    <div className="w-16 h-16 bg-nick-yellow/10 flex items-center justify-center rounded-md mx-auto mb-4 text-nick-yellow">
                      {step.icon}
                    </div>
                    <span className="font-heading font-bold text-4xl text-nick-yellow/20">{step.num}</span>
                    <h3 className="font-heading font-bold text-foreground text-lg tracking-wider uppercase mt-2">{step.title}</h3>
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
                  <CheckCircle className="w-16 h-16 text-nick-yellow mx-auto mb-6" />
                  <h2 className="font-heading font-bold text-3xl text-foreground tracking-wider mb-4">REFERRAL SUBMITTED</h2>
                  <p className="text-foreground/70 text-lg leading-relaxed mb-8">
                    Thank you for the referral. When your friend visits, you will both receive $25 off. We will reach out to confirm.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button onClick={() => { setSubmitted(false); setForm({ referrerName: "", referrerPhone: "", referrerEmail: "", refereeName: "", refereePhone: "", refereeEmail: "" }); }} className="bg-nick-yellow text-nick-dark px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors">
                      REFER ANOTHER FRIEND
                    </button>
                    <Link href="/" className="border border-foreground/30 text-foreground px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors text-center">
                      BACK TO HOME
                    </Link>
                  </div>
                </div>
              </FadeIn>
            ) : (
              <FadeIn>
                <h2 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-6">SUBMIT YOUR REFERRAL</h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Your Info */}
                  <div>
                    <h3 className="font-heading font-bold text-nick-teal text-sm tracking-widest uppercase mb-4">YOUR INFORMATION</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Your Name *</label>
                        <input type="text" required value={form.referrerName} onChange={(e) => setForm({ ...form, referrerName: e.target.value })} className="w-full bg-nick-dark/50 border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Your Phone *</label>
                        <input type="tel" required value={form.referrerPhone} onChange={(e) => setForm({ ...form, referrerPhone: e.target.value })} className="w-full bg-nick-dark/50 border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-foreground/60 text-sm mb-1 font-mono">Your Email (optional)</label>
                      <input type="email" value={form.referrerEmail} onChange={(e) => setForm({ ...form, referrerEmail: e.target.value })} className="w-full bg-nick-dark/50 border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                    </div>
                  </div>

                  {/* Friend's Info */}
                  <div>
                    <h3 className="font-heading font-bold text-nick-teal text-sm tracking-widest uppercase mb-4">YOUR FRIEND'S INFORMATION</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Friend's Name *</label>
                        <input type="text" required value={form.refereeName} onChange={(e) => setForm({ ...form, refereeName: e.target.value })} className="w-full bg-nick-dark/50 border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Friend's Phone *</label>
                        <input type="tel" required value={form.refereePhone} onChange={(e) => setForm({ ...form, refereePhone: e.target.value })} className="w-full bg-nick-dark/50 border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                      </div>
                    </div>
                    <div className="mt-4">
                      <label className="block text-foreground/60 text-sm mb-1 font-mono">Friend's Email (optional)</label>
                      <input type="email" value={form.refereeEmail} onChange={(e) => setForm({ ...form, refereeEmail: e.target.value })} className="w-full bg-nick-dark/50 border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                    </div>
                  </div>

                  <p className="text-foreground/40 text-xs">
                    By submitting, you confirm your friend is aware of the referral. Both parties receive $25 off services of $75 or more.
                  </p>

                  <button type="submit" disabled={submitReferral.isPending} className="w-full bg-nick-yellow text-nick-dark py-3.5 font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors disabled:opacity-50">
                    {submitReferral.isPending ? "SUBMITTING..." : "SUBMIT REFERRAL"}
                  </button>
                </form>
              </FadeIn>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-background border-t border-nick-yellow/10 py-12">
          <div className="container">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <Link href="/" className="flex items-center gap-3">
                <div className="w-8 h-8 bg-nick-yellow flex items-center justify-center rounded-md"><span className="font-heading font-bold text-nick-dark text-sm">N</span></div>
                <span className="font-heading font-bold text-nick-yellow tracking-wider">NICK'S TIRE & AUTO</span>
              </Link>
              <p className="text-foreground/30 text-xs font-mono">&copy; {new Date().getFullYear()} NICK'S TIRE & AUTO</p>
              <a href="tel:2168620005" className="text-nick-yellow font-mono text-sm">(216) 862-0005</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
