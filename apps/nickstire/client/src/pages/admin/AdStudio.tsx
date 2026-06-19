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
import { ArrowLeft, Sparkles, Loader2, Send, CalendarClock, AlertTriangle, Megaphone, Copy } from "lucide-react";

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

export default function AdStudio() {
  const { user, loading: authLoading } = useAuth();
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

  const busy = generate.isPending;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-5 py-4 flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <Megaphone className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold">Ad Studio</h1>
        <span className="text-xs text-muted-foreground ml-2">Graphic-design carousel ads — no fake people</span>
      </header>

      <div className="max-w-3xl mx-auto p-5 space-y-6">
        {/* Controls */}
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

        {/* Result */}
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

            {/* Actions */}
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
    </div>
  );
}
