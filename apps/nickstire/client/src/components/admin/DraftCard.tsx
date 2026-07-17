import React, { useState } from "react";
import { Film, Images, Copy, Check, Calendar, AlertTriangle, CheckCircle2, Play, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { detectForbiddenClaims, detectOverdiagnosis, detectFearmongering, detectUnsupportedPriceOrFree, detectGenericMarketingLanguage } from "@/lib/igCarouselStudio";
import { detectForbiddenReelClaims, detectPriceClaims, detectGenericAdLanguage } from "@/lib/facelessReelStudio";

interface DraftCardProps {
  draft: {
    id: string;
    topic: string;
    contentType: "reel" | "carousel";
    status: string;
    campaignKeyword: string;
    creativeTerritory: string;
    selectedCaption: string;
    hashtags: string[];
    plannedDate?: string;
    notes?: string;
    isSample?: boolean;
  };
  onUpdateStatus: (status: string) => void;
  onUpdateDate: (date: string) => void;
  onUpdateNotes: (notes: string) => void;
  onOpenPublish: () => void;
  onRenderSlides?: () => void;
  onOpenStudio: () => void;
}

export default function DraftCard({ draft, onUpdateStatus, onUpdateDate, onUpdateNotes, onOpenPublish, onOpenStudio, onRenderSlides }: DraftCardProps) {
  const [copiedCaption, setCopiedCaption] = useState(false);
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [newDate, setNewDate] = useState(draft.plannedDate || "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [newNotes, setNewNotes] = useState(draft.notes || "");

  // Run safety checks based on content type
  const getSafetyFindings = () => {
    const textToCheck = `${draft.topic} ${draft.selectedCaption}`;
    if (draft.contentType === "reel") {
      return [
        ...detectForbiddenReelClaims(textToCheck, "reel"),
        ...detectOverdiagnosis(textToCheck, "reel"),
        ...detectFearmongering(textToCheck, "reel"),
        ...detectPriceClaims(textToCheck, "reel"),
        ...detectGenericAdLanguage(textToCheck, "reel"),
      ];
    } else {
      return [
        ...detectForbiddenClaims(textToCheck, "carousel"),
        ...detectOverdiagnosis(textToCheck, "carousel"),
        ...detectFearmongering(textToCheck, "carousel"),
        ...detectUnsupportedPriceOrFree(textToCheck, "carousel"),
        ...detectGenericMarketingLanguage(textToCheck, "carousel"),
      ];
    }
  };

  const findings = getSafetyFindings();
  const hasBlocks = findings.some(f => f.severity === "block");
  const hasWarnings = findings.some(f => f.severity === "warn");

  const handleCopyCaption = (e: React.MouseEvent) => {
    e.stopPropagation();
    const fullCaption = `${draft.selectedCaption}\n\n${draft.hashtags.map(t => `#${t.replace("#", "")}`).join(" ")}`;
    navigator.clipboard.writeText(fullCaption).then(() => {
      setCopiedCaption(true);
      toast.success("Caption & hashtags copied");
      setTimeout(() => setCopiedCaption(false), 1500);
    });
  };

  const saveDate = () => {
    onUpdateDate(newDate);
    setIsEditingDate(false);
  };

  const saveNotes = () => {
    onUpdateNotes(newNotes);
    setIsEditingNotes(false);
  };

  const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
    idea: { label: "Idea", bg: "bg-purple-500/10 border-purple-500/20", text: "text-purple-400" },
    draft: { label: "Draft", bg: "bg-blue-500/10 border-blue-500/20", text: "text-blue-400" },
    needs_review: { label: "Needs Review", bg: "bg-amber-500/10 border-amber-500/20", text: "text-amber-400" },
    approved: { label: "Approved", bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400" },
    posted: { label: "Posted", bg: "bg-foreground/5 border-border/20", text: "text-foreground/50" },
    archived: { label: "Archived", bg: "bg-foreground/5 border-border/10", text: "text-foreground/30" },
    blocked: { label: "Blocked", bg: "bg-red-500/10 border-red-500/20", text: "text-red-400" },
  };

  const statusStyle = STATUS_CONFIG[draft.status] || STATUS_CONFIG.draft;

  return (
    <div className={`bg-card border rounded-lg p-4 space-y-3 transition-all hover:border-primary/20 ${hasBlocks ? "border-red-500/20" : "border-border/40"}`}>
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          {draft.contentType === "reel" ? (
            <Film className="w-3.5 h-3.5 text-primary shrink-0" />
          ) : (
            <Images className="w-3.5 h-3.5 text-primary shrink-0" />
          )}
          <span className="text-[10px] font-bold tracking-wider uppercase text-foreground/50">
            {draft.contentType}
          </span>
          {draft.isSample && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400 uppercase">
              Sample
            </span>
          )}
        </div>

        <span className={`px-2 py-0.5 text-[9px] font-bold border rounded uppercase ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
      </div>

      {/* Title/Topic */}
      <div>
        <h4 className="font-bold text-xs text-foreground tracking-wide line-clamp-2">{draft.topic}</h4>
        <div className="flex items-center gap-2 mt-1">
          <span className="px-1.5 py-0.5 text-[9px] bg-background border border-border/30 rounded text-foreground/50">
            #{draft.campaignKeyword}
          </span>
          <span className="text-[9px] text-foreground/40 font-mono truncate max-w-[150px]">
            {draft.creativeTerritory}
          </span>
        </div>
      </div>

      {/* Caption Preview */}
      {draft.selectedCaption && (
        <div className="bg-background/40 border border-border/20 rounded p-2 text-[11px] text-foreground/70 leading-relaxed max-h-[60px] overflow-y-auto font-mono">
          {draft.selectedCaption}
        </div>
      )}

      {/* Safety Alert System */}
      <div className="space-y-1">
        {hasBlocks && (
          <div className="flex items-start gap-1.5 text-[9px] text-red-400 bg-red-500/5 border border-red-500/20 p-1.5 rounded">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">BLOCKED:</span> {findings.filter(f => f.severity === "block").map(f => f.rule).join(", ")}
            </div>
          </div>
        )}
        {hasWarnings && (
          <div className="flex items-start gap-1.5 text-[9px] text-amber-400 bg-amber-500/5 border border-amber-500/20 p-1.5 rounded">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">CHECK:</span> {findings.filter(f => f.severity === "warn").map(f => f.rule).join(", ")}
            </div>
          </div>
        )}
        {!hasBlocks && !hasWarnings && (
          <div className="flex items-center gap-1.5 text-[9px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 p-1.5 rounded">
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            <span>SAFE TO PREVIEW</span>
          </div>
        )}
      </div>

      {/* Date and Notes Schedulers */}
      <div className="text-[11px] space-y-1 border-t border-border/20 pt-2 text-foreground/60">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3 text-foreground/40" />
            Planned:
          </span>
          {isEditingDate ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="bg-background border border-border/40 text-[10px] px-1 rounded focus:outline-none"
              />
              <button onClick={saveDate} className="text-emerald-400 hover:text-emerald-300 font-bold">Save</button>
            </div>
          ) : (
            <span
              onClick={() => setIsEditingDate(true)}
              className="underline cursor-pointer hover:text-foreground text-[10px]"
            >
              {draft.plannedDate || "Set Date"}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-foreground/40 text-[10px]">Notes:</span>
          {isEditingNotes ? (
            <div className="space-y-1 mt-0.5">
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                className="w-full bg-background border border-border/40 text-[10px] p-1 rounded focus:outline-none font-mono"
              />
              <div className="flex items-center gap-1.5 justify-end">
                <button onClick={saveNotes} className="text-emerald-400 hover:text-emerald-300 font-bold text-[9px]">Save</button>
                <button onClick={() => setIsEditingNotes(false)} className="text-foreground/40 text-[9px]">Cancel</button>
              </div>
            </div>
          ) : (
            <span
              onClick={() => setIsEditingNotes(true)}
              className="text-[10px] italic hover:underline cursor-pointer truncate"
              title={draft.notes || "Click to add editorial notes"}
            >
              {draft.notes || "+ Add notes..."}
            </span>
          )}
        </div>
      </div>

      {/* Action Footers */}
      <div className="flex items-center justify-between border-t border-border/20 pt-2 flex-wrap gap-2">
        <div className="flex gap-1.5">
          <button
            onClick={handleCopyCaption}
            className="p-1.5 rounded border border-border/30 hover:border-primary/40 text-foreground/60 hover:text-foreground transition-all"
            title="Copy Caption & Tags"
          >
            {copiedCaption ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onOpenStudio}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold rounded border border-border/30 text-foreground/60 hover:text-foreground hover:border-primary/40 transition-all"
          >
            <ExternalLink className="w-3 h-3" />
            Open Studio
          </button>
          {draft.contentType === "carousel" && onRenderSlides && (
            <button
              onClick={onRenderSlides}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold rounded border border-border/30 text-foreground/60 hover:text-foreground hover:border-primary/40 transition-all"
              title="Render designed 4:5 slides (deterministic typography)"
            >
              <Play className="w-3 h-3" />
              Render slides
            </button>
          )}
        </div>

        {draft.status === "needs_review" && (
          <button
            onClick={() => onUpdateStatus("approved")}
            className="px-2.5 py-1.5 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors"
          >
            Approve
          </button>
        )}

        {draft.status === "approved" && (
          <button
            onClick={onOpenPublish}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded transition-colors"
          >
            <Play className="w-3 h-3 fill-current" />
            Publish
          </button>
        )}

        {draft.status === "draft" && (
          <button
            onClick={() => onUpdateStatus("needs_review")}
            className="px-2.5 py-1.5 text-[10px] font-bold border border-amber-500/40 hover:bg-amber-500/10 text-amber-400 rounded transition-colors"
          >
            Submit Review
          </button>
        )}
      </div>
    </div>
  );
}
