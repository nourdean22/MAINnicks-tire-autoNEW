/**
 * QASection — extracted from Admin.tsx for maintainability.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  CheckCircle2, Clock, Loader2, MessageSquare, XCircle
} from "lucide-react";

export default function QASection() {
  const { data: questions, isLoading } = trpc.qa.all.useQuery();
  const utils = trpc.useUtils();
  const [answeringId, setAnsweringId] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");

  const answerQuestion = trpc.qa.answer.useMutation({
    onSuccess: () => { utils.qa.all.invalidate(); setAnsweringId(null); setAnswer(""); toast.success("Answer published"); },
  });
  const deleteQuestion = trpc.qa.answer.useMutation({
    onSuccess: () => { utils.qa.all.invalidate(); toast.success("Question removed"); },
  });

  return (
    <div className="space-y-6">
      <h2 className="font-bold text-xl text-foreground tracking-wider">CUSTOMER QUESTIONS</h2>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (questions ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No questions yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(questions ?? []).map((q: any) => (
            <div key={q.id} className={`bg-card border ${q.answer ? "border-border/30" : "border-primary/30"} p-4`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-foreground text-sm">{q.questionerName}</span>
                    {q.vehicleInfo && <span className="text-foreground/40 text-xs">• {q.vehicleInfo}</span>}
                    {q.category && <span className="text-xs bg-foreground/5 text-foreground/40 px-1.5 py-0.5">{q.category}</span>}
                    {!q.answer && <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5">NEEDS ANSWER</span>}
                  </div>
                  <p className="text-foreground/70 text-sm">{q.question}</p>
                  {q.answer && (
                    <div className="mt-3 pl-4 border-l-2 border-primary/30">
                      <p className="text-foreground/50 text-xs mb-1">Answer by {q.answeredBy || "Nick's Tire & Auto"}:</p>
                      <p className="text-foreground/60 text-sm">{q.answer}</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {!q.answer && (
                    <button onClick={() => { setAnsweringId(q.id); setAnswer(""); }} className="text-primary hover:text-primary/80 text-xs">ANSWER</button>
                  )}
                  <button onClick={() => { if (confirm("Delete?")) deleteQuestion.mutate({ id: q.id, answer: "[removed]", answeredBy: "Admin" }); }} className="text-foreground/30 hover:text-red-400">
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {answeringId === q.id && (
                <div className="mt-4 space-y-3">
                  <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="Type your answer..." className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none resize-none" />
                  <div className="flex gap-2">
                    <button
                      onClick={() => answerQuestion.mutate({ id: q.id, answer, answeredBy: "Nick's Tire & Auto" })}
                      disabled={!answer.trim() || answerQuestion.isPending}
                      className="bg-primary text-primary-foreground px-4 py-1.5 font-bold text-xs tracking-wide disabled:opacity-50"
                    >
                      {answerQuestion.isPending ? "PUBLISHING..." : "PUBLISH ANSWER"}
                    </button>
                    <button onClick={() => setAnsweringId(null)} className="text-foreground/50 text-xs">CANCEL</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── REFERRALS TRACKING ────────────────────────────────

