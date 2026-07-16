"use client";

/**
 * REFLECT COMPOSER — structured reflection entry for /journal.
 *
 * Four templates Nour can switch between on the fly:
 *   • SOAP                    (clinical: subjective/objective/assessment/plan)
 *   • What / So What / Now What (Driscoll — simpler, ADHD-friendly)
 *   • Stop / Start / Continue  (retrospective)
 *   • After-Action Review      (military: expected/happened/lesson/adjust)
 *
 * Each field is one or two lines — deliberately short. Tab moves between.
 * Submit → POST /api/ultron/reflect → stores a Reflection row.
 *
 * On submit Nick offers ONE counter-question to push Nour's reasoning.
 * Then the MemoryCalibration card surfaces inline so the loop closes:
 * reflect → verify past beliefs → next reflection builds on calibrated
 * context. True circular practice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import { Eye, Sparkles, ArrowRight, Loader2, ChevronDown, Target, RotateCcw, X as XIcon, Info } from "lucide-react";
import { MemoryCalibrationRitual } from "./memory-calibration";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";

import { trpc } from "@/lib/trpc/client";

// 2026-05-24 · Wave R · structured logger so submit/draft-persist
// failures show in /system/errors rather than disappearing into a
// silent `catch {}`. Pre-fix the operator hit "save failed" toast
// with zero breadcrumb · could not diagnose retries.
const log = rootLogger.withSurface("journal/reflect-composer");
type Template = "soap" | "driscoll" | "ssc" | "aar";

interface TemplateDef {
  key: Template;
  label: string;
  tagline: string;
  fields: Array<{ key: string; label: string; placeholder: string }>;
}

const TEMPLATES: TemplateDef[] = [
  {
    key: "driscoll",
    label: "What · So What · Now What",
    tagline: "fastest — 3 short lines",
    fields: [
      { key: "what",     label: "what",     placeholder: "what actually happened" },
      { key: "so_what",  label: "so what",  placeholder: "what does it mean / why does it matter" },
      { key: "now_what", label: "now what", placeholder: "what changes next" },
    ],
  },
  {
    key: "soap",
    label: "SOAP",
    tagline: "clinical",
    fields: [
      { key: "subjective", label: "subjective", placeholder: "how you felt / thought it went" },
      { key: "objective",  label: "objective",  placeholder: "what the data shows" },
      { key: "assessment", label: "assessment", placeholder: "your read on it" },
      { key: "plan",       label: "plan",       placeholder: "what you're doing about it" },
    ],
  },
  {
    key: "ssc",
    label: "Stop · Start · Continue",
    tagline: "retrospective",
    fields: [
      { key: "stop",     label: "stop",     placeholder: "one thing to stop doing" },
      { key: "start",    label: "start",    placeholder: "one thing to start doing" },
      { key: "continue", label: "continue", placeholder: "one thing that's working" },
    ],
  },
  {
    key: "aar",
    label: "After-Action Review",
    tagline: "military · for a specific event",
    fields: [
      { key: "expected", label: "expected", placeholder: "what was supposed to happen" },
      { key: "happened", label: "happened", placeholder: "what actually happened" },
      { key: "lesson",   label: "lesson",   placeholder: "what you learned" },
      { key: "adjust",   label: "adjust",   placeholder: "what you change" },
    ],
  },
];

const MOODS: Array<{ emoji: string; label: string }> = [
  { emoji: "🎯", label: "focused" },
  { emoji: "🔥", label: "motivated" },
  { emoji: "🌊", label: "calm" },
  { emoji: "🪞", label: "reflective" },
  { emoji: "⚡", label: "energized" },
  { emoji: "😤", label: "frustrated" },
  { emoji: "😴", label: "tired" },
  { emoji: "🌪️", label: "scattered" },
];

const LAST_TEMPLATE_KEY = "ultron:reflect:last-template";
const DRAFT_KEY = "ultron:reflect:draft";
// v10.0.529.25 · /journal audit #R · persist the extract-intelligence
// toggle across sessions so the operator's preference sticks. AAR +
// SSC reflections often contain action items, so a power-user who
// always wants extraction shouldn't have to re-toggle every time.
const EXTRACT_TOGGLE_KEY = "ultron:reflect:extract-intelligence";

export function ReflectComposer() {
  const [templateKey, setTemplateKey] = useState<Template>("driscoll");
  const [showPicker, setShowPicker] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [mood, setMood] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [pushback, setPushback] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState<"bet" | "memory-check" | "done" | null>(null);
  const [showCalibration, setShowCalibration] = useState(false);
  // v10.0.529.25 · /journal audit #R · opt-in extraction toggle. OFF
  // by default · this is the architectural-split surfacing: by
  // default reflections stay LIGHTWEIGHT (Reflection row + Nick
  // pushback) and don't run the full AI extraction pipeline. When
  // ON, the reflection text additionally flows through
  // ingestJournal · action items go to Task INBOX, commitments to
  // the ledger, insights to brain memory, and pgvector embedding
  // runs for the reflection text. Persisted in localStorage.
  const [extractIntelligence, setExtractIntelligence] = useState(false);
  const [showSplitHelp, setShowSplitHelp] = useState(false);

  // Phase TT.2 (2026-05-22) · REST→tRPC · the reflection submit is now
  // a typed mutation. The input shape is pinned by the SHARED
  // reflectSubmitSchema (lib/validators/journal) — the same schema the
  // REST route's safeParseBody parses — so the client payload can't
  // drift from what the server accepts (the typed-payload-mismatch
  // guard, the /tasks quick-add bug class).
  const reflectMutation = trpc.journal.reflect.useMutation();

  // Hydrate last-used template + any draft on mount. Also honor #reflect
  // or ?seed=... hash from the Ultron /reflect slash so the composer
  // auto-scrolls + pre-fills the first field.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cleanupFocusListener: (() => void) | undefined;
    try {
      const savedTemplate = localStorage.getItem(LAST_TEMPLATE_KEY);
      if (savedTemplate === "soap" || savedTemplate === "driscoll" || savedTemplate === "ssc" || savedTemplate === "aar") {
        setTemplateKey(savedTemplate);
      }
      // v10.0.529.25 · hydrate the extract-intelligence preference.
      // "true" / "false" only · ignore other values so corrupted
      // localStorage doesn't crash the composer.
      const savedExtract = localStorage.getItem(EXTRACT_TOGGLE_KEY);
      if (savedExtract === "true") setExtractIntelligence(true);
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft) as { fields?: Record<string, string>; mood?: string; templateKey?: Template };
        if (parsed.fields) setFields(parsed.fields);
        if (parsed.mood) setMood(parsed.mood);
        if (parsed.templateKey) setTemplateKey(parsed.templateKey);
      }

      // UI wave (audit 2026-07-15) · listener for the focus event
      // TodaysPrompt has dispatched since it shipped — grep-verified NO
      // listener existed anywhere, so "answer now" only ever scrolled
      // (its own fallback) and never focused the composer.
      const focusComposer = () => {
        requestAnimationFrame(() => {
          document.getElementById("journal-reflect-composer")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          document
            .querySelector<HTMLTextAreaElement>("#journal-reflect-composer textarea")
            ?.focus();
        });
      };
      window.addEventListener("nour:journal-focus-composer", focusComposer);
      cleanupFocusListener = () =>
        window.removeEventListener("nour:journal-focus-composer", focusComposer);

      // Hash-driven entry (from Ultron /reflect slash or the "reflect tonight?" nudge)
      const hash = window.location.hash;
      if (hash.includes("reflect")) {
        requestAnimationFrame(() => {
          document.getElementById("journal-reflect-composer")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          const firstField = document.querySelector<HTMLTextAreaElement>(
            "#journal-reflect-composer textarea",
          );
          firstField?.focus();
        });
        // Pre-fill first field with seed, if provided
        const seedMatch = hash.match(/seed=([^&]+)/);
        if (seedMatch) {
          try {
            const seed = decodeURIComponent(seedMatch[1]);
            // First field of whichever template loaded
            setFields((prev) => {
              const effectiveTemplate: Template =
                savedTemplate === "soap" || savedTemplate === "driscoll" || savedTemplate === "ssc" || savedTemplate === "aar"
                  ? savedTemplate
                  : "driscoll";
              const t = TEMPLATES.find((x) => x.key === effectiveTemplate) ?? TEMPLATES[0];
              const firstKey = t.fields[0].key;
              return { ...prev, [firstKey]: prev[firstKey] || seed };
            });
          } catch {}
        }
      }
    } catch {}
    return () => cleanupFocusListener?.();
  }, []);

  // Persist draft on every change so a refresh doesn't lose what he wrote
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const hasContent = Object.values(fields).some((v) => v.trim());
      if (hasContent || mood) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ fields, mood, templateKey }));
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {}
  }, [fields, mood, templateKey]);

  const tmpl = useMemo(() => TEMPLATES.find((t) => t.key === templateKey)!, [templateKey]);

  const filledCount = useMemo(
    () => tmpl.fields.filter((f) => (fields[f.key] ?? "").trim()).length,
    [tmpl.fields, fields],
  );

  const setTemplate = (key: Template) => {
    setTemplateKey(key);
    setShowPicker(false);
    try { localStorage.setItem(LAST_TEMPLATE_KEY, key); } catch {}
  };

  const submit = useCallback(async () => {
    if (filledCount === 0) {
      toast.error("at least one field");
      return;
    }
    setSubmitting(true);
    setPushback(null);
    setNextStep(null);
    try {
      // Phase TT.2 · typed mutation · tRPC returns the result
      // unwrapped (no { data } envelope · the REST route had one).
      const result = await reflectMutation.mutateAsync({
        template: templateKey,
        fields,
        mood: mood || undefined,
        askPushback: true,
        // pass the toggle so the service knows whether to also run
        // ingestJournal on this reflection.
        extractIntelligence,
      });
      setPushback(result.pushback ?? null);
      setNextStep(result.nextStep ?? "done");
      // v10.0.529.25 · surface extraction confirmation when fired ·
      // ingestJournal runs server-side fire-and-forget so the operator
      // gets a "starting" signal here rather than waiting on
      // completion. The /journal feed will refresh when the BrainDump
      // lands via the data-change event below.
      toast.success(result.extractionFired ? "reflection logged · extracting…" : "reflection logged");
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      notifyDataChanged("any", { source: "ultron-reflect", detail: "reflection-saved" });
      // Auto-surface calibration when the model suggests memory-check
      if (result.nextStep === "memory-check") setShowCalibration(true);
    } catch (err) {
      // 2026-05-24 · Wave R · Wave-M class fix · pre-fix the catch
      // was bare with only `toast.error("save failed")` · zero log
      // breadcrumb · operator retried blind. Now: structured log
      // lands in /system/errors with the template + sanitized
      // payload so /system/quality + the cost-anomaly cron can
      // correlate failures against the affected feature.
      log.error("reflect_submit_failed", {
        template: templateKey,
        filledCount,
        error: sanitizeError(err),
      });
      toast.error(
        err instanceof Error && err.message
          ? `save failed · ${err.message.slice(0, 80)}`
          : "save failed",
      );
    } finally {
      setSubmitting(false);
    }
  }, [templateKey, fields, mood, filledCount, extractIntelligence, reflectMutation]);

  const resetForNext = () => {
    setFields({});
    setMood("");
    setPushback(null);
    setNextStep(null);
    setShowCalibration(false);
  };

  const toggleCalibration = () => setShowCalibration((v) => !v);

  // v10.0.529.25 · /journal audit #R · persist the toggle on flip so
  // the preference sticks across sessions. localStorage write is sync
  // + cheap · no debounce needed for a binary state.
  const toggleExtract = useCallback(() => {
    setExtractIntelligence((v) => {
      const next = !v;
      try { localStorage.setItem(EXTRACT_TOGGLE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  // ── Render ──────────────────────────────────────────
  return (
    <section id="journal-reflect-composer" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3 scroll-mt-24">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Eye size={12} className="text-emerald-400" />
        <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-emerald-400">
          reflect
        </span>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
          · {tmpl.label.toLowerCase()}
        </span>

        {/* Template picker */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowPicker((v) => !v)}
            className="flex items-center gap-1 text-[9px] font-mono text-[var(--text-tertiary)] hover:text-emerald-400"
            aria-label="switch template"
          >
            switch <ChevronDown size={10} />
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-md border border-emerald-500/30 bg-[var(--bg-void)] shadow-lg overflow-hidden">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTemplate(t.key)}
                  className={cn(
                    "w-full text-left px-3 py-2 hover:bg-emerald-500/10 transition-colors border-b border-[var(--border-default)] last:border-b-0",
                    t.key === templateKey && "bg-emerald-500/10",
                  )}
                >
                  <p className="text-[11px] text-[var(--text-primary)] font-medium">{t.label}</p>
                  <p className="text-[9px] text-[var(--text-tertiary)]">{t.tagline}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2026-05-24 · Wave S #4 · Ghost counter-question. The composer
          docstring (line 17) has long promised "ONE counter-question to
          push Nour's reasoning" but nothing was wired · this surfaces
          ghost-nick's highest-confidence prediction reshaped as a
          question. Silent when ghost-nick has nothing to say. Dismiss
          via the × is intentionally local-only (no need to persist
          dismissals · the prediction set rotates daily). */}
      <GhostCounterQuestionInline />

      {/* Fields */}
      <div className="space-y-1.5">
        {tmpl.fields.map((f) => (
          <div key={f.key}>
            <label className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] block mb-0.5">
              {f.label}
            </label>
            <textarea
              value={fields[f.key] ?? ""}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              rows={1}
              disabled={submitting}
              className={cn(
                "w-full resize-y rounded-md bg-[var(--bg-raised)] border border-[var(--border-default)]",
                "text-[11px] leading-snug px-2 py-1.5 text-[var(--text-primary)]",
                "placeholder:text-[var(--text-tertiary)]",
                "focus:border-emerald-500/40 focus:outline-none transition-colors",
                "min-h-[30px]",
              )}
            />
          </div>
        ))}
      </div>

      {/* Mood row */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mr-1">
          mood
        </span>
        {MOODS.map((m) => (
          <button
            key={m.emoji}
            onClick={() => setMood((cur) => (cur === m.label ? "" : m.label))}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono transition-all",
              mood === m.label
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400 scale-105"
                : "border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-tertiary)] hover:border-emerald-500/30",
            )}
            title={m.label}
          >
            <span>{m.emoji}</span>
            <span className="hidden sm:inline">{m.label}</span>
          </button>
        ))}
      </div>

      {/* v10.0.529.25 · /journal audit #R · routing-split toggle.
          Reflections normally only write a Reflection row + a pushback.
          When this toggle is ON, the reflection ALSO runs through the
          brain-dump ingest pipeline (AI extraction → Task INBOX →
          commitments → pgvector embedding). Off by default · matches
          existing operator flow. Info chip reveals the architectural
          context so it's no longer silent. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={toggleExtract}
          aria-pressed={extractIntelligence}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded border text-[9px] font-mono uppercase tracking-wider transition-colors",
            extractIntelligence
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
              : "border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-tertiary)] hover:border-emerald-500/30",
          )}
          title={extractIntelligence ? "extraction on · action items + commitments will be derived" : "extraction off · reflection saves as a Reflection row only"}
        >
          <Sparkles size={9} />
          extract action items
        </button>
        <button
          type="button"
          onClick={() => setShowSplitHelp((v) => !v)}
          aria-label="explain the routing split"
          aria-expanded={showSplitHelp}
          className="flex items-center text-[var(--text-tertiary)] hover:text-emerald-400 transition-colors"
        >
          <Info size={11} />
        </button>
        {showSplitHelp && (
          <p className="basis-full text-[10px] leading-relaxed text-[var(--text-tertiary)] mt-1 px-2 py-1.5 rounded bg-[var(--bg-raised)] border border-[var(--border-default)]">
            By default reflections stay light · just a structured row +
            a counter-question. Turn extraction on for AAR / SSC entries
            where you want action items into your INBOX and commitments
            into the ledger automatically. Brain-dump composer (the
            modal above) always extracts.
          </p>
        )}
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
          {filledCount}/{tmpl.fields.length} filled
        </span>
        <button
          onClick={submit}
          disabled={submitting || filledCount === 0}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors",
            submitting
              ? "bg-zinc-800 border-zinc-700 text-zinc-500"
              : filledCount === 0
                ? "bg-transparent border-[var(--border-default)] text-[var(--text-tertiary)] cursor-not-allowed"
                : "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25",
          )}
        >
          {submitting ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          {submitting ? "logging…" : "log reflection"}
        </button>
      </div>

      {/* Pushback card — Nick's counter-question, shown inline after submit */}
      {pushback && (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Target size={10} className="text-blue-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400">
              nick counters
            </span>
          </div>
          <p className="text-[12px] text-[var(--text-primary)] leading-snug italic">
            {pushback}
          </p>
          <p className="text-[9px] text-[var(--text-tertiary)] mt-1">
            sit with it · or answer in a follow-up reflection
          </p>
        </div>
      )}

      {/* Next-step row — memory calibration or bet desk */}
      {nextStep && nextStep !== "done" && (
        <div className="flex items-center gap-2 pt-1 border-t border-[var(--border-default)]">
          <span className="text-[9px] text-[var(--text-tertiary)]">next:</span>
          {nextStep === "memory-check" && (
            <button
              onClick={toggleCalibration}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:underline"
            >
              <RotateCcw size={10} />
              calibrate memories
              <ArrowRight size={10} />
            </button>
          )}
          {nextStep === "bet" && (
            <Link
              href="/"
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] hover:underline"
            >
              <Target size={10} />
              log this as a bet
              <ArrowRight size={10} />
            </Link>
          )}
          <button
            onClick={resetForNext}
            className="ml-auto flex items-center gap-0.5 text-[9px] text-[var(--text-tertiary)] hover:text-red-400"
            title="clear and start a new reflection"
          >
            <XIcon size={9} /> new
          </button>
        </div>
      )}

      {/* Memory calibration ritual — expands after memory-check click */}
      {showCalibration && <MemoryCalibrationRitual onClose={() => setShowCalibration(false)} />}
    </section>
  );
}

/**
 * Wave S #4 · Ghost counter-question (2026-05-24).
 *
 * Wires `journal.ghostCounterQuestion` (which delegates to ghost-nick)
 * into a slim prompt below the composer header. Honors the docstring
 * promise. Silent on null · self-dismissable. The dismissal is local
 * state only because the prediction set rotates daily · re-displaying
 * a fresh question tomorrow is the design.
 */
function GhostCounterQuestionInline() {
  const { data } = trpc.journal.ghostCounterQuestion.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 15 * 60 * 1000,
  });
  const [dismissed, setDismissed] = useState(false);
  if (!data || dismissed) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-violet-500/25 bg-violet-500/[0.04] px-2.5 py-2 text-[11px]">
      <Eye size={11} className="mt-0.5 shrink-0 text-violet-400/70" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-violet-100/90 leading-snug">
          {data.question}
        </p>
        {data.basis && (
          <p className="text-[9px] text-violet-300/50 mt-0.5 font-mono truncate">
            ghost · {data.basis}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss counter-question"
        className="shrink-0 text-[var(--text-tertiary)] hover:text-violet-300 transition-colors"
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}
