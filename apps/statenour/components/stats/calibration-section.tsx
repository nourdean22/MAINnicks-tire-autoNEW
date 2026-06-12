"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Check,
  X,
  AlertCircle,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
  Sliders,
  Award,
  AlertTriangle,
  Flame,
  Activity,
  History,
  BookOpen
} from "lucide-react";

interface CalibrationReviewItem {
  id: string;
  type: string; // "prediction" | "task_roi"
  sourceId: string;
  sourceType: string;
  status: string; // pending | approved | corrected | rejected | needs_more_evidence
  predictedOutcome: any;
  proposedActualOutcome: any;
  approvedActualOutcome: any;
  confidence: number;
  evidence: any;
  evidenceFreshness: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  correctionNote: string | null;
  accuracyScore: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Scoreboard {
  predictionCount30d: number;
  rollingBrier30d: number | null;
  predictionAccuracyPct: number | null;
  taskRoiCount30d: number;
  taskRoiMae30d: number | null;
  taskRoiBias30d: number | null;
  taskOverestimateRate30d: number;
  calibrationVerdict: "well-calibrated" | "moderate" | "drift" | "unknown";
  biasVerdict: "calibrated" | "overconfident" | "underconfident";
  colorHsl: string;
}

interface BrainMemory {
  id: string;
  content: string;
  createdAt: string;
}

export function CalibrationSection() {
  const [pending, setPending] = useState<CalibrationReviewItem[]>([]);
  const [history, setHistory] = useState<CalibrationReviewItem[]>([]);
  const [lessons, setLessons] = useState<BrainMemory[]>([]);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  
  // Correction state overrides
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionRoi, setCorrectionRoi] = useState<number>(50);
  const [correctionStatus, setCorrectionStatus] = useState<"confirmed" | "disproven" | "expired">("confirmed");
  const [correctionDescription, setCorrectionDescription] = useState<string>("");
  const [correctionNote, setCorrectionNote] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system/calibration/reviews");
      if (!res.ok) throw new Error("Failed to fetch calibration data");
      const data = await res.json();
      setPending(data.pending || []);
      setHistory(data.history || []);
      setLessons(data.lessons || []);
      setScoreboard(data.scoreboard || null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load calibration details");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleResolve = async (
    id: string,
    action: "approve" | "correct" | "reject" | "needs_more_evidence",
    overrideOutcome?: any
  ) => {
    setResolvingId(id);
    try {
      const payload: Record<string, any> = { action };
      if (action === "correct" && overrideOutcome) {
        payload.approvedActualOutcome = overrideOutcome;
      }
      if (correctionNote) {
        payload.correctionNote = correctionNote;
      }

      const res = await fetch(`/api/system/calibration/reviews/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to resolve review item");
      }

      toast.success(action === "approve" ? "Approved outcome proposal" : "Submitted resolution");
      
      // Reset correction forms
      setCorrectingId(null);
      setCorrectionNote("");
      setCorrectionDescription("");
      
      // Reload
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to resolve calibration item");
    } finally {
      setResolvingId(null);
    }
  };

  const handleBulkAction = async (action: "approve_low_risk" | "reject_stale") => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/system/calibration/reviews/bulk-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to execute bulk action");
      }

      const data = await res.json();
      toast.success(`Bulk action completed: processed ${data.processedCount} items`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to execute bulk action");
    } finally {
      setBulkLoading(false);
    }
  };

  const startCorrection = useCallback((item: CalibrationReviewItem) => {
    setCorrectingId(item.id);
    if (item.type === "task_roi") {
      setCorrectionRoi(item.proposedActualOutcome?.outcomeScore || 50);
    } else {
      setCorrectionStatus(item.proposedActualOutcome?.status || "confirmed");
      setCorrectionDescription(item.proposedActualOutcome?.outcomeDescription || "");
    }
  }, []);

  // Keyboard navigation shortcuts (Tinder-style queue)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pending.length === 0 || resolvingId !== null || bulkLoading) return;

      // Skip shortcuts when typing in inputs/textareas
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        return;
      }

      const activeCard = pending[0];

      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleResolve(activeCard.id, "approve");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleResolve(activeCard.id, "reject");
      } else if (e.key === "ArrowUp") {
        if (activeCard.type === "task_roi") {
          e.preventDefault();
          if (correctingId !== activeCard.id) {
            startCorrection(activeCard);
          }
          setCorrectionRoi((prev) => Math.min(100, prev + 5));
        }
      } else if (e.key === "ArrowDown") {
        if (activeCard.type === "task_roi") {
          e.preventDefault();
          if (correctingId !== activeCard.id) {
            startCorrection(activeCard);
          }
          setCorrectionRoi((prev) => Math.max(1, prev - 5));
        }
      } else if (e.key === "Enter") {
        if (correctingId === activeCard.id) {
          e.preventDefault();
          const outcome = activeCard.type === "task_roi"
            ? {
                outcomeScore: correctionRoi,
                classification: correctionRoi - activeCard.predictedOutcome.roiScore > 10
                  ? "underestimated"
                  : activeCard.predictedOutcome.roiScore - correctionRoi > 10
                  ? "overestimated"
                  : "accurate",
                rationale: "Manually overridden by keyboard shortcut"
              }
            : {
                status: correctionStatus,
                outcomeDescription: correctionDescription || "Manually resolved outcome."
              };
          handleResolve(activeCard.id, "correct", outcome);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pending, correctingId, correctionRoi, correctionStatus, correctionDescription, resolvingId, bulkLoading, handleResolve, startCorrection]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6 py-6 animate-pulse" aria-hidden>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-24 rounded-lg bg-white/[0.02] border border-white/10" />
          <div className="h-24 rounded-lg bg-white/[0.02] border border-white/10" />
          <div className="h-24 rounded-lg bg-white/[0.02] border border-white/10" />
        </div>
        <div className="h-[300px] rounded-lg bg-white/[0.02] border border-white/10" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 1. SCOREBOARD PANEL */}
      {scoreboard && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card A: Prediction Accuracy */}
          <Card className="border-white/10 bg-white/[0.02] hover:bg-white/[0.03] transition-all relative overflow-hidden">
            <div 
              className="absolute top-0 left-0 w-full h-[3px]"
              style={{ backgroundColor: scoreboard.colorHsl }}
            />
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                Prediction Calibration
                <Activity className="h-4 w-4 text-zinc-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-bold font-mono text-white">
                {scoreboard.predictionAccuracyPct !== null 
                  ? `${scoreboard.predictionAccuracyPct}%` 
                  : "--"}
              </div>
              <p className="text-[10px] text-zinc-500">
                {scoreboard.predictionCount30d} predictions (30d) &middot; Brier: {scoreboard.rollingBrier30d !== null ? scoreboard.rollingBrier30d.toFixed(3) : "N/A"}
              </p>
              <div className="pt-2">
                <Badge 
                  className="text-[10px] font-medium"
                  style={{
                    backgroundColor: `${scoreboard.colorHsl}15`,
                    color: scoreboard.colorHsl,
                    border: `1px solid ${scoreboard.colorHsl}30`
                  }}
                >
                  {scoreboard.calibrationVerdict === "well-calibrated" && "Well Calibrated"}
                  {scoreboard.calibrationVerdict === "moderate" && "Moderate Calibration"}
                  {scoreboard.calibrationVerdict === "drift" && "Calibration Drift Detected"}
                  {scoreboard.calibrationVerdict === "unknown" && "Preliminary Data"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Card B: Task ROI Accuracy */}
          <Card className="border-white/10 bg-white/[0.02] hover:bg-white/[0.03] transition-all relative overflow-hidden">
            <div 
              className="absolute top-0 left-0 w-full h-[3px]"
              style={{
                backgroundColor: scoreboard.taskRoiBias30d !== null && scoreboard.taskRoiBias30d < -15 
                  ? "hsl(0, 84%, 60%)" 
                  : "hsl(142, 76%, 36%)"
              }}
            />
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                Task ROI Precision
                <Sliders className="h-4 w-4 text-zinc-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-bold font-mono text-white">
                {scoreboard.taskRoiMae30d !== null 
                  ? `±${scoreboard.taskRoiMae30d.toFixed(1)} pts` 
                  : "--"}
              </div>
              <p className="text-[10px] text-zinc-500">
                MAE (Mean Absolute Error) across {scoreboard.taskRoiCount30d} tasks in 30d
              </p>
              <div className="pt-2">
                <Badge className={cn("text-[10px] font-medium border bg-transparent", 
                  scoreboard.biasVerdict === "overconfident" && "text-rose-400 border-rose-500/20 bg-rose-500/5",
                  scoreboard.biasVerdict === "underconfident" && "text-purple-400 border-purple-500/20 bg-purple-500/5",
                  scoreboard.biasVerdict === "calibrated" && "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                )}>
                  {scoreboard.biasVerdict === "overconfident" && "Bias: Overconfident (+ROI)"}
                  {scoreboard.biasVerdict === "underconfident" && "Bias: Underconfident (-ROI)"}
                  {scoreboard.biasVerdict === "calibrated" && "Calibrated ROI estimation"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Card C: Overestimate Rate */}
          <Card className="border-white/10 bg-white/[0.02] hover:bg-white/[0.03] transition-all relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[3px] bg-zinc-700" />
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                Overestimate Bias
                <Flame className="h-4 w-4 text-zinc-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-bold font-mono text-white">
                {scoreboard.taskOverestimateRate30d}%
              </div>
              <p className="text-[10px] text-zinc-500">
                Percentage of completed tasks where actual ROI was lower than estimate
              </p>
              <div className="pt-2 text-[10px] text-zinc-400">
                Mean Bias: <span className="font-mono">{scoreboard.taskRoiBias30d !== null ? `${scoreboard.taskRoiBias30d.toFixed(1)} pts` : "0.0"}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 2. PENDING DECK */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
            <span>Pending Calibration Review ({pending.length})</span>
            {pending.length > 0 && <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />}
          </h3>

          {pending.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10 cursor-pointer transition-all duration-300"
                onClick={() => handleBulkAction("approve_low_risk")}
                disabled={bulkLoading || resolvingId !== null}
              >
                {bulkLoading ? "Processing..." : "Approve Low Risk (±5 ROI)"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs border-rose-500/30 bg-rose-500/5 text-rose-300 hover:bg-rose-500/10 cursor-pointer transition-all duration-300"
                onClick={() => handleBulkAction("reject_stale")}
                disabled={bulkLoading || resolvingId !== null}
              >
                {bulkLoading ? "Processing..." : "Clean Stale (>14d)"}
              </Button>
            </div>
          )}
        </div>

        {pending.length === 0 ? (
          <Card className="border-white/5 bg-white/[0.01]">
            <CardContent className="py-10 text-center space-y-2">
              <Check className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="text-sm text-zinc-300 font-medium">Outcome Review Queue Clear</p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                No completed tasks or expired predictions require manual grading calibration at this time. Nightly cron compiles next reviews.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {pending.map((item, idx) => {
              const isTask = item.type === "task_roi";
              const isExpanded = expandedId === item.id;
              const isCorrecting = correctingId === item.id;
              const isTopCard = idx === 0;

              return (
                <Card 
                  key={item.id} 
                  className={cn(
                    "border-white/10 bg-white/[0.02] hover:bg-white/[0.03] transition-all duration-300 relative",
                    isTask ? "border-l-indigo-500/40 border-l-[3px]" : "border-l-sky-500/40 border-l-[3px]",
                    isTopCard && "ring-2 ring-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.15)] border-white/20"
                  )}
                >
                  <CardContent className="pt-4 space-y-4">
                    {/* Header Row */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={cn("text-[9px] uppercase tracking-wider py-0.5", 
                            isTask ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/20" : "bg-sky-500/10 text-sky-300 border-sky-500/20"
                          )}>
                            {isTask ? "Task ROI Estimate" : "System Prediction"}
                          </Badge>
                          {isTopCard && (
                            <Badge variant="outline" className="text-[9px] border-indigo-500/30 bg-indigo-500/5 text-indigo-400 font-mono py-0.5">
                              ⌨️ Active Card (🡄 Reject | 🡆 Approve | 🡡🡣 Adjust)
                            </Badge>
                          )}
                          <span className="text-[10px] text-zinc-500 font-mono">
                            ID: {item.sourceId.slice(0, 8)}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-white">
                          {isTask ? item.predictedOutcome.title : item.predictedOutcome.prediction}
                        </h4>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium text-zinc-400">
                          {isTask ? `Estimated ROI: ${item.predictedOutcome.roiScore}` : `Confidence: ${(item.confidence * 100).toFixed(0)}%`}
                        </div>
                        <p className="text-[10px] text-zinc-500 flex items-center gap-1 justify-end">
                          <Calendar className="h-3 w-3" />
                          {new Date(item.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    {/* Proposal Banner */}
                    <div className="rounded-lg bg-zinc-950/40 border border-white/5 p-3 flex items-start gap-3">
                      {isTask ? (
                        <Award className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                      ) : (
                        <Clock className="h-5 w-5 text-sky-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1 text-xs">
                        <p className="text-zinc-300 font-medium flex items-center gap-1.5">
                          Proposed Actual Outcome:
                          {isTask ? (
                            <Badge className={cn("text-[10px] font-bold py-0 h-4",
                              item.proposedActualOutcome.classification === "accurate" && "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
                              item.proposedActualOutcome.classification === "overestimated" && "bg-rose-500/10 text-rose-300 border-rose-500/20",
                              item.proposedActualOutcome.classification === "underestimated" && "bg-purple-500/10 text-purple-300 border-purple-500/20",
                              item.proposedActualOutcome.classification === "insufficient_evidence" && "bg-zinc-500/10 text-zinc-300 border-zinc-500/20"
                            )}>
                              ROI {item.proposedActualOutcome.outcomeScore} &middot; {item.proposedActualOutcome.classification}
                            </Badge>
                          ) : (
                            <Badge className={cn("text-[10px] font-bold py-0 h-4",
                              item.proposedActualOutcome.status === "confirmed" && "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
                              item.proposedActualOutcome.status === "disproven" && "bg-rose-500/10 text-rose-300 border-rose-500/20",
                              item.proposedActualOutcome.status === "expired" && "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
                              item.proposedActualOutcome.status === "needs_more_evidence" && "bg-amber-500/10 text-amber-300 border-amber-500/20"
                            )}>
                              {item.proposedActualOutcome.status}
                            </Badge>
                          )}
                        </p>
                        <p className="text-zinc-400 text-[11px] leading-relaxed">
                          {isTask ? item.proposedActualOutcome.rationale : item.proposedActualOutcome.outcomeDescription}
                        </p>
                      </div>
                    </div>

                    {/* Expandable Evidence Inspector */}
                    {isExpanded && (
                      <div className="pt-2 pb-1 space-y-3 animate-fade-in">
                        <Separator className="bg-white/5" />
                        <h5 className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold flex items-center gap-1.5">
                          <FileText className="h-3 w-3" />
                          Evidence Details
                        </h5>
                        <div className="rounded-lg bg-black/30 border border-white/5 p-3 text-xs space-y-2 text-zinc-400">
                          {isTask ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <span className="text-[10px] text-zinc-500 block">Execution Metrics</span>
                                <div className="space-y-1 font-mono text-zinc-300">
                                  <p>Effort Band: <span className="text-white">{item.predictedOutcome.effort}</span></p>
                                  <p>Actual Minutes: <span className="text-white">{item.evidence.actualMinutes || "0"} min</span></p>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <span className="text-[10px] text-zinc-500 block">Completion Notes</span>
                                <p className="italic text-zinc-300">
                                  "{item.evidence.completionNote || "None recorded"}"
                                </p>
                              </div>
                              {item.evidence.proof && (
                                <div className="md:col-span-2 space-y-1">
                                  <span className="text-[10px] text-zinc-500 block">Proof Uploaded</span>
                                  <pre className="text-[10px] font-mono text-zinc-300 bg-zinc-950 p-2 rounded border border-white/5 overflow-auto max-h-24">
                                    {JSON.stringify(item.evidence.proof, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {item.evidence.businessMetrics && (
                                <div className="space-y-1">
                                  <span className="text-[10px] text-zinc-500 block">Business Metrics (From Nick's Tire)</span>
                                  <pre className="text-[10px] font-mono text-zinc-300 bg-zinc-950 p-2 rounded border border-white/5 overflow-auto">
                                    {JSON.stringify(item.evidence.businessMetrics, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {item.evidence.matchingMemories && (
                                <div className="space-y-2">
                                  <span className="text-[10px] text-zinc-500 block">Semantically Related Memories</span>
                                  {item.evidence.matchingMemories.map((m: any, idx: number) => (
                                    <div key={idx} className="bg-zinc-950/60 p-2 rounded border border-white/5 text-[11px]">
                                      <div className="flex items-center justify-between text-[9px] text-zinc-500 mb-1">
                                        <span>Match #{idx+1}</span>
                                        <span className="font-mono">Similarity: {(m.similarity * 100).toFixed(0)}%</span>
                                      </div>
                                      <p className="text-zinc-300">"{m.content}"</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action Form for Correcting */}
                    {isCorrecting && (
                      <div className="pt-2 pb-1 space-y-4 animate-fade-in bg-zinc-950/20 p-3 rounded-lg border border-white/5">
                        <h5 className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1.5">
                          <Sliders className="h-3 w-3" />
                          Override Calibrated Outcome
                        </h5>
                        
                        {isTask ? (
                          <div className="space-y-2">
                            <label className="text-xs text-zinc-400 flex justify-between">
                              <span>Correct Outcome ROI Score:</span>
                              <span className="font-bold text-white font-mono">{correctionRoi} / 100</span>
                            </label>
                            <input 
                              type="range" 
                              min="1" 
                              max="100" 
                              value={correctionRoi}
                              onChange={(e) => setCorrectionRoi(Number(e.target.value))}
                              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                              <span>1 (Low)</span>
                              <span>50 (Mid)</span>
                              <span>100 (Max)</span>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400 block">Correct Status:</label>
                              <div className="flex gap-1.5">
                                {["confirmed", "disproven", "expired"].map((st) => (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() => setCorrectionStatus(st as any)}
                                    className={cn(
                                      "px-2.5 py-1 text-xs rounded border transition-all uppercase tracking-wider text-[10px] font-semibold",
                                      correctionStatus === st 
                                        ? "bg-amber-400/10 text-amber-300 border-amber-400/30" 
                                        : "bg-white/[0.02] border-white/10 text-zinc-400"
                                    )}
                                  >
                                    {st}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400 block">Outcome Description:</label>
                              <input 
                                type="text"
                                value={correctionDescription}
                                onChange={(e) => setCorrectionDescription(e.target.value)}
                                className="w-full text-xs bg-zinc-900 border border-white/10 rounded px-2 py-1 text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
                                placeholder="Describe actual results..."
                              />
                            </div>
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400 block">Adjustment Note (Optional):</label>
                          <input 
                            type="text"
                            value={correctionNote}
                            onChange={(e) => setCorrectionNote(e.target.value)}
                            className="w-full text-xs bg-zinc-900 border border-white/10 rounded px-2 py-1.5 text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
                            placeholder="Reason for override..."
                          />
                        </div>

                        <div className="flex gap-2 justify-end">
                          <Button 
                            size="sm"
                            variant="ghost"
                            className="text-xs text-zinc-400 hover:text-white"
                            onClick={() => setCorrectingId(null)}
                          >
                            Cancel
                          </Button>
                          <Button 
                            size="sm"
                            className="text-xs bg-amber-400 text-black hover:bg-amber-400/80 font-semibold"
                            onClick={() => {
                              const outcome = isTask 
                                ? { 
                                    outcomeScore: correctionRoi, 
                                    classification: correctionRoi - item.predictedOutcome.roiScore > 10 
                                      ? "underestimated" 
                                      : item.predictedOutcome.roiScore - correctionRoi > 10 
                                      ? "overestimated" 
                                      : "accurate",
                                    rationale: "Manually overridden by operator"
                                  }
                                : {
                                    status: correctionStatus,
                                    outcomeDescription: correctionDescription || "Manually resolved outcome."
                                  };
                              handleResolve(item.id, "correct", outcome);
                            }}
                            disabled={resolvingId !== null}
                          >
                            Submit Correction
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Footer Row Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-all"
                      >
                        {isExpanded ? (
                          <>Hide Evidence <ChevronUp className="h-3.5 w-3.5" /></>
                        ) : (
                          <>Inspect Evidence <ChevronDown className="h-3.5 w-3.5" /></>
                        )}
                      </button>

                      {!isCorrecting && (
                        <div className="flex items-center gap-2">
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-wider py-1 min-h-[30px]"
                            onClick={() => handleResolve(item.id, "needs_more_evidence")}
                            disabled={resolvingId !== null}
                          >
                            Need Evidence
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/5 uppercase tracking-wider py-1 min-h-[30px]"
                            onClick={() => handleResolve(item.id, "reject")}
                            disabled={resolvingId !== null}
                          >
                            Reject
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            className="text-[10px] border-zinc-700 hover:border-white/20 text-zinc-300 uppercase tracking-wider py-1 min-h-[30px]"
                            onClick={() => startCorrection(item)}
                            disabled={resolvingId !== null}
                          >
                            Override
                          </Button>
                          <Button
                            size="xs"
                            className="text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white font-semibold uppercase tracking-wider py-1 min-h-[30px] flex items-center gap-1"
                            onClick={() => handleResolve(item.id, "approve")}
                            disabled={resolvingId !== null}
                          >
                            <Check className="h-3.5 w-3.5" /> Approve
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Separator className="bg-white/5" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 3. LESSONS FEED */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-zinc-500" />
            Calibration Lessons Feed
          </h3>

          {lessons.length === 0 ? (
            <Card className="border-white/5 bg-white/[0.01]">
              <CardContent className="py-8 text-center text-xs text-zinc-500">
                No outcome lessons recorded yet. Resolve items to extract lessons.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
              {lessons.map((lesson) => (
                <div 
                  key={lesson.id}
                  className="rounded-lg bg-zinc-950/40 border border-white/5 p-3 text-xs space-y-1"
                >
                  <p className="text-zinc-300 leading-relaxed font-sans">
                    {lesson.content}
                  </p>
                  <p className="text-[9px] text-zinc-500 font-mono">
                    Logged: {new Date(lesson.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. CALIBRATION HISTORY */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
            <History className="h-4 w-4 text-zinc-500" />
            Recent Resolutions
          </h3>

          {history.length === 0 ? (
            <Card className="border-white/5 bg-white/[0.01]">
              <CardContent className="py-8 text-center text-xs text-zinc-500">
                No calibration history recorded.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
              {history.map((h) => {
                const isTask = h.type === "task_roi";
                return (
                  <div 
                    key={h.id}
                    className="rounded-lg bg-white/[0.01] border border-white/5 p-3 text-xs space-y-2"
                  >
                    <div className="flex justify-between items-center text-[10px]">
                      <Badge className={cn("text-[9px] font-semibold py-0.5",
                        h.status === "approved" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                      )}>
                        {h.status}
                      </Badge>
                      <span className="text-zinc-500 font-mono">
                        {new Date(h.updatedAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="font-semibold text-white">
                        {isTask ? h.predictedOutcome.title : h.predictedOutcome.prediction}
                      </p>
                      <div className="text-[11px] text-zinc-400 leading-relaxed">
                        {isTask ? (
                          <p>
                            Estimated: <span className="font-semibold text-white">{h.predictedOutcome.roiScore}</span> &middot; 
                            Actual: <span className="font-semibold text-white">{h.approvedActualOutcome?.outcomeScore}</span> &middot;
                            Class: <span className="italic text-zinc-300">{h.approvedActualOutcome?.classification}</span>
                          </p>
                        ) : (
                          <p>
                            Outcome: <span className="font-semibold text-white">{h.approvedActualOutcome?.status}</span> &middot; 
                            Desc: <span className="italic text-zinc-300">{h.approvedActualOutcome?.outcomeDescription}</span>
                          </p>
                        )}
                        {h.correctionNote && (
                          <p className="text-[10px] text-amber-300 mt-1">
                            Override Reason: {h.correctionNote}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
