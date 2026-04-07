/**
 * /ask — Ask a Mechanic public Q&A page
 * Customers ask questions, Nick's team answers publicly. Builds authority and SEO.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { MessageCircle, ChevronRight, CheckCircle, HelpCircle, Search } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { QueryError } from "@/components/QueryState";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

const CATEGORIES = ["All", "Engine", "Brakes", "Tires", "Electrical", "Suspension", "Emissions", "Maintenance", "Other"];

export default function AskMechanicPage() {
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [filterCategory, setFilterCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ questionerName: "", questionerEmail: "", question: "", vehicleInfo: "", category: "" });

  const { data: questions, isLoading , isError, error } = trpc.qa.published.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const submitQuestion = trpc.qa.ask.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: () => toast.error("Something went wrong. Please try again."),
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
    <PageLayout showChat={true}>
      <SEOHead
        title="Ask a Mechanic | Nick's Tire & Auto Cleveland"
        description="Got a car question? Ask our mechanics for free. Browse answered questions about brakes, engine problems, tires, and more at Nick's Tire & Auto."
        canonicalPath="/ask"
      />
      
      
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-12 lg:pb-16 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Ask a Mechanic" }]} />
      <LocalBusinessSchema />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <MessageCircle className="w-6 h-6 text-primary" />
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Free Expert Advice</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                ASK A<br />
                <span className="text-primary">MECHANIC</span>
              </h1>
              <p className="mt-4 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Got a car question? Ask our experienced technicians. We answer questions publicly so every driver can benefit from the knowledge.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
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
                <div className="border border-primary/30 bg-background/50 p-6 lg:p-8">
                  <h2 className="font-semibold font-bold text-xl text-foreground tracking-[-0.01em] mb-6">SUBMIT YOUR QUESTION</h2>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Your Name *</label>
                        <input type="text" required value={form.questionerName} onChange={(e) => setForm({ ...form, questionerName: e.target.value })} className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Email (optional, for reply)</label>
                        <input type="email" value={form.questionerEmail} onChange={(e) => setForm({ ...form, questionerEmail: e.target.value })} className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Vehicle (optional)</label>
                        <input type="text" value={form.vehicleInfo} onChange={(e) => setForm({ ...form, vehicleInfo: e.target.value })} placeholder="e.g. 2018 Honda Civic" className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30" />
                      </div>
                      <div>
                        <label className="block text-foreground/60 text-sm mb-1">Category</label>
                        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none">
                          <option value="">Select Category</option>
                          {CATEGORIES.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-foreground/60 text-sm mb-1">Your Question *</label>
                      <textarea required rows={4} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Describe your car problem or question in detail..." className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30 resize-none" />
                    </div>
                    <div className="flex gap-3">
                      <button type="submit" disabled={submitQuestion.isPending} className="bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-50">
                        {submitQuestion.isPending ? "SUBMITTING..." : "SUBMIT QUESTION"}
                      </button>
                      <button type="button" onClick={() => setShowForm(false)} className="border border-foreground/30 text-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
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
                <CheckCircle className="w-12 h-12 text-primary mx-auto mb-4" />
                <h2 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-3">QUESTION SUBMITTED</h2>
                <p className="text-foreground/60 mb-6">Our team will review and answer your question. Check back soon.</p>
                <button onClick={() => { setSubmitted(false); setShowForm(false); setForm({ questionerName: "", questionerEmail: "", question: "", vehicleInfo: "", category: "" }); }} className="bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors">
                  ASK ANOTHER QUESTION
                </button>
              </FadeIn>
            </div>
          </section>
        )}

        {/* Q&A List */}
        <section className="py-12 lg:py-16 bg-[oklch(0.055_0.004_260)]">
          <div className="hidden" />
          <div className="container pt-12">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-6">
                ANSWERED <span className="text-primary">QUESTIONS</span>
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
                  className="w-full bg-background border border-primary/20 text-foreground pl-10 pr-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-3 py-1.5 text-[12px] tracking-wider transition-colors ${filterCategory === cat ? "bg-primary text-primary-foreground" : "border border-primary/20 text-foreground/60 hover:border-primary/50"}`}
                  >
                    {cat.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {isError ? (
              <QueryError message="Failed to load data. Please try again." onRetry={() => window.location.reload()} />
            ) : isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-primary/10 bg-background/30 p-6 animate-pulse">
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
                    <div className="border border-primary/15 bg-background/50 p-6">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md shrink-0 mt-1">
                          <HelpCircle className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold font-bold text-foreground text-sm tracking-wider">{q.questionerName}</span>
                            {q.vehicleInfo && <span className="text-nick-blue-light text-xs">• {q.vehicleInfo}</span>}
                            {q.category && <span className="text-foreground/30 text-xs bg-foreground/5 px-1.5 py-0.5 rounded">{q.category}</span>}
                          </div>
                          <p className="text-foreground/80 leading-relaxed">{q.question}</p>
                        </div>
                      </div>
                      {q.answer && (
                        <div className="mt-4 ml-14 pl-4 border-l-2 border-nick-blue/30">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold font-bold text-nick-blue-light text-xs tracking-wide">{q.answeredBy || "Nick's Tire & Auto"}</span>
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
                <MessageCircle className="w-12 h-12 text-primary/20 mx-auto mb-4" />
                <h3 className="font-semibold font-bold text-foreground/60 text-lg tracking-[-0.01em] mb-2">
                  {searchQuery || filterCategory !== "All" ? "NO MATCHING QUESTIONS" : "NO QUESTIONS YET"}
                </h3>
                <p className="text-foreground/40 text-sm mb-6">Be the first to ask a question.</p>
                <button onClick={() => setShowForm(true)} className="bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors">
                  ASK A QUESTION
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        

    
      <InternalLinks />
</PageLayout>
  );
}
