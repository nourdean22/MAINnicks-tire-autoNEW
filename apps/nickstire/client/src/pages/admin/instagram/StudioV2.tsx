import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Film, Image as ImageIcon,
  Layers3, Loader2, Megaphone, RefreshCw, Save, ShieldCheck, Sparkles, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  INSTAGRAM_FORMAT_LABELS,
  INSTAGRAM_OBJECTIVES,
  INSTAGRAM_SOURCE_LABELS,
  INSTAGRAM_SOURCE_TYPES,
} from "../../../../shared/instagramStudio";
import {
  type InstagramFormat,
  type InstagramObjective,
  type InstagramSourceType,
  type InstagramStudioDraft,
} from "../../../../shared/instagramStudio";
import { SERVICE_FEED } from "../../../../shared/serviceFeed";
import LegacyStudio from "./Studio";
import CampaignPackageCard from "@/components/admin/CampaignPackageCard";
import { consumeCreateHandoff } from "./igViews";

/** Per-lane copy. Keyed by lane so adding a resolvable source is one entry. */
const RECORD_LANE_LABELS = {
  reviews: "Pick the real review",
  declinedWork: "Pick the real quoted work",
  offers: "Pick the active offer",
} as const;

const RECORD_LANE_PLACEHOLDERS = {
  reviews: "…or paste a review ID",
  declinedWork: "…or paste an estimate ID",
  offers: "…or paste an offer ID",
} as const;

/** One-shot mount initializer from the cross-view handoff contract. */
function initialFromHandoff() {
  const handoff = consumeCreateHandoff();
  if (!handoff) return null;
  const sourceType = (INSTAGRAM_SOURCE_TYPES as readonly string[]).includes(handoff.sourceType)
    ? (handoff.sourceType as InstagramSourceType)
    : null;
  if (!sourceType) return null;
  return {
    sourceType,
    recordId: handoff.recordId ?? "",
    detail: handoff.detail ?? "",
    format: handoff.format && handoff.format !== "reel" && ["post", "carousel", "story", "ad"].includes(handoff.format)
      ? (handoff.format as Exclude<InstagramFormat, "reel">)
      : null,
    // "reel" is not a value the STATIC format state can hold, but it is a real
    // operator intent that was being silently discarded here — the only way into
    // the reel lane was a second tap on this screen. Surfaced as its own flag so
    // a caller can ask for the reel wizard directly.
    startInReel: handoff.format === "reel",
    objective: handoff.objective && (INSTAGRAM_OBJECTIVES as readonly string[]).includes(handoff.objective)
      ? (handoff.objective as InstagramObjective)
      : null,
  };
}

/**
 * Draft fields the deterministic renderer consumes. Editing any of them invalidates
 * already-rendered assets, forcing a re-render before the draft can be staged.
 *
 * `carouselSlides` was missing from this set: an operator could render a carousel,
 * then edit slide copy, and stage the PRE-EDIT images against POST-EDIT text — the
 * stored draft and quality score described one thing while the live post showed
 * another. Adding a field the renderer reads without adding it here reintroduces
 * that bug, so keep this list next to `renderInstagramStudioAssets`.
 *
 * `artDirection` IS in this set: renderInstagramStudioAssets routes it through
 * familyFromArtDirection to pick the visual family (background, headline color,
 * CTA styling — see server/services/visualFamily.ts). A comment here previously
 * claimed the renderer never reads it; that went stale the day the renderer
 * started reading it, and editing art direction silently kept the old media
 * attached. visualFieldsParity.test.ts pins this list against the renderer.
 */
const VISUAL_FIELDS: ReadonlySet<keyof InstagramStudioDraft> = new Set([
  "format",
  "headline",
  "subheadline",
  "cta",
  "carouselSlides",
  "artDirection",
]);

const STATIC_FORMATS: Array<{ id: Exclude<InstagramFormat, "reel">; icon: typeof ImageIcon; description: string }> = [
  { id: "post", icon: ImageIcon, description: "One hard-hitting idea with a clean branded visual." },
  { id: "carousel", icon: Layers3, description: "Five-slide education, proof, or comparison sequence." },
  { id: "story", icon: Sparkles, description: "Vertical 9:16 update built for immediate publishing." },
  { id: "ad", icon: Megaphone, description: "Direct-response creative with one controlled action." },
];

