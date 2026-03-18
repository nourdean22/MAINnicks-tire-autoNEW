/**
 * /ask — Ask a Mechanic public Q&A page
 * Customers ask questions, Nick's team answers publicly. Builds authority and SEO.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import NotificationBar from "@/components/NotificationBar";
import SearchBar from "@/components/SearchBar";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Menu, X, MessageCircle, ChevronRight, CheckCircle, HelpCircle, ThumbsUp, Search } from "lucide-react";
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

function AskNavbar() {
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

const CATEGORIES = ["All", "Engine", "Brakes", "Tires", "Electrical", "Suspension", "Emissions", "Maintenance", "Other"];

export default function AskMechanicPage() {
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [filterCategory, setFilterCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ questionerName: "", questionerEmail: "", question: "", vehicleInfo: "", category: "" });

  const { data: questions, isLoading } = trpc.qa.published.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const submitQuestion = trpc.qa.ask.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuestion.mutate({
      ...form,
      questionerEmail: form.questionerEmail || undefined,
      vehicleInfo: form.vehicleInfo || undefined,
      category: form.category || undefined,
    });
  };

  const filteredQuestions = (questions ?? []).filter((q: any) => {
    const matchesCategory = filterCategory === "All" || q.category === filterCategory;
    const matchesSearch = !searchQuery || q.question.toLowerCase().includes(searchQuery.toLowerCase()) || (q.answer && q.answer.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SEOHead
        title="Ask a Mechanic | Free Auto Repair Q&A — Nick's Tire & Auto Cleveland"
        description="Got a car question? Ask our mechanics for free. Browse answered questions about brakes, engine problems, tires, and more at Nick's Tire & Auto in Cleveland."
        canonicalPath="/ask"
      />
      <SkipToContent />
      <NotificationBar />
      <AskNavbar />

      <main id="main-content">
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-12 lg:pb-16 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Ask a Mechanic" }]} />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <MessageCircle className="w-6 h-6 text-nick-yellow" />
                <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Free Expert Advice</span>
              </div>
              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                ASK A<br />
                <span className="text-gradient-yellow">MECHANIC</span>
              </h1>
              <p className="mt-4 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Got a car question? Ask our experienced technicians. We answer questions publicly so every driver can benefit from the knowledge.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-6 inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
              >
                ASK YOUR QUESTION
                <ChevronRight className="w-4 h-4" />
              </button>
            </FadeIn>
          </div>
        </section>

        {/* Ask Form */}
        {showForm && !submitted && (
          <section className="py-8 bg-background">
            <div className="container max-w-2xl">
              <FadeIn>
                <div className="border border-nick-yellow/30 bg-nick-dark/50 p-6 lg:p-8">
                  <h2 className="font-heading font-bold text-xl text-foreground tracking-wider mb-6">SUBMIT YOUR QUESTION</h2>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Your Name *</label>
                        <input type="text" required value={form.questionerName} onChange={(e) => setForm({ ...form, questionerName: e.target.value })} className="w-full bg-background border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Email (optional, for reply)</label>
                        <input type="email" value={form.questionerEmail} onChange={(e) => setForm({ ...form, questionerEmail: e.target.value })} className="w-full bg-background border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Vehicle (optional)</label>
                        <input type="text" value={form.vehicleInfo} onChange={(e) => setForm({ ...form, vehicleInfo: e.target.value })} placeholder="e.g. 2018 Honda Civic" className="w-full bg-background border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none placeholder:text-foreground/30" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1 font-mono">Category</label>
                        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full bg-background border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none">
                          <option value="">Select Category</option>
                          {CATEGORIES.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-foreground/60 text-sm mb-1 font-mono">Your Question *</label>
                      <textarea required rows={4} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Describe your car problem or question in detail..." className="w-full bg-background border border-nick-yellow/20 text-foreground px-3 py-2.5 focus:border-nick-yellow outline-none placeholder:text-foreground/30 resize-none" />
                    </div>
                    <div className="flex gap-3">
                      <button type="submit" disabled={submitQuestion.isPending} className="bg-nick-yellow text-nick-dark px-6 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors disabled:opacity-50">
                        {submitQuestion.isPending ? "SUBMITTING..." : "SUBMIT QUESTION"}
                      </button>
                      <button type="button" onClick={() => setShowForm(false)} className="border border-foreground/30 text-foreground px-6 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors">
                        CANCEL
                      </button>
                    </div>
                  </form>
                </div>
              </FadeIn>
            </div>
          </section>
        )}

        {submitted && (
          <section className="py-8 bg-background">
            <div className="container max-w-2xl text-center">
              <FadeIn>
                <CheckCircle className="w-12 h-12 text-nick-yellow mx-auto mb-4" />
                <h2 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-3">QUESTION SUBMITTED</h2>
                <p className="text-foreground/60 mb-6">Our team will review and answer your question. Check back soon.</p>
                <button onClick={() => { setSubmitted(false); setShowForm(false); setForm({ questionerName: "", questionerEmail: "", question: "", vehicleInfo: "", category: "" }); }} className="bg-nick-yellow text-nick-dark px-6 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors">
                  ASK ANOTHER QUESTION
                </button>
              </FadeIn>
            </div>
          </section>
        )}

        {/* Q&A List */}
        <section className="py-12 lg:py-16 section-darker">
          <div className="caution-stripe h-2 w-full" />
          <div className="container pt-12">
            <FadeIn>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-6">
                ANSWERED <span className="text-gradient-yellow">QUESTIONS</span>
              </h2>
            </FadeIn>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search questions..."
                  className="w-full bg-background border border-nick-yellow/20 text-foreground pl-10 pr-3 py-2.5 focus:border-nick-yellow outline-none placeholder:text-foreground/30 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-3 py-1.5 font-mono text-xs tracking-wider transition-colors ${filterCategory === cat ? "bg-nick-yellow text-nick-dark" : "border border-nick-yellow/20 text-foreground/60 hover:border-nick-yellow/50"}`}
                  >
                    {cat.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-nick-yellow/10 bg-nick-dark/30 p-6 animate-pulse">
                    <div className="h-5 w-3/4 bg-foreground/10 rounded mb-3" />
                    <div className="h-4 w-full bg-foreground/5 rounded mb-2" />
                    <div className="h-4 w-2/3 bg-foreground/5 rounded" />
                  </div>
                ))}
              </div>
            ) : filteredQuestions.length > 0 ? (
              <div className="space-y-4">
                {filteredQuestions.map((q: any, i: number) => (
                  <FadeIn key={q.id} delay={i * 0.03}>
                    <div className="border border-nick-yellow/15 bg-nick-dark/50 p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-nick-yellow/10 flex items-center justify-center rounded-md shrink-0 mt-1">
                          <HelpCircle className="w-5 h-5 text-nick-yellow" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-heading font-bold text-foreground text-sm tracking-wider">{q.questionerName}</span>
                            {q.vehicleInfo && <span className="text-nick-teal text-xs font-mono">• {q.vehicleInfo}</span>}
                            {q.category && <span className="text-foreground/30 text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">{q.category}</span>}
                          </div>
                          <p className="text-foreground/80 leading-relaxed">{q.question}</p>
                        </div>
                      </div>
                      {q.answer && (
                        <div className="mt-4 ml-14 pl-4 border-l-2 border-nick-teal/30">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-heading font-bold text-nick-teal text-xs tracking-widest uppercase">{q.answeredBy || "Nick's Tire & Auto"}</span>
                          </div>
                          <p className="text-foreground/70 leading-relaxed text-sm">{q.answer}</p>
                        </div>
                      )}
                    </div>
                  </FadeIn>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <MessageCircle className="w-12 h-12 text-nick-yellow/20 mx-auto mb-4" />
                <h3 className="font-heading font-bold text-foreground/60 text-lg tracking-wider mb-2">
                  {searchQuery || filterCategory !== "All" ? "NO MATCHING QUESTIONS" : "NO QUESTIONS YET"}
                </h3>
                <p className="text-foreground/40 text-sm mb-6">Be the first to ask a question.</p>
                <button onClick={() => setShowForm(true)} className="bg-nick-yellow text-nick-dark px-6 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors">
                  ASK A QUESTION
                </button>
              </div>
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
