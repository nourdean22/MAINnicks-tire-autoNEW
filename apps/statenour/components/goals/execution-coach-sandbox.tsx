"use client";

import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { 
  Play, Timer, AlertTriangle, ArrowRight, CheckCircle2, 
  RotateCcw, Sparkles, ShieldAlert, Check, Loader2, ArrowUpRight,
  BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CoachEntry {
  at: string;
  read: string;
  nextAction: string;
  blocker: string | null;
  risks: string[];
  progressPct: number;
}

interface LifeGoal {
  id: string;
  domain: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  status: string;
  why: string | null;
  coachLog: CoachEntry[] | null;
  nextMove?: { id: string; title: string; status: string } | null;
}

interface ExecutionCoachSandboxProps {
  goal: LifeGoal;
  latestCoach: CoachEntry | null;
  onRefresh: () => void;
}

type Step = "BRIEFING" | "TIMER" | "RESISTANCE" | "SURVEY" | "REFLECTION" | "COMPLETED";

const FRICTION_OPTIONS = [
  { emoji: "🔋", label: "Low energy", key: "low-energy" },
  { emoji: "❓", label: "Vague next step", key: "vague" },
  { emoji: "🎯", label: "Fear of failure", key: "fear" },
  { emoji: "📱", label: "Distraction", key: "distraction" },
  { emoji: "⚡", label: "No friction", key: "none" },
];

const GOAL_DOMAIN_TO_STAT: Record<string, string> = {
  business: "business_ops",
  career: "business_ops",
  finance: "financial",
  financial: "financial",
  health: "physical",
  fitness: "physical",
  content: "marketing",
  personal: "discipline",
  family: "relationships",
  spiritual: "faith",
  skills: "technical",
  mind: "mental",
};

const VALID_STATS = new Set<string>([
  "physical", "combat", "conditioning", "mobility",
  "mental", "fortitude", "emotional_intelligence", "adaptability", "courage", "faith", "self_confidence", "patience", "audacity", "wisdom", "discipline",
  "business_ops", "financial", "technical", "strategy", "delegation", "follow_through", "critical_thinking", "learning",
  "sales", "persuasion", "marketing", "leadership", "relationships", "service", "languages", "advertising", "seduction", "networking"
]);

function resolveGoalStat(domain: string): string | null {
  const d = (domain || "").toLowerCase().trim();
  if (!d) return null;
  if (VALID_STATS.has(d)) return d;
  return GOAL_DOMAIN_TO_STAT[d] || null;
}

export function ExecutionCoachSandbox({ goal, latestCoach, onRefresh }: ExecutionCoachSandboxProps) {
  const [step, setStep] = useState<Step>("BRIEFING");
  
  // Clarity Gate states
  const [whyText, setWhyText] = useState(goal.why || "");
  const [isSavingWhy, setIsSavingWhy] = useState(false);
  
  // Mission states
  const [missionTitle, setMissionTitle] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  
  // Timer states
  const [timerDuration, setTimerDuration] = useState(600); // 10 minutes in seconds
  const [timeLeft, setTimeLeft] = useState(600);
  const [timerActive, setTimerActive] = useState(false);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Friction states
  const [selectedFrictions, setSelectedFrictions] = useState<Set<string>>(new Set());
  
  // Reflection states
  const [seedAction, setSeedAction] = useState("");
  const [progressDelta, setProgressDelta] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // EF Rescue Mode & Deconstruction states
  const [efMode, setEfMode] = useState(false);
  const [clutterDump, setClutterDump] = useState("");
  const [microSteps, setMicroSteps] = useState<string[]>([]);
  const [activeMicroStepIdx, setActiveMicroStepIdx] = useState(0);
  const [isDeconstructing, setIsDeconstructing] = useState(false);
  const [isQueueingReview, setIsQueueingReview] = useState(false);
  const [hasQueuedReview, setHasQueuedReview] = useState(false);
  const [hasAutoToggledEf, setHasAutoToggledEf] = useState(false);

  // tRPC hooks
  const startTaskMut = trpc.task.start.useMutation();
  const checkTaskMut = trpc.task.check.useMutation();
  const createTaskMut = trpc.task.create.useMutation();
  const updateGoalMut = trpc.task.goalsUpdate.useMutation();
  const recordMemoryMut = trpc.brain.recordMemory.useMutation();
  const deconstructTaskMut = trpc.ai.deconstructTask.useMutation();
  
  // Fetch previous friction survey for preemptive alerts
  const { data: previousMemories } = trpc.brain.memories.useQuery({
    category: "goal_friction_survey",
    limit: 5,
  }, {
    refetchOnWindowFocus: false,
  });

  // Fetch body tracking to intercept low sleep/energy
  const bodyQ = trpc.operator.bodyTracking.useQuery(
    { range: "90d" },
    { staleTime: 60_000, refetchOnWindowFocus: false }
  );

  const entries = bodyQ.data?.entries ?? [];
  const latestBody = entries.length > 0 ? entries[entries.length - 1] : null;

  // Auto-toggle EF Rescue Mode if sleep < 6h or energy <= 2
  useEffect(() => {
    if (latestBody && !hasAutoToggledEf) {
      const sh = latestBody.sleepHours;
      const eg = latestBody.energy;
      const isLowSleep = sh !== null && sh !== undefined && sh < 6;
      const isLowEnergy = eg !== null && eg !== undefined && eg <= 2;
      if (isLowSleep || isLowEnergy) {
        setEfMode(true);
        setTimerDuration(180);
        setTimeLeft(180);
        setHasAutoToggledEf(true);
      }
    }
  }, [latestBody, hasAutoToggledEf]);

  // Extract previous friction for this specific goal
  const previousFriction = previousMemories?.memories?.find(
    (m: any) => m.metadata && typeof m.metadata === "object" && m.metadata.goalId === goal.id
  );
  
  // Initialize mission title based on nextMove or coach advice
  useEffect(() => {
    if (goal.nextMove) {
      setMissionTitle(goal.nextMove.title);
      setActiveTaskId(goal.nextMove.id);
    } else if (latestCoach?.nextAction) {
      setMissionTitle(latestCoach.nextAction);
      setActiveTaskId(null);
    } else {
      setMissionTitle("");
      setActiveTaskId(null);
    }
  }, [goal.nextMove, latestCoach]);

  // Timer logic
  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && timerActive) {
      setTimerActive(false);
      setStep("SURVEY");
      toast.success("Timer finished! Reflect on your session.");
    }
    
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerActive, timeLeft]);

  // Handle Clarity Gate Submit (why text)
  const handleSaveWhy = async () => {
    if (!whyText.trim() || whyText.trim() === goal.why) return;
    setIsSavingWhy(true);
    try {
      await updateGoalMut.mutateAsync({
        id: goal.id,
        why: whyText.trim(),
      });
      toast.success("Goal clarity anchored.");
      onRefresh();
    } catch {
      toast.error("Failed to save why statement.");
    } finally {
      setIsSavingWhy(false);
    }
  };

  // Start the mission
  const handleStartMission = async () => {
    if (!whyText.trim()) {
      toast.error("Anchor your purpose first. Why does this goal matter?");
      return;
    }
    
    let taskId = activeTaskId;
    setIsCreatingTask(true);
    
    try {
      // 1. If we don't have a task in DB yet, create it in Inbox
      if (!taskId) {
        const text = missionTitle.trim() || `Execution Loop: ${goal.title}`;
        const created = await createTaskMut.mutateAsync({
          title: text,
          goalId: goal.id,
          priority: "normal",
          loopKind: "ONCE",
        });
        // Check if the response matches typical task creation result
        const newTask = created as any;
        if (newTask && newTask.task && newTask.task.id) {
          taskId = newTask.task.id;
          setActiveTaskId(taskId);
        }
      }
      
      // 2. Start the task timer in database
      if (taskId) {
        await startTaskMut.mutateAsync({ id: taskId });
      }
      
      // 3. Start local countdown
      setTimeLeft(timerDuration);
      setTimerActive(true);
      setStep("TIMER");
      toast.success("Mission loop initiated. Stay focused.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to initiate mission loop.");
    } finally {
      setIsCreatingTask(false);
    }
  };

  // Skip timer and complete
  const handleCompleteEarly = () => {
    setTimerActive(false);
    setStep("SURVEY");
  };

  // Toggle friction chip selection
  const handleToggleFriction = (key: string) => {
    setSelectedFrictions((prev) => {
      const next = new Set(prev);
      if (key === "none") {
        next.clear();
        next.add("none");
      } else {
        next.delete("none");
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  };

  // Submit friction survey
  const handleSubmitSurvey = async () => {
    if (selectedFrictions.size === 0) {
      toast.error("Select at least one option.");
      return;
    }
    
    try {
      const timestamp = new Date().toISOString();
      const choices = Array.from(selectedFrictions);
      
      // Record friction survey in BrainMemory
      await recordMemoryMut.mutateAsync({
        category: "goal_friction_survey",
        key: `friction:${goal.id}:${timestamp}`,
        content: `Nour flagged friction for goal "${goal.title}": ${choices.join(", ")}`,
        source: "execution_coach",
        metadata: {
          goalId: goal.id,
          frictionChoices: choices,
          timestamp,
        }
      });
      
      setStep("REFLECTION");
    } catch {
      toast.error("Failed to submit friction report.");
    }
  };

  // Shrink the task state choices
  const handleShrinkTask = (durationSeconds: number, shrunkAction: string) => {
    setTimerDuration(durationSeconds);
    setTimeLeft(durationSeconds);
    setMissionTitle(shrunkAction);
    setStep("TIMER");
    setTimerActive(true);
    toast.info(`Task shrunk. Resetting to ${durationSeconds / 60}m focus.`);
  };

  // Queue Spaced Review Card in Learning Tab
  const handleQueueSpacedReview = async () => {
    setIsQueueingReview(true);
    try {
      const topic = `Friction: ${missionTitle || goal.title}`;
      const summary = `Nour hit execution friction ("${Array.from(selectedFrictions).join(", ")}") on task: "${missionTitle || goal.title}" under goal "${goal.title}". Research how to break this down or solve the cognitive block.`;
      const reviewDate = new Date(); // Due immediately
      
      await recordMemoryMut.mutateAsync({
        category: "spaced_review",
        key: `review_friction_${goal.id}_${Date.now()}`,
        content: JSON.stringify({
          topic,
          summary,
          reviewAt: reviewDate.toISOString(),
          interval: 1,
          completed: false,
        }),
        source: "execution_coach",
      });
      setHasQueuedReview(true);
      toast.success("Spaced review card queued in Learning tab.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to queue review card.");
    } finally {
      setIsQueueingReview(false);
    }
  };

  // AI Deconstruct mutation caller
  const handleDeconstruct = async () => {
    if (!missionTitle.trim()) {
      toast.error("Enter a singular step first.");
      return;
    }
    setIsDeconstructing(true);
    try {
      const res = await deconstructTaskMut.mutateAsync({
        taskTitle: missionTitle.trim(),
        goalTitle: goal.title,
      });
      if (res && Array.isArray(res.steps) && res.steps.length > 0) {
        setMicroSteps(res.steps);
        setActiveMicroStepIdx(0);
        toast.success(`Action deconstructed into ${res.steps.length} micro-steps.`);
      } else {
        toast.error("AI returned empty steps.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to deconstruct task.");
    } finally {
      setIsDeconstructing(false);
    }
  };

  // Final submit reflection and update database
  const handleFinishLoop = async () => {
    setIsSubmitting(true);
    try {
      const timestamp = new Date().toISOString();
      
      // 1. If we completed a task, mark it complete in DB
      if (activeTaskId) {
        await checkTaskMut.mutateAsync({
          id: activeTaskId,
          action: "complete",
          completionNote: seedAction ? `Completed loop. Next seed: ${seedAction}` : "Completed loop.",
        });
      }
      
      // 2. Log progress delta (+N metric units) if provided
      const delta = parseFloat(progressDelta);
      if (Number.isFinite(delta) && delta > 0) {
        await updateGoalMut.mutateAsync({
          id: goal.id,
          progressDelta: delta,
        });
      }
      
      // 3. Save the full checkin data to BrainMemory (category: goal_execution_checkin)
      const checkinMetadata: Record<string, any> = {
        goalId: goal.id,
        taskId: activeTaskId,
        frictionChoices: Array.from(selectedFrictions),
        seedAction,
        progressDelta: delta || 0,
        timestamp,
      };

      if (efMode && clutterDump.trim()) {
        checkinMetadata.clutterDump = clutterDump.trim();
      }

      await recordMemoryMut.mutateAsync({
        category: "goal_execution_checkin",
        key: `checkin:${goal.id}:${timestamp}`,
        content: `Goal execution check-in completed. Progress: +${progressDelta || 0} ${goal.unit}. Tomorrow's action: ${seedAction || "None"}.${
          efMode && clutterDump.trim() ? ` Clutter dump: ${clutterDump.trim()}` : ""
        }`,
        source: "execution_coach",
        metadata: checkinMetadata,
      });

      // 4. Award XP under mastery_xp_event category
      const baseXP = efMode ? 12.5 : 10;
      const mappedStat = resolveGoalStat(goal.domain);

      if (mappedStat) {
        await recordMemoryMut.mutateAsync({
          category: "mastery_xp_event",
          key: `goal-loop:${goal.id}:${timestamp}:${mappedStat}`,
          content: `Completed execution loop for goal "${goal.title}" (+${baseXP} XP to ${mappedStat})`,
          source: "execution_coach",
          metadata: {
            stat: mappedStat,
            xp: baseXP,
            signal: "task",
          },
        });
      } else {
        const splitXP = efMode ? 6.3 : 5.0;
        await recordMemoryMut.mutateAsync({
          category: "mastery_xp_event",
          key: `goal-loop:${goal.id}:${timestamp}:discipline`,
          content: `Completed execution loop for goal "${goal.title}" (+${splitXP} XP to discipline)`,
          source: "execution_coach",
          metadata: {
            stat: "discipline",
            xp: splitXP,
            signal: "task",
          },
        });
        await recordMemoryMut.mutateAsync({
          category: "mastery_xp_event",
          key: `goal-loop:${goal.id}:${timestamp}:mental`,
          content: `Completed execution loop for goal "${goal.title}" (+${splitXP} XP to focus/mental)`,
          source: "execution_coach",
          metadata: {
            stat: "mental",
            xp: splitXP,
            signal: "task",
          },
        });
      }
      
      setStep("COMPLETED");
      toast.success(`Execution loop completed! XP +${baseXP} credited.`);
      onRefresh();
    } catch (err) {
      console.error(err);
      toast.error("Error finalizing loop.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset sandbox back to briefing step
  const handleReset = () => {
    setStep("BRIEFING");
    setSelectedFrictions(new Set());
    setSeedAction("");
    setProgressDelta("");
    setTimerDuration(600);
    setTimeLeft(600);
    setClutterDump("");
    setMicroSteps([]);
    setActiveMicroStepIdx(0);
    setHasQueuedReview(false);
  };

  // Format time remaining
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Parse friction label for preemptive alert
  const getPreemptiveAlert = () => {
    if (!previousFriction) return null;
    try {
      const meta = previousFriction.metadata as any;
      if (meta && Array.isArray(meta.frictionChoices)) {
        const choices = meta.frictionChoices.filter((c: string) => c !== "none");
        if (choices.length > 0) {
          const names = choices.map((c: string) => {
            const found = FRICTION_OPTIONS.find((o) => o.key === c);
            return found ? found.label.toLowerCase() : c;
          });
          return `You hit ${names.join(" & ")} issues last time. Shrink this task immediately to protect momentum.`;
        }
      }
    } catch {}
    return null;
  };

  const preemptiveAlert = getPreemptiveAlert();

  const isLowSleep = latestBody?.sleepHours !== null && latestBody?.sleepHours !== undefined && latestBody.sleepHours < 6;
  const isLowEnergy = latestBody?.energy !== null && latestBody?.energy !== undefined && latestBody.energy <= 2;
  const hasPhysicalDeficit = isLowSleep || isLowEnergy;

  return (
    <div className="relative rounded-lg border border-zinc-800/40 bg-zinc-950/40 p-4 space-y-4 shadow-xl overflow-hidden">
      
      {/* Decorative gradient overlay */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
      
      {/* STEP 1: BRIEFING / CLARITY GATE */}
      {step === "BRIEFING" && (
        <div className="space-y-4 animate-fade-in">
          <header className="flex items-center gap-2">
            <Sparkles size={14} className="text-amber-400" />
            <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-300">
              execution briefing
            </h4>
          </header>

          {/* Goal Why / Clarity Anchor */}
          <div className="space-y-1.5 p-3 rounded-md bg-zinc-900/40 border border-zinc-800/40">
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wide">
              Clarity Anchor (Why it matters)
            </span>
            {goal.why ? (
              <p className="text-[12px] text-zinc-200 italic leading-relaxed">
                &ldquo;{goal.why}&rdquo;
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-amber-400/90 font-medium italic">
                  Nour, why does this matter? Define it before we start:
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. To secure financial sovereignty and ship our vision."
                    value={whyText}
                    onChange={(e) => setWhyText(e.target.value)}
                    className="h-8 text-[11.5px] bg-zinc-950/40 border-zinc-800 focus:border-amber-500/30"
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveWhy}
                    disabled={isSavingWhy || !whyText.trim()}
                    className="h-8 px-3 text-[10px] font-mono bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    {isSavingWhy ? <Loader2 size={10} className="animate-spin" /> : "Anchor"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Physical Deficit Interceptor Alert */}
          {hasPhysicalDeficit && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-500/[0.03] border border-amber-500/10 text-amber-400/90 text-[11px] leading-relaxed">
              <ShieldAlert size={14} className="text-amber-400 mt-0.5 shrink-0 animate-pulse" />
              <div>
                <p className="font-bold uppercase tracking-wider text-[9.5px] text-amber-300 mb-0.5">Physical deficit warning</p>
                <p>
                  {isLowSleep && `Sleep is low (${latestBody?.sleepHours}h today). `}
                  {isLowEnergy && `Energy level is low (${latestBody?.energy}/5 today). `}
                  Keep activation energy low. The timer is capped at 3 minutes; shrink this task to one physical step.
                </p>
              </div>
            </div>
          )}

          {/* Preemptive Alert */}
          {preemptiveAlert && (
            <div className="flex items-start gap-2.5 p-2.5 rounded-md bg-rose-500/[0.03] border border-rose-500/10 text-rose-300/90 text-[10.5px]">
              <ShieldAlert size={13} className="text-rose-400 mt-0.5 shrink-0" />
              <p>{preemptiveAlert}</p>
            </div>
          )}

          {/* Singular Mission Definition */}
          <div className="space-y-1.5">
            <label htmlFor="mission-step" className="text-[9px] font-mono text-zinc-500 uppercase tracking-wide">
              Today's singular physical step
            </label>
            <div className="flex gap-2">
              <Input
                id="mission-step"
                placeholder="What is the exact physical next step?"
                value={missionTitle}
                onChange={(e) => setMissionTitle(e.target.value)}
                className="h-9 text-[12.5px] bg-zinc-900/60 border-zinc-800 focus:border-amber-500/40 font-medium text-zinc-100"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDeconstruct}
                disabled={isDeconstructing || !missionTitle.trim()}
                className="h-9 px-3 text-[10px] font-mono bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-amber-400 hover:text-amber-300 gap-1.5 whitespace-nowrap shrink-0"
              >
                {isDeconstructing ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Sparkles size={11} />
                )}
                Deconstruct
              </Button>
            </div>
            {latestCoach?.nextAction && latestCoach.nextAction !== missionTitle && (
              <button
                type="button"
                onClick={() => setMissionTitle(latestCoach.nextAction)}
                className="text-[9px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 mt-1 transition-all"
              >
                <span>Suggest: &ldquo;{latestCoach.nextAction}&rdquo;</span>
                <ArrowRight size={8} />
              </button>
            )}
          </div>

          {/* AI Micro-steps Display */}
          {microSteps.length > 0 && (
            <div className="space-y-2 p-3 rounded-md bg-zinc-900/50 border border-zinc-800/60">
              <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wide flex justify-between items-center">
                <span>AI Micro-Steps</span>
                <button
                  type="button"
                  onClick={() => setMicroSteps([])}
                  className="text-zinc-600 hover:text-zinc-400 text-[8px]"
                >
                  Clear
                </button>
              </span>
              <ol className="space-y-1.5 list-decimal list-inside text-[11.5px] text-zinc-300">
                {microSteps.map((s, idx) => (
                  <li key={idx} className={cn("leading-relaxed", idx === activeMicroStepIdx && "text-amber-400 font-medium")}>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* EF Focus Mode toggle */}
          <div className="flex items-center justify-between p-3 rounded-md bg-zinc-900/40 border border-zinc-800/40">
            <div className="space-y-0.5">
              <span className="text-[11px] font-bold text-zinc-200">
                EF Rescue Focus
              </span>
              <p className="text-[9.5px] text-zinc-500">
                Cap timer to 3m, open distraction-free fullscreen overlay, dump mental clutter.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const newMode = !efMode;
                setEfMode(newMode);
                if (newMode) {
                  setTimerDuration(180);
                  setTimeLeft(180);
                } else {
                  setTimerDuration(600);
                  setTimeLeft(600);
                }
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                efMode ? "bg-amber-500" : "bg-zinc-700"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-zinc-950 shadow ring-0 transition duration-200 ease-in-out",
                  efMode ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {/* Working Memory Clutter Dump */}
          {efMode && (
            <div className="space-y-1.5 animate-fade-in">
              <label htmlFor="clutter-dump" className="text-[9px] font-mono text-zinc-500 uppercase tracking-wide">
                Mental Clutter Dump (Ephemeral)
              </label>
              <textarea
                id="clutter-dump"
                placeholder="Dump whatever is distracting or cluttering your mind right now to free your attention..."
                value={clutterDump}
                onChange={(e) => setClutterDump(e.target.value)}
                className="w-full min-h-[70px] p-2.5 rounded-md text-[11.5px] bg-zinc-900/60 border border-zinc-800 focus:border-amber-500/40 focus:ring-0 text-zinc-100 placeholder-zinc-600 resize-none leading-relaxed"
              />
            </div>
          )}

          {/* Horizon Selection */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
              Focus span:
            </span>
            {[
              { label: efMode ? "3m Focus" : "10m Focus", value: efMode ? 180 : 600 },
              { label: "2m Micro", value: 120 },
            ].map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  setTimerDuration(o.value);
                  setTimeLeft(o.value);
                }}
                className={cn(
                  "text-[8px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-all",
                  timerDuration === o.value
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-zinc-800 text-zinc-600 hover:text-zinc-400"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          <Button
            onClick={handleStartMission}
            disabled={isCreatingTask || !missionTitle.trim() || !whyText.trim()}
            className="w-full h-10 text-[11px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500 hover:text-black transition-all flex items-center justify-center gap-2"
          >
            {isCreatingTask ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={11} fill="currentColor" />
            )}
            Initiate Loop
          </Button>
        </div>
      )}

      {/* STEP 2: TIMER (ENGAGEMENT / FOCUS MODE) */}
      {/* Fullscreen distraction-free EF Rescue Mode Focus view */}
      {step === "TIMER" && efMode && (
        <div className="fixed inset-0 z-50 bg-zinc-950/98 backdrop-blur-md flex flex-col justify-between p-8 text-center animate-fade-in">
          {/* Top header */}
          <div className="flex justify-between items-center w-full max-w-2xl mx-auto border-b border-zinc-800/40 pb-4">
            <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-amber-500 flex items-center gap-1.5">
              <ShieldAlert size={14} className="text-amber-500 animate-pulse" />
              EF Rescue Focus Mode
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEfMode(false)}
              className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300 uppercase tracking-wider h-7 px-2 hover:bg-zinc-900"
            >
              Exit Focus View
            </Button>
          </div>

          {/* Middle Body */}
          <div className="flex-1 flex flex-col justify-center items-center max-w-2xl mx-auto space-y-8 py-8">
            {microSteps.length > 0 ? (
              <div className="space-y-4">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono uppercase tracking-wider">
                  Step {activeMicroStepIdx + 1} of {microSteps.length}
                </span>
                <h2 className="text-2xl md:text-4xl text-zinc-100 font-extrabold leading-normal select-none tracking-tight">
                  {microSteps[activeMicroStepIdx]}
                </h2>
              </div>
            ) : (
              <div className="space-y-4">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono uppercase tracking-wider">
                  Singular Action
                </span>
                <h2 className="text-2xl md:text-3xl text-zinc-100 font-extrabold leading-normal select-none tracking-tight">
                  {missionTitle}
                </h2>
              </div>
            )}

            {/* Countdown Display */}
            <div className="space-y-2 select-none">
              <div className="text-6xl md:text-8xl font-black font-mono text-zinc-100 tracking-tighter tabular-nums animate-pulse">
                {formatTime(timeLeft)}
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">
                time remaining
              </span>
            </div>

            <p className="text-[12px] text-zinc-400 italic max-w-md mx-auto leading-relaxed">
              No distractions, Nour. Defend this focus window. One small move.
            </p>
          </div>

          {/* Bottom actions */}
          <div className="w-full max-w-2xl mx-auto pt-4 border-t border-zinc-800/40 flex flex-col gap-3">
            <div className="flex gap-3">
              {microSteps.length > 0 && activeMicroStepIdx < microSteps.length - 1 ? (
                <Button
                  onClick={() => setActiveMicroStepIdx((prev) => prev + 1)}
                  className="flex-1 h-12 text-[12px] font-bold uppercase tracking-wider bg-amber-500 text-black hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/10"
                >
                  Next Step (AI) →
                </Button>
              ) : (
                <Button
                  onClick={handleCompleteEarly}
                  className="flex-1 h-12 text-[12px] font-bold uppercase tracking-wider bg-emerald-500 text-black hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/10"
                >
                  Complete Mission ✓
                </Button>
              )}

              <Button
                onClick={() => setStep("RESISTANCE")}
                className="h-12 px-6 text-[11px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20 transition-all"
              >
                Resistance
              </Button>
            </div>
            
            <button
              onClick={() => {
                setTimerActive(false);
                setStep("BRIEFING");
              }}
              className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 uppercase tracking-widest py-1 transition-all"
            >
              Cancel Focus Session
            </button>
          </div>
        </div>
      )}

      {/* Normal Timer View (when EF Focus view is not active) */}
      {step === "TIMER" && !efMode && (
        <div className="space-y-5 py-2 text-center animate-fade-in relative z-10">
          <div className="space-y-1">
            <span className="text-[9px] font-mono uppercase tracking-[0.25em] text-zinc-500">
              Focusing on step
            </span>
            <p className="text-[14px] font-bold text-zinc-100 max-w-[280px] mx-auto leading-snug">
              {missionTitle}
            </p>
          </div>

          {/* Visual Timer Dial */}
          <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
            <svg className="w-28 h-28 -rotate-90">
              <circle
                cx="56"
                cy="56"
                r="48"
                fill="none"
                stroke="rgba(39, 39, 42, 0.4)"
                strokeWidth="4"
              />
              <circle
                cx="56"
                cy="56"
                r="48"
                fill="none"
                stroke="rgb(245, 158, 11)"
                strokeWidth="4"
                strokeDasharray={`${(timeLeft / timerDuration) * 301.5} 301.5`}
                strokeLinecap="round"
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[20px] font-bold font-mono text-zinc-100 tabular-nums leading-none">
                {formatTime(timeLeft)}
              </span>
              <span className="text-[8px] font-mono uppercase tracking-widest text-zinc-500 mt-1">
                remaining
              </span>
            </div>
          </div>

          <p className="text-[10px] text-zinc-500 italic max-w-[240px] mx-auto leading-relaxed">
            Nour, defend this window. Hiding interface distraction. Just run the loop.
          </p>

          <div className="flex gap-2">
            <Button
              onClick={handleCompleteEarly}
              className="flex-1 h-9 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition-all"
            >
              <Check size={11} className="mr-1" />
              Complete
            </Button>
            <Button
              onClick={() => setStep("RESISTANCE")}
              className="h-9 px-3 text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/20 hover:bg-rose-500/25 hover:text-rose-200 transition-all"
            >
              Resistance
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: RESISTANCE / SHRINK TASK */}
      {step === "RESISTANCE" && (
        <div className="space-y-4 animate-fade-in">
          <header className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-rose-400" />
            <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-rose-300">
              resistance protocol
            </h4>
          </header>

          <div className="space-y-1">
            <p className="text-[12px] font-bold text-zinc-200 leading-snug">
              &ldquo;Relentless execution is about momentum, not scale.&rdquo;
            </p>
            <p className="text-[10.5px] text-zinc-400 leading-relaxed">
              If the task is blocking you, shrink it instantly until it's impossible to fail.
            </p>
          </div>

          <div className="space-y-1.5 pt-1">
            <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">
              Choose micro action:
            </span>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => handleShrinkTask(120, `Do 2 mins on: ${missionTitle}`)}
                className="w-full text-left p-2.5 rounded border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900 hover:border-zinc-700 transition-all flex justify-between items-center text-[11px]"
              >
                <span>Just do 2 minutes</span>
                <span className="text-[9px] font-mono text-zinc-500">120s</span>
              </button>
              <button
                onClick={() => handleShrinkTask(60, `Just open the tool/document for: ${missionTitle}`)}
                className="w-full text-left p-2.5 rounded border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900 hover:border-zinc-700 transition-all flex justify-between items-center text-[11px]"
              >
                <span>Just open the document/tool</span>
                <span className="text-[9px] font-mono text-zinc-500">60s</span>
              </button>
              <button
                onClick={() => handleShrinkTask(60, `Write/execute one word or line for: ${missionTitle}`)}
                className="w-full text-left p-2.5 rounded border border-zinc-800 bg-zinc-950/20 hover:bg-zinc-900 hover:border-zinc-700 transition-all flex justify-between items-center text-[11px]"
              >
                <span>Write one word / line</span>
                <span className="text-[9px] font-mono text-zinc-500">60s</span>
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => setStep("TIMER")}
              className="flex-1 h-8 text-[9px] font-mono uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
            >
              Resume Focus
            </Button>
            <Button
              onClick={() => setStep("SURVEY")}
              className="flex-1 h-8 text-[9px] font-mono uppercase bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20"
            >
              Exit Loop
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: RESOLUTION & FRICTION SURVEY */}
      {step === "SURVEY" && (
        <div className="space-y-4 animate-fade-in">
          <header className="flex items-center gap-2">
            <Timer size={14} className="text-violet-400" />
            <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300">
              friction survey
            </h4>
          </header>

          <div className="space-y-1">
            <p className="text-[11.5px] text-zinc-300 leading-snug">
              Nour, analyze the execution. What was the main source of resistance?
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {FRICTION_OPTIONS.map((opt) => {
              const active = selectedFrictions.has(opt.key);
              return (
                <button
                  key={opt.key}
                  onClick={() => handleToggleFriction(opt.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] transition-all hover:scale-[1.02]",
                    active
                      ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                      : "border-zinc-800 bg-zinc-900/30 text-zinc-400"
                  )}
                >
                  <span aria-hidden>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <Button
            onClick={handleSubmitSurvey}
            disabled={selectedFrictions.size === 0}
            className="w-full h-9 text-[10px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500 hover:text-black transition-all"
          >
            Submit & Continue
          </Button>
        </div>
      )}

      {/* STEP 5: REFLECTION & CAPTURE */}
      {step === "REFLECTION" && (
        <div className="space-y-4 animate-fade-in">
          <header className="flex items-center gap-2">
            <Sparkles size={14} className="text-emerald-400" />
            <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-300">
              reflection & logging
            </h4>
          </header>

          <div className="space-y-3">
            {/* Seed action */}
            <div className="space-y-1.5">
              <label htmlFor="seed-action" className="text-[9.5px] font-mono text-zinc-500 uppercase tracking-wide">
                Tomorrow's seed action
              </label>
              <Input
                id="seed-action"
                placeholder="What is the singular starting move for tomorrow?"
                value={seedAction}
                onChange={(e) => setSeedAction(e.target.value)}
                className="h-8.5 text-[12px] bg-zinc-900/60 border-zinc-800 focus:border-emerald-500/40"
              />
            </div>

            {/* Goal Metric Delta */}
            {goal.targetValue > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="metric-delta" className="text-[9.5px] font-mono text-zinc-500 uppercase tracking-wide">
                  Log progress ({goal.metric || "current"}: {goal.currentValue}/{goal.targetValue} {goal.unit})
                </label>
                <div className="flex gap-2">
                  <Input
                    id="metric-delta"
                    type="number"
                    step="any"
                    placeholder={`+Value in ${goal.unit || "units"}`}
                    value={progressDelta}
                    onChange={(e) => setProgressDelta(e.target.value)}
                    className="h-8.5 text-[12px] bg-zinc-900/60 border-zinc-800 focus:border-emerald-500/40"
                  />
                </div>
              </div>
            )}

            {/* Learning Spaced Repetition queueing option */}
            {(selectedFrictions.has("vague") || selectedFrictions.has("low-energy")) && (
              <div className="p-3 rounded-md bg-zinc-900/40 border border-zinc-800/40 space-y-2">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                    <BookOpen size={11} className="text-amber-400" />
                    Continuous Learning
                  </span>
                  <p className="text-[11px] text-zinc-500 leading-normal">
                    You flagged execution friction. Queue a spaced review card in the Learning tab to resolve this block.
                  </p>
                </div>
                {hasQueuedReview ? (
                  <div className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5 py-1">
                    <CheckCircle2 size={13} />
                    Review card queued successfully.
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleQueueSpacedReview}
                    disabled={isQueueingReview}
                    className="w-full h-8 text-[10.5px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium flex items-center justify-center gap-1.5"
                  >
                    {isQueueingReview ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <>
                        <ArrowUpRight size={12} />
                        Queue Spaced Review Card
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>

          <Button
            onClick={handleFinishLoop}
            disabled={isSubmitting}
            className="w-full h-9 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500 hover:text-black transition-all flex items-center justify-center gap-1"
          >
            {isSubmitting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <CheckCircle2 size={11} />
            )}
            Finish Loop & Credit XP
          </Button>
        </div>
      )}

      {/* STEP 6: COMPLETED */}
      {step === "COMPLETED" && (
        <div className="space-y-4 py-3 text-center animate-fade-in">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center mx-auto text-emerald-400 animate-pulse">
            <CheckCircle2 size={24} />
          </div>

          <div className="space-y-1">
            <h4 className="text-[13px] font-bold text-zinc-100 uppercase tracking-wider">
              Loop Closed
            </h4>
            <p className="text-[11px] text-zinc-400">
              Momentum locked in. +{efMode ? "12.5" : "10"} XP credited to character sheet.
            </p>
          </div>

          <div className="p-3 rounded-md bg-zinc-900/40 border border-zinc-800/40 text-left text-[11px] space-y-2 max-w-[280px] mx-auto">
            <div className="flex justify-between">
              <span className="text-zinc-500 font-mono text-[9px] uppercase">Goal</span>
              <span className="text-zinc-300 font-medium truncate max-w-[180px]">{goal.title}</span>
            </div>
            
            {seedAction && (
              <div className="flex flex-col gap-0.5 border-t border-zinc-800/60 pt-1.5">
                <span className="text-zinc-500 font-mono text-[9px] uppercase">Tomorrow's Seed</span>
                <span className="text-zinc-200 italic">&ldquo;{seedAction}&rdquo;</span>
              </div>
            )}

            {progressDelta && (
              <div className="flex justify-between border-t border-zinc-800/60 pt-1.5">
                <span className="text-zinc-500 font-mono text-[9px] uppercase">Metric delta</span>
                <span className="text-emerald-400 font-bold">+{progressDelta} {goal.unit}</span>
              </div>
            )}
          </div>

          <Button
            onClick={handleReset}
            className="w-full h-8 text-[9px] font-mono uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
          >
            Run Another Loop
          </Button>
        </div>
      )}
    </div>
  );
}
