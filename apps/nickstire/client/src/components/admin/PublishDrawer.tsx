import React, { useState } from "react";
import { X, Check, Copy, ExternalLink, Film, Images, FileText } from "lucide-react";
import { toast } from "sonner";

interface PublishDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  draft: {
    id: string;
    topic: string;
    contentType: "reel" | "carousel";
    selectedCaption: string;
    hashtags: string[];
    higgsfieldPrompts?: string[] | any[];
  } | null;
  onMarkPosted: () => void;
  isPosting: boolean;
}

export default function PublishDrawer({ isOpen, onClose, draft, onMarkPosted, isPosting }: PublishDrawerProps) {
  const [steps, setSteps] = useState({
    promptsCopied: false,
    assetsGenerated: false,
    captionCopied: false,
    markedPosted: false,
  });

  if (!isOpen || !draft) return null;

  const handleCopyPrompts = () => {
    let promptsText = "";
    if (draft.contentType === "reel" && Array.isArray(draft.higgsfieldPrompts)) {
      promptsText = draft.higgsfieldPrompts
        .map((p: any) => `Beat ${p.beatNumber}:\nPROMPT: ${p.prompt}\nNEGATIVE: ${p.negativePrompt}`)
        .join("\n\n");
    } else if (Array.isArray(draft.higgsfieldPrompts)) {
      promptsText = draft.higgsfieldPrompts.join("\n\n");
    } else {
      promptsText = `Generate assets for topic: ${draft.topic}`;
    }

    navigator.clipboard.writeText(promptsText).then(() => {
      setSteps(s => ({ ...s, promptsCopied: true }));
      toast.success("Higgsfield prompts copied to clipboard");
    }).catch(() => toast.error("Failed to copy prompts"));
  };

  const handleCopyCaption = () => {
    const fullCaption = `${draft.selectedCaption}\n\n${draft.hashtags.map(t => `#${t.replace("#", "")}`).join(" ")}`;
    navigator.clipboard.writeText(fullCaption).then(() => {
      setSteps(s => ({ ...s, captionCopied: true }));
      toast.success("Caption & hashtags copied to clipboard");
    }).catch(() => toast.error("Failed to copy caption"));
  };

  const handleMarkPosted = () => {
    onMarkPosted();
    setSteps(s => ({ ...s, markedPosted: true }));
  };

  const resetSteps = () => {
    setSteps({
      promptsCopied: false,
      assetsGenerated: false,
      captionCopied: false,
      markedPosted: false,
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-background border-l border-border/40 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-250">
      {/* Header */}
      <div className="p-4 border-b border-border/30 flex items-center justify-between bg-card">
        <div className="flex items-center gap-2">
          {draft.contentType === "reel" ? (
            <Film className="w-4 h-4 text-primary" />
          ) : (
            <Images className="w-4 h-4 text-primary" />
          )}
          <div>
            <h3 className="font-bold text-sm text-foreground tracking-wider uppercase">Publish Guide</h3>
            <p className="text-[10px] text-foreground/40 font-mono truncate max-w-[320px]">{draft.topic}</p>
          </div>
        </div>
        <button
          onClick={() => {
            resetSteps();
            onClose();
          }}
          className="p-1.5 rounded hover:bg-foreground/5 text-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Guide Steps */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <div className="border border-blue-500/20 bg-blue-500/5 rounded p-3 text-xs text-blue-300 leading-relaxed">
          <strong>Publishing is manual.</strong> Higgsfield generation, video rendering, and posting live on social media are done by you manually. Follow this guide to prepare your assets safely.
        </div>

        {/* Step 1: Higgsfield Prompts */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${steps.promptsCopied ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400" : "bg-card border border-border/40 text-foreground/55"}`}>
              {steps.promptsCopied ? <Check className="w-3.5 h-3.5" /> : "1"}
            </div>
            <div className="w-0.5 flex-1 bg-border/20 my-1" />
          </div>
          <div className="flex-1 space-y-2 pb-4">
            <h4 className="font-bold text-xs text-foreground/90 tracking-wide uppercase">Copy AI Asset Prompts</h4>
            <p className="text-[11px] text-foreground/55 leading-relaxed">
              Grab the Higgsfield prompts and visual outline for this concept to generate your images or storyboard beats.
            </p>
            <button
              onClick={handleCopyPrompts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <Copy className="w-3 h-3" />
              Copy Higgsfield Prompts
            </button>
          </div>
        </div>

        {/* Step 2: External Generation */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${steps.assetsGenerated ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400" : "bg-card border border-border/40 text-foreground/55"}`}>
              {steps.assetsGenerated ? <Check className="w-3.5 h-3.5" /> : "2"}
            </div>
            <div className="w-0.5 flex-1 bg-border/20 my-1" />
          </div>
          <div className="flex-1 space-y-2 pb-4">
            <h4 className="font-bold text-xs text-foreground/90 tracking-wide uppercase">Generate Assets</h4>
            <p className="text-[11px] text-foreground/55 leading-relaxed">
              Open Higgsfield or your choice of generator, paste the prompts, download the rendered video/images, and prepare your draft.
            </p>
            <button
              onClick={() => {
                setSteps(s => ({ ...s, assetsGenerated: true }));
                window.open("https://higgsfield.ai", "_blank", "noopener,noreferrer");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open Higgsfield AI
            </button>
          </div>
        </div>

        {/* Step 3: Copy Caption */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${steps.captionCopied ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400" : "bg-card border border-border/40 text-foreground/55"}`}>
              {steps.captionCopied ? <Check className="w-3.5 h-3.5" /> : "3"}
            </div>
            <div className="w-0.5 flex-1 bg-border/20 my-1" />
          </div>
          <div className="flex-1 space-y-2 pb-4">
            <h4 className="font-bold text-xs text-foreground/90 tracking-wide uppercase">Copy Caption & Tags</h4>
            <p className="text-[11px] text-foreground/55 leading-relaxed">
              Copy the claim-safe description and hashtags and paste them in your Instagram/Facebook composer.
            </p>
            <button
              onClick={handleCopyCaption}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <FileText className="w-3 h-3" />
              Copy Caption Block
            </button>
          </div>
        </div>

        {/* Step 4: Mark Posted */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${steps.markedPosted ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400" : "bg-card border border-border/40 text-foreground/55"}`}>
              {steps.markedPosted ? <Check className="w-3.5 h-3.5" /> : "4"}
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <h4 className="font-bold text-xs text-foreground/90 tracking-wide uppercase">Mark Posted</h4>
            <p className="text-[11px] text-foreground/55 leading-relaxed">
              Once you've posted the content manually, mark it as posted here to update the Google Sheet CRM status.
            </p>
            <button
              onClick={handleMarkPosted}
              disabled={isPosting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
            >
              {isPosting ? "Updating..." : "Mark as Posted"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
