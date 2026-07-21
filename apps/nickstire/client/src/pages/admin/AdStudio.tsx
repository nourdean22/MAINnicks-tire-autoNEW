/*
 * AD STUDIO — self-serve graphic-design Instagram ad generator.
 *
 * Pick an angle, generate claim-safe copy + 5 server-rendered brand slides
 * (yellow-on-black, NO fake people), preview, then post now or schedule.
 * Reuses the server adStudio router (copy + puppeteer render + carousel post).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Sparkles, Loader2, Send, CalendarClock, AlertTriangle, Megaphone, Copy, Target } from "lucide-react";
import { CampaignPlanViewer } from "@/components/admin/CampaignPlanViewer";
import type { CampaignInput, CampaignOutput } from "@nour/meta-ads-architect";

const ANGLES = [
  { id: "financing", label: "$10 down / financing", note: "Kills the price objection first — drive today." },
  { id: "free_check", label: "Free check offer", note: "Low-friction walk-in hook." },
  { id: "trust", label: "4.9★ trust / local", note: "Social proof as the engine." },
] as const;
type Angle = (typeof ANGLES)[number]["id"];

type GenResult = {
  copy: { caption: string; hookYellow: string; hookWhite: string };
  issues: string[];
  slideUrls: string[];
};

function SingleAdView() {
  const [angle, setAngle] = useState<Angle>("financing");
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<GenResult | null>(null);
  const [when, setWhen] = useState("");

  const generate = trpc.adStudio.generate.useMutation({
    onSuccess: (r) => { setResult(r as GenResult); toast.success("Ad generated"); },
    onError: (e) => toast.error(e.message || "Generation failed"),
  });
  const post = trpc.adStudio.post.useMutation({
    onSuccess: () => toast.success("Posted to @nicks_tire_euclid"),
    onError: (e) => toast.error(e.message || "Post failed"),
  });
  const schedule = trpc.adStudio.schedule.useMutation({
    onSuccess: (r) => toast.success(`Scheduled for ${new Date(r.scheduledAt).toLocaleString()}`),
    onError: (e) => toast.error(e.message || "Schedule failed"),
  });

  const busy = generate.isPending;

  return (
    <div className="space-y-6">
      <section className="border border-border bg-card/40 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ANGLES.map((a) => (
            <button
              key={a.id}
              onClick={() => setAngle(a.id)}
              className={`text-left rounded-lg border p-3 transition-colors ${angle === a.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
            >
              <div className="font-semibold text-sm">{a.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{a.note}</div>
            </button>
          ))}
        </div>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Optional steer — e.g. summer road trip, brakes, winter"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
          maxLength={120}
        />
        <button
          onClick={() => { setResult(null); generate.mutate({ angle, topic: topic.trim() || undefined }); }}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? "Generating + rendering…" : "Generate ad"}
        </button>
        {busy && <p className="text-xs text-muted-foreground">Writing claim-safe copy + rendering 5 brand slides (~15–25s)…</p>}
      </section>

      {result && (
        <section className="border border-border bg-card/40 rounded-lg p-4 space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground/80 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Preview</h2>

          {result.issues.length > 0 && (
            <div className="flex items-start gap-2 text-amber-500 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div><b>Claim-safety flags:</b> {result.issues.join("; ")}. Review before posting.</div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {result.slideUrls.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="block">
                <img src={u} alt={`slide ${i + 1}`} className="w-full aspect-square object-cover rounded-md border border-border" />
              </a>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</span>
              <button onClick={() => { navigator.clipboard.writeText(result.copy.caption); toast.success("Caption copied"); }} className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Copy className="w-3 h-3" /> Copy</button>
            </div>
            <pre className="whitespace-pre-wrap text-sm bg-background border border-border rounded-lg p-3 max-h-48 overflow-auto">{result.copy.caption}</pre>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              onClick={() => post.mutate({ slideUrls: result.slideUrls, caption: result.copy.caption })}
              disabled={post.isPending}
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold disabled:opacity-60"
            >
              {post.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Post now
            </button>
            <div className="flex items-center gap-2">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="bg-background border border-border rounded-lg px-3 py-2 text-sm" />
              <button
                onClick={() => {
                  if (!when) return toast.error("Pick a date/time first");
                  schedule.mutate({ slideUrls: result.slideUrls, caption: result.copy.caption, scheduledAt: new Date(when).toISOString() });
                }}
                disabled={schedule.isPending}
                className="inline-flex items-center justify-center gap-2 border border-border px-4 py-2.5 rounded-lg font-semibold hover:border-primary/40 disabled:opacity-60"
              >
                {schedule.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />} Schedule
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Posting goes live on @nicks_tire_euclid immediately. Scheduled ads fire from the publish-later queue.</p>
        </section>
      )}
    </div>
  );
}

function CampaignArchitectView() {
  const [input, setInput] = useState<Partial<CampaignInput>>({
    offer: {
      productOrServiceName: "Used Tires & Brake Repair",
      niche: "Local Auto Repair",
      primaryOutcome: "Safe, affordable driving",
      deliveryFormat: "Done-for-you service",
      whatsIncluded: "Free inspection, parts, and labor",
      timeToConsumeOrFulfill: "Same-day service",
      serviceArea: "Cleveland, OH and surrounding areas",
      appointmentRequired: false
    },
    priceStack: {
      corePrice: "From $25 used / $89 new",
      guaranteeOrRefundTerms: "12-month parts / 90-day labor warranty",
      financingAvailable: true
    },
    audience: {
      whoItIsFor: "Local drivers on a budget needing repairs fast",
      painPoints: "Check engine light, grinding brakes, flat tire, expensive dealer quotes",
      desires: "Honest mechanic, cheap tires, fast service",
      countries: ["US"],
      languages: ["English"],
      awarenessLevel: "Problem Aware",
      localRadius: "15 miles"
    },
    assetsAndProof: {
      testimonialsAvailable: true,
      screenshotsAvailable: false,
      caseStudiesAvailable: false,
      beforeAfterAvailable: true,
      founderFaceAvailable: true,
      brandKitAvailable: true,
      leadMagnetAvailable: false
    },
    constraints: {
      dailyBudgetRange: "$20 - $50",
      monthlyBudgetRange: "$600 - $1500",
      brandVoice: "Honest, direct, friendly, no-BS blue collar",
      complianceSensitivity: "High"
    }
  });

  const [plan, setPlan] = useState<CampaignOutput | null>(null);

  const generate = trpc.metaAdsArchitect.generatePlan.useMutation({
    onSuccess: (r) => {
      if (r.success && r.plan) {
        setPlan(r.plan as CampaignOutput);
        toast.success("Campaign Plan Generated");
      } else {
        toast.error(r.error || "Generation failed");
      }
    },
    onError: (e) => toast.error(e.message || "Generation failed"),
  });

  const busy = generate.isPending;

  return (
    <div className="space-y-6">
      {!plan ? (
        <section className="border border-border bg-card/40 rounded-lg p-4 space-y-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Primary Offer</label>
              <input
                value={input.offer?.productOrServiceName || ""}
                onChange={(e) => setInput({ ...input, offer: { ...input.offer!, productOrServiceName: e.target.value } })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Pain Points</label>
              <textarea
                value={input.audience?.painPoints || ""}
                onChange={(e) => setInput({ ...input, audience: { ...input.audience!, painPoints: e.target.value } })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Core Price</label>
                <input
                  value={input.priceStack?.corePrice || ""}
                  onChange={(e) => setInput({ ...input, priceStack: { ...input.priceStack!, corePrice: e.target.value } })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Daily Budget</label>
                <input
                  value={input.constraints?.dailyBudgetRange || ""}
                  onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, dailyBudgetRange: e.target.value } })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            
            <details className="group border border-border rounded-lg p-3 bg-card/20 text-sm">
              <summary className="font-semibold text-muted-foreground cursor-pointer outline-none">Advanced campaign inputs</summary>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Monthly Budget</label>
                  <input value={input.constraints?.monthlyBudgetRange || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, monthlyBudgetRange: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Local Radius</label>
                  <input value={input.audience?.localRadius || ""} onChange={(e) => setInput({ ...input, audience: { ...input.audience!, localRadius: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Landing Page URL</label>
                  <input value={input.constraints?.landingPageUrl || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, landingPageUrl: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Booking URL</label>
                  <input value={input.constraints?.checkoutOrBookingUrl || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, checkoutOrBookingUrl: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Phone Number</label>
                  <input value={input.constraints?.phoneNumber || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, phoneNumber: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Business Address</label>
                  <input value={input.constraints?.businessAddress || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, businessAddress: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Forbidden Words (Comma separated)</label>
                  <input value={input.constraints?.forbiddenWords?.join(", ") || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, forbiddenWords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Forbidden Topics (Comma separated)</label>
                  <input value={input.constraints?.forbiddenTopics?.join(", ") || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, forbiddenTopics: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Allowed Proof Claims</label>
                  <input value={input.assetsAndProof?.allowedProofClaims || ""} onChange={(e) => setInput({ ...input, assetsAndProof: { ...input.assetsAndProof!, allowedProofClaims: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Forbidden Proof Claims</label>
                  <input value={input.assetsAndProof?.forbiddenProofClaims || ""} onChange={(e) => setInput({ ...input, assetsAndProof: { ...input.assetsAndProof!, forbiddenProofClaims: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Tracking Stack (Comma separated)</label>
                  <input value={input.constraints?.trackingStack?.join(", ") || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, trackingStack: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">Creative Production Capacity</label>
                  <input value={input.constraints?.creativeProductionCapacity || ""} onChange={(e) => setInput({ ...input, constraints: { ...input.constraints!, creativeProductionCapacity: e.target.value } })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </details>
          </div>
          
          <button
            onClick={() => { setPlan(null); generate.mutate(input as CampaignInput); }}
            disabled={busy}
            className="w-full inline-flex justify-center items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            {busy ? "Generating structured campaign plan with LLM…" : "Generate Campaign Plan"}
          </button>
        </section>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setPlan(null)}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 rounded-lg text-sm hover:bg-muted"
          >
            <ArrowLeft className="w-4 h-4" /> Back to input
          </button>
          <CampaignPlanViewer plan={plan} />
        </div>
      )}
    </div>
  );
}

export default function AdStudio() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<"single" | "campaign">("single");

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center bg-background"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-center p-8">
        <div>
          <p className="text-foreground/60 mb-6">Sign in with your admin account to use the Ad Studio.</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg font-semibold">Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
          <Megaphone className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Ads Command Center</h1>
        </div>
        <div className="flex bg-muted rounded-lg p-1">
          <button
            onClick={() => setTab("single")}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === "single" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Single Ad
          </button>
          <button
            onClick={() => setTab("campaign")}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === "campaign" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Campaign Architect
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-5">
        {tab === "single" ? <SingleAdView /> : <CampaignArchitectView />}
      </div>
    </div>
  );
}