const OBJECTIVE_LABELS: Record<InstagramObjective, string> = {
  bookings: "Book appointments",
  calls: "Drive calls",
  walk_ins: "Drive walk-ins",
  trust: "Build trust",
  education: "Teach something useful",
  engagement: "Earn saves and shares",
  retargeting: "Retarget warm customers",
};

function gateClass(gate: string) {
  if (gate === "pass") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  if (gate === "block") return "border-red-500/40 bg-red-500/10 text-red-400";
  return "border-amber-500/40 bg-amber-500/10 text-amber-400";
}

export default function StudioV2({ onNavigate }: { onNavigate?: (view: "publish" | "today") => void } = {}) {
  // Handoff from Community/Insights/Today — consumed exactly once, before
  // first render, so a preloaded source is indistinguishable from a typed one.
  const [handoff] = useState(() => initialFromHandoff());
  const [showReelStudio, setShowReelStudio] = useState(handoff?.startInReel ?? false);
  const [sourceType, setSourceType] = useState<InstagramSourceType>(handoff?.sourceType ?? "manual_idea");
  const [sourceRecordId, setSourceRecordId] = useState(handoff?.recordId ?? "");
  const [sourceDetail, setSourceDetail] = useState(handoff?.detail ?? "");
  /** Real shop photos already uploaded to durable storage — the draft's subject imagery. */
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [format, setFormat] = useState<Exclude<InstagramFormat, "reel">>(handoff?.format ?? "post");
  const [objective, setObjective] = useState<InstagramObjective>(handoff?.objective ?? "bookings");
  const [direction, setDirection] = useState("");
  const [draft, setDraft] = useState<InstagramStudioDraft | null>(null);
  /** Server row version for the autosave CAS — null until persisted. */
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /**
   * In-DOM confirm for discarding a paid draft (window.confirm is silently
   * suppressed in the installed iOS PWA). A single tap on a source/format
   * button used to setDraft(null) instantly — destroying a generated+rendered
   * draft the operator already paid for.
   */
  const [pendingSwitch, setPendingSwitch] = useState<
    | { kind: "source"; value: InstagramSourceType }
    | { kind: "format"; value: Exclude<InstagramFormat, "reel"> }
    | null
  >(null);
  /**
   * Request-identity guard. Every mutation's onSuccess used to setDraft(result)
   * unconditionally, so a slow response could resurrect a deliberately
   * discarded draft or revert edits typed while it was pending. Any discard or
   * new request bumps the sequence; a response only applies if it is still the
   * latest.
   */
  const reqSeq = useRef(0);
  const applyIfCurrent = (seq: number, apply: () => void, staleNote: string) => {
    if (reqSeq.current === seq) apply();
    else toast.info(staleNote);
  };

  const utils = trpc.useUtils();
  // Real records to create from — no more raw database IDs.
  const sourceOptions = trpc.instagramStudio.sourceOptions.useQuery(undefined, {
    enabled: sourceType === "review" || sourceType === "declined_work" || sourceType === "special_offer",
    staleTime: 60_000,
  });
  // Autosaved drafts to resume — the work survives refresh/relaunch now.
  const recentDrafts = trpc.instagramStudio.list.useQuery({ limit: 20 }, {
    enabled: draft === null,
    select: (rows) => rows.filter((row) => row.status === "draft").slice(0, 3),
  });

  const generate = trpc.instagramStudio.generate.useMutation({
    onError: (error) => toast.error("Generation failed", { description: error.message }),
  });
  const saveDraft = trpc.instagramStudio.saveDraft.useMutation();
  // Evidence-first Create (Wave B): a real shop photo beats a generated scene.
  const uploadEvidence = trpc.instagramStudio.uploadEvidencePhoto.useMutation({
    onError: (error) => toast.error("Photo upload failed", { description: error.message }),
  });
  const evaluate = trpc.instagramStudio.evaluate.useMutation({
    onError: (error) => toast.error("Quality check failed", { description: error.message }),
  });
  const render = trpc.instagramStudio.render.useMutation({
    onError: (error) => toast.error("Render failed", { description: error.message }),
  });
  const stage = trpc.instagramStudio.stage.useMutation({
    onError: (error) => toast.error("Queue failed", { description: error.message }),
  });

  const runGenerate = () => {
    const seq = ++reqSeq.current;
    generate.mutate({
      source: { type: sourceType, recordId: sourceRecordId || undefined, detail: sourceDetail || undefined },
      format,
      objective,
      operatorDirection: direction || undefined,
      evidenceImageUrls: evidenceUrls.length ? evidenceUrls : undefined,
    }, {
      onSuccess: (result) => applyIfCurrent(seq, () => {
        const { persisted, draftRowVersion, ...generated } = result;
        setDraft(generated as InstagramStudioDraft);
        runIdRef.current = (generated as { runId?: string | null }).runId ?? null;
        setRowVersion(persisted ? draftRowVersion : null);
        setSavedAt(persisted ? new Date() : null);
        toast.success("Draft generated", {
          description: persisted
            ? "Saved to the server — safe across refresh."
            : "NOT server-saved (persistence failed) — stage it before leaving.",
        });
      }, "A generation finished for a concept you already discarded — it was not applied."),
    });
  };

  /**
   * SINGLE-FLIGHT debounced autosave. The first version fired a new request
   * from every debounce window with the version it saw at arm time — two
   * overlapping saves carried the SAME expectedVersion, the second lost the
   * CAS to the first, and the client treated its own collision as an external
   * conflict and permanently stopped autosaving (most plausible exactly on a
   * slow phone connection). One request in flight; edits during it mark
   * dirty; the follow-up save uses the version the SERVER just returned.
   * Autosave stops only on a conflict it did not cause itself.
   */
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<InstagramStudioDraft | null>(null);
  const rowVersionRef = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const saveInFlight = useRef(false);
  const saveDirty = useRef(false);
  const setRowVersion = (v: number | null) => { rowVersionRef.current = v; setDraftVersion(v); };

  const flushAutosave = () => {
    if (saveInFlight.current) { saveDirty.current = true; return; }
    const snapshot = latestDraftRef.current;
    const version = rowVersionRef.current;
    if (!snapshot || version === null) return;
    saveInFlight.current = true;
    saveDraft.mutate({ draft: snapshot, expectedVersion: version, runId: runIdRef.current ?? undefined }, {
      onSuccess: (result) => {
        saveInFlight.current = false;
        setRowVersion(result.version);
        setSavedAt(new Date());
        if (saveDirty.current) { saveDirty.current = false; flushAutosave(); }
      },
      onError: (error) => {
        saveInFlight.current = false;
        saveDirty.current = false;
        // A conflict here is EXTERNAL by construction (single-flight) —
        // another tab really does own a newer version. Stop honestly.
        setRowVersion(null);
        toast.warning("Autosave stopped", { description: error.message });
      },
    });
  };
  useEffect(() => {
    latestDraftRef.current = draft;
    if (!draft || rowVersionRef.current === null) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(flushAutosave, 1500);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const resumeDraft = (row: { version: number; runId?: string | null; draft: InstagramStudioDraft | null }) => {
    if (!row.draft) return;
    reqSeq.current += 1;
    setDraft(row.draft);
    runIdRef.current = row.runId ?? null;
    setRowVersion(row.version);
    setSavedAt(null);
    setSourceType(row.draft.source.type);
    setFormat(row.draft.format === "reel" ? "post" : row.draft.format);
    setObjective(row.draft.objective);
    // Restore attached shop photos — rendered-card URLs are the renderer's own
    // output and are never evidence (the card-inside-a-card class).
    setEvidenceUrls((row.draft.imageUrls ?? []).filter((u) => typeof u === "string" && !u.includes("instagram-studio/")));
  };
  const runEvaluate = (current: InstagramStudioDraft) => {
    const seq = ++reqSeq.current;
    evaluate.mutate(current, {
      onSuccess: (result) => applyIfCurrent(seq, () => {
        setDraft(result as InstagramStudioDraft);
        toast.success("Quality gate refreshed");
      }, "A re-score finished for a concept you already discarded — it was not applied."),
    });
  };
  const runRender = (current: InstagramStudioDraft) => {
    const seq = ++reqSeq.current;
    render.mutate(current, {
      onSuccess: (result) => applyIfCurrent(seq, () => {
        setDraft(result as InstagramStudioDraft);
        toast.success("Assets rendered", { description: `${result.imageUrls.length} permanent JPEG asset${result.imageUrls.length === 1 ? "" : "s"} ready.` });
      }, "A render finished for a concept you already discarded — it was not applied."),
    });
  };
  const runStage = (current: InstagramStudioDraft) => {
    const seq = ++reqSeq.current;
    stage.mutate({ ...current, runId: runIdRef.current ?? (current as { runId?: string }).runId }, {
      onSuccess: async () => {
        await utils.instagramStudio.list.invalidate();
        applyIfCurrent(seq, () => {
          // The draft now lives in the Queue — keeping it mounted here left the
          // stage button armed, and a second tap blind-upserted the queue row.
          setDraft(null);
          setRowVersion(null);
          setSavedAt(null);
          toast.success("Sent to review queue", { description: "Approve, schedule, or publish from Publish." });
        }, "Staged — find it in Publish.");
      },
    });
  };

  const discardAndSwitch = (target: NonNullable<typeof pendingSwitch>) => {
    reqSeq.current += 1; // in-flight responses for the old concept are now stale
    if (target.kind === "source") setSourceType(target.value);
    else setFormat(target.value);
    setDraft(null);
    setRowVersion(null);
    setSavedAt(null);
    setPendingSwitch(null);
  };
  const requestSwitch = (target: NonNullable<typeof pendingSwitch>) => {
    if (!draft) discardAndSwitch(target);
    else setPendingSwitch(target);
  };

  /**
   * Which types BLOCK without a record. Unchanged on purpose — `special_offer`
   * gets a picker below but is NOT added here, so an operator can still post
   * about something not yet in the `specials` table. Showing records and
   * requiring records are separate decisions; conflating them would tighten an
   * existing gate as a side effect of adding a convenience.
   */
  const requiresRecord = sourceType === "review" || sourceType === "declined_work";
  const canGenerate = !requiresRecord || sourceRecordId.trim().length > 0;

  /** Which lane of real records to OFFER for the selected source, if any. */
  const recordLane: "reviews" | "declinedWork" | "offers" | null =
    sourceType === "review" ? "reviews"
    : sourceType === "declined_work" ? "declinedWork"
    : sourceType === "special_offer" ? "offers"
    : null;
  const recordOptions = recordLane ? (sourceOptions.data?.[recordLane] ?? []) : [];
  const laneUnavailable =
    recordLane !== null && sourceOptions.data?.availability?.[recordLane] === "unavailable";
  const assembledCaption = useMemo(() => {
    if (!draft) return "";
    const tags = draft.hashtags.map((tag) => `#${tag}`).join(" ");
    return `${draft.caption}${tags ? `\n\n${tags}` : ""}`;
  }, [draft]);

  const patchDraft = <K extends keyof InstagramStudioDraft>(key: K, value: InstagramStudioDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value, imageUrls: VISUAL_FIELDS.has(key) ? [] : current.imageUrls } : current);
  };

  if (showReelStudio) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => setShowReelStudio(false)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Studio V2
        </Button>
        {/* Carry the source the operator already chose. This was previously
            rendered with no props at all, so the selected record was dropped at
            the boundary and the reel wizard reopened at "what is the source of
            this post?" with an empty raw-record-id box. */}
        {/* onNavigate was NOT passed, and Studio.tsx guards its exit on the
            prop being present — so after successfully staging a reel the
            operator was left sitting in the wizard with only a toast, with no
            indication the work had landed in Publish. */}
        <LegacyStudio
          initialSource={{
            type: sourceType,
            recordId: sourceRecordId || undefined,
            detail: sourceDetail || undefined,
          }}
          onNavigate={(legacyTab) => onNavigate?.(legacyTab === "queue" ? "publish" : "today")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Instagram Studio V2</Badge>
          <h2 className="text-3xl font-bold tracking-tight">Create exactly what you need.</h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Give the system a source, format, goal, and direct order. It produces controlled copy, scores it on the server, renders clean Nick’s Tire assets, and stages nothing until you approve the result.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowReelStudio(true)} className="h-11">
          <Film className="mr-2 h-4 w-4" /> Open Advanced Reel Studio
        </Button>
      </div>

      <CampaignPackageCard />

      <div className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-5">
          <CardHeader>
            <CardTitle>Creative Order</CardTitle>
            <CardDescription>The system follows these controls. It does not guess your objective.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {pendingSwitch && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <div className="font-semibold">Discard the current draft?</div>
                    <p className="mt-1 text-muted-foreground">Switching {pendingSwitch.kind} throws away the generated copy{draft?.imageUrls.length ? " and the rendered media you already paid for" : ""}. Stage it to the Queue first if you want to keep it.</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="destructive" onClick={() => discardAndSwitch(pendingSwitch)}>Discard and switch</Button>
                      <Button size="sm" variant="outline" onClick={() => setPendingSwitch(null)}>Keep working on it</Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">1. Source of truth</label>
              <div className="grid grid-cols-2 gap-2">
                {INSTAGRAM_SOURCE_TYPES.map((type) => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => requestSwitch({ kind: "source", value: type })}
                    className={`rounded-lg border p-3 text-left text-xs transition ${sourceType === type ? "border-primary bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}
                  >
                    {INSTAGRAM_SOURCE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {recordLane && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {RECORD_LANE_LABELS[recordLane]}
                </label>
                {sourceOptions.isLoading ? (
                  <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading records…</div>
                ) : sourceOptions.isError ? (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">Records could not be listed — unknown, not empty. You can still paste an ID below.</p>
                ) : laneUnavailable ? (
                  /* The QUERY succeeded but THIS lane's read threw. Distinct
                     from both "request failed" and "verified empty", and it was
                     previously invisible: the server swallowed it and returned
                     an empty array, so a broken table read displayed as "no
                     matching records found". */
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    This source could not be read — unknown, not empty. Do not conclude there are none.
                  </p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {recordOptions.map((option) => (
                      <button
                        type="button"
                        key={option.recordId}
                        onClick={() => setSourceRecordId(option.recordId)}
                        className={`w-full rounded-lg border p-3 text-left text-xs transition ${sourceRecordId === option.recordId ? "border-primary bg-primary/10" : "border-border/70 hover:border-primary/40"}`}
                      >
                        <div className="font-semibold">{option.label}</div>
                        {option.detail && <p className="mt-1 line-clamp-2 text-muted-foreground">{option.detail}</p>}
                      </button>
                    ))}
                    {recordOptions.length === 0 && (
                      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">No matching records found — verified empty.</p>
                    )}
                  </div>
                )}
                <Input value={sourceRecordId} onChange={(event) => setSourceRecordId(event.target.value)} placeholder={RECORD_LANE_PLACEHOLDERS[recordLane]} />
                {requiresRecord && (
                  <p className="text-xs text-muted-foreground">The server blocks generation when this record cannot be verified.</p>
                )}
              </div>
            )}

            {/* Service feed: generation starts from a SERVICE OBJECT — its
                pain, confusion, filmable objects, and local angle — instead of
                a blank box. Structural framing only; claim-safety still gates
                every caption downstream. */}
            {sourceType === "faq_service_education" && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pick the service</label>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_FEED.map((service) => (
                    <button
                      type="button"
                      key={service.id}
                      onClick={() => {
                        setSourceRecordId(service.id);
                        setSourceDetail(
                          `Service: ${service.name}\nDriver pain: ${service.customerPain}\nCommon confusion: ${service.commonConfusion}\nFilmable objects: ${service.visualObjects.join(", ")}\nLocal angle: ${service.localAngles.join("; ")}\nCTA options: ${service.ctaOptions.join(" | ")}`,
                        );
                      }}
                      className={`min-h-11 rounded-lg border px-3 text-xs transition ${sourceRecordId === service.id ? "border-primary bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}
                    >
                      {service.name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Fills the evidence box with the service's framing — edit freely; add a shop photo below to make it real.</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Context or evidence</label>
              <Textarea value={sourceDetail} onChange={(event) => setSourceDetail(event.target.value)} placeholder="What happened, what customers keep asking, what offer is active, or what the photo shows." className="min-h-24" />
            </div>

            {/* Evidence photos (Wave B): a real tire, gauge, or bay beats any
                generated scene. The photo uploads to durable storage NOW and
                rides into the draft as its subject image — the renderer frames
                it instead of painting a family background. */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Shop photo (optional, up to 3)</label>
              <div className="flex flex-wrap items-center gap-2">
                {evidenceUrls.map((url) => (
                  <div key={url} className="relative h-20 w-20 overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Shop evidence" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      className="absolute right-0 top-0 flex h-11 w-11 -translate-y-2 translate-x-2 items-start justify-end p-1.5"
                      onClick={() => setEvidenceUrls((current) => current.filter((u) => u !== url))}
                    >
                      <span className="rounded-full bg-black/70 px-1.5 text-xs font-bold text-white">×</span>
                    </button>
                  </div>
                ))}
                {evidenceUrls.length < 3 && (
                  <label className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition hover:border-primary/50 ${uploadEvidence.isPending ? "opacity-50" : ""}`}>
                    {uploadEvidence.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-lg leading-none">+</span>}
                    {uploadEvidence.isPending ? "Uploading…" : "Add photo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      capture="environment"
                      className="hidden"
                      disabled={uploadEvidence.isPending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        if (file.size > 7_500_000) {
                          toast.error("Photo too large", { description: "Max 7.5MB — take it at normal quality, not RAW." });
                          return;
                        }
                        const mime = (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const)
                          .find((m) => m === file.type);
                        if (!mime) {
                          toast.error("Unsupported format", { description: "Use a JPEG, PNG, WebP, or HEIC photo." });
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = String(reader.result ?? "");
                          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
                          if (!base64) { toast.error("Could not read the photo"); return; }
                          uploadEvidence.mutate({ base64, filename: file.name || "shop-photo.jpg", mimeType: mime }, {
                            onSuccess: ({ url }) => {
                              setEvidenceUrls((current) => (current.includes(url) ? current : [...current, url]));
                              toast.success("Photo attached", { description: "It will be the post's subject image." });
                            },
                          });
                        };
                        reader.onerror = () => toast.error("Could not read the photo");
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Stored durably before generation — a draft never depends on your phone keeping the file.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">2. Format</label>
              <div className="grid grid-cols-2 gap-2">
                {STATIC_FORMATS.map(({ id, icon: Icon, description }) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => requestSwitch({ kind: "format", value: id })}
                    className={`rounded-xl border p-3 text-left transition ${format === id ? "border-primary bg-primary/10" : "border-border/70 hover:border-primary/40"}`}
                  >
                    <Icon className="mb-2 h-4 w-4 text-primary" />
                    <div className="text-sm font-semibold">{INSTAGRAM_FORMAT_LABELS[id]}</div>
                    <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">3. Business objective</label>
              <select value={objective} onChange={(event) => setObjective(event.target.value as InstagramObjective)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {INSTAGRAM_OBJECTIVES.map((item) => <option key={item} value={item}>{OBJECTIVE_LABELS[item]}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">4. Your order</label>
              <Textarea value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="Example: Make this blunt, useful, brake-focused, and designed to drive walk-ins today. No fake statistics. One strong visual." className="min-h-28" />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={!canGenerate || generate.isPending}
              onClick={runGenerate}
            >
              {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {generate.isPending ? "Building draft..." : "Generate controlled draft"}
            </Button>
          </CardFooter>
        </Card>

        {!draft ? (
          <Card className="min-h-[620px] border-dashed">
            <CardContent className="flex h-full min-h-[620px] flex-col items-center justify-center px-8 text-center">
              <div className="rounded-full bg-primary/10 p-5"><Sparkles className="h-10 w-10 text-primary" /></div>
              <h3 className="mt-5 text-xl font-semibold">Ready for a real creative order</h3>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">Select the source, format, and business goal. The output will include editable copy, actual quality findings, and clean rendered media.</p>
              {(recentDrafts.data?.length ?? 0) > 0 && (
                <div className="mt-6 w-full max-w-md space-y-2 text-left">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Resume a saved draft</p>
                  {recentDrafts.data!.map((row) => row.draft && (
                    <button
                      type="button"
                      key={row.id}
                      onClick={() => resumeDraft(row)}
                      className="w-full rounded-lg border border-border/70 p-3 text-left text-sm transition hover:border-primary/40"
                    >
                      <span className="font-medium">{row.draft.topic}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{row.draft.format} · {row.draft.imageUrls.length ? "rendered" : "copy only"}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>{INSTAGRAM_FORMAT_LABELS[draft.format]} · {draft.topic}</CardTitle>
                    <CardDescription className="mt-1">{draft.rationale}</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={gateClass(draft.quality.gate)} variant="outline">{draft.quality.gate.toUpperCase()} · {draft.quality.overall}</Badge>
                    <span className={`text-[11px] ${draftVersion === null ? "text-amber-500" : "text-muted-foreground"}`}>
                      {draftVersion === null
                        ? "Not server-saved — stage before leaving"
                        : saveDraft.isPending
                          ? "Saving…"
                          : savedAt
                            ? `Saved ${Math.max(0, Math.round((Date.now() - savedAt.getTime()) / 1000))}s ago`
                            : "Saved"}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Visual headline</label><Input value={draft.headline} maxLength={42} onChange={(event) => patchDraft("headline", event.target.value)} /><div className="text-right text-[11px] text-muted-foreground">{draft.headline.length}/42</div></div>
                    <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">CTA</label><Input value={draft.cta} maxLength={52} onChange={(event) => patchDraft("cta", event.target.value)} /><div className="text-right text-[11px] text-muted-foreground">{draft.cta.length}/52</div></div>
                  </div>
                  <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Visual subheadline</label><Textarea value={draft.subheadline} maxLength={90} onChange={(event) => patchDraft("subheadline", event.target.value)} className="min-h-20" /><div className="text-right text-[11px] text-muted-foreground">{draft.subheadline.length}/90</div></div>
                  <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Caption</label><Textarea value={draft.caption} maxLength={2200} onChange={(event) => patchDraft("caption", event.target.value)} className="min-h-52 text-base leading-7" /><div className="text-right text-[11px] text-muted-foreground">{assembledCaption.length}/2200 with hashtags</div></div>
                  <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Art direction</label><Textarea value={draft.artDirection} onChange={(event) => patchDraft("artDirection", event.target.value)} className="min-h-24" /></div>

                  {draft.format === "carousel" && (
                    <div className="space-y-3">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Five-slide sequence</label>
                      {draft.carouselSlides.map((slide, index) => (
                        <div key={`${slide.role}-${index}`} className="rounded-lg border p-4">
                          <div className="mb-3 flex items-center justify-between"><Badge variant="outline">{index + 1} · {slide.role}</Badge><span className="text-xs text-muted-foreground">{slide.headline.length}/42</span></div>
                          <Input value={slide.headline} onChange={(event) => patchDraft("carouselSlides", draft.carouselSlides.map((item, itemIndex) => itemIndex === index ? { ...item, headline: event.target.value } : item))} />
                          <Textarea className="mt-2" value={slide.body} onChange={(event) => patchDraft("carouselSlides", draft.carouselSlides.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h4 className="font-semibold">Server Quality Gate</h4></div>
                    <div className="mt-4 space-y-2">
                      {draft.quality.dimensions.map((item) => (
                        <div key={item.key} className="rounded-lg border bg-background/60 p-3">
                          <div className="flex items-center justify-between text-sm"><span>{item.label}</span><span className="font-bold">{item.score}/10</span></div>
                          {item.finding && <p className="mt-1 text-xs text-muted-foreground">{item.finding}</p>}
                        </div>
                      ))}
                    </div>
                    {(draft.quality.blockers.length > 0 || draft.quality.warnings.length > 0) && (
                      <div className={`mt-4 rounded-lg border p-3 text-xs ${gateClass(draft.quality.gate)}`}>
                        {(draft.quality.blockers.length ? draft.quality.blockers : draft.quality.warnings).map((item) => <div key={item} className="flex gap-2 py-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{item}</div>)}
                      </div>
                    )}
                    <Button className="mt-4 w-full" variant="outline" disabled={evaluate.isPending} onClick={() => runEvaluate(draft)}>
                      {evaluate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Re-score edited draft
                    </Button>
                  </div>

                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-center gap-2"><ImageIcon className="h-5 w-5 text-primary" /><h4 className="font-semibold">Rendered Media</h4></div>
                    {draft.imageUrls.length ? (
                      <div className={`mt-4 grid gap-3 ${draft.imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {draft.imageUrls.map((url, index) => <img key={url} src={url} alt={`Rendered asset ${index + 1}`} className={`w-full rounded-lg border object-cover ${draft.format === "story" ? "aspect-[9/16]" : "aspect-[4/5]"}`} />)}
                      </div>
                    ) : <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">No asset rendered yet. Visual copy stays bounded so it cannot overlap or turn into garbled AI text.</div>}
                    <Button className="mt-4 w-full" disabled={render.isPending || draft.quality.gate === "block"} onClick={() => runRender(draft)}>
                      {render.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      {draft.imageUrls.length ? "Re-render assets" : "Render clean assets"}
                    </Button>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3 border-t bg-muted/10 sm:flex-row sm:justify-between">
                <Button variant="outline" onClick={() => { reqSeq.current += 1; setDraft(null); }}><RefreshCw className="mr-2 h-4 w-4" /> Start another concept</Button>
                <Button disabled={stage.isPending || draft.quality.gate === "block" || draft.imageUrls.length === 0} onClick={() => runStage(draft)}>
                  {stage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Send to review queue <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
