import React from "react";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, Clock, PlaySquare, FileText, Image as ImageIcon } from "lucide-react";

export function ContentWarRoom() {
  const { data: drafts, isLoading } = trpc.intelligence.contentDrafts.useQuery(undefined, {
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Loading Content War Room...
      </div>
    );
  }

  if (!drafts?.length) {
    return (
      <div className="p-8 text-center text-muted-foreground border border-border/40 rounded-xl bg-muted/10">
        No content drafts currently in inventory. Enable the content manufacturing pipeline.
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
      case "posted":
      case "published":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "rejected":
      case "failed":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "reel":
        return <PlaySquare className="w-4 h-4 text-primary" />;
      case "carousel":
        return <ImageIcon className="w-4 h-4 text-primary" />;
      default:
        return <FileText className="w-4 h-4 text-primary" />;
    }
  };

  return (
    <div className="space-y-6 px-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {drafts.map((draft: any) => (
          <div key={draft.id} className="stat-card flex flex-col h-full bg-background/50 relative overflow-hidden">
            {/* Critic Score Banner */}
            <div className={`absolute top-0 right-0 px-3 py-1 text-xs font-black rounded-bl-lg ${
              draft.scoreOverall >= 90 ? "bg-emerald-500/20 text-emerald-400" :
              draft.scoreOverall >= 70 ? "bg-yellow-500/20 text-yellow-400" :
              "bg-red-500/20 text-red-400"
            }`}>
              {draft.scoreOverall} / 100
            </div>

            <div className="flex items-center gap-2 mb-3 mt-1">
              {getTypeIcon(draft.contentType)}
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {draft.contentType}
              </span>
              <div className="ml-auto flex items-center gap-1 bg-background/80 px-2 py-0.5 rounded-full border border-border/40 text-xs">
                {getStatusIcon(draft.status)}
                <span className="capitalize">{draft.status}</span>
              </div>
            </div>

            <h3 className="text-sm font-bold text-foreground line-clamp-2 mb-1">
              {draft.topic}
            </h3>
            <p className="text-xs text-muted-foreground mb-3 line-clamp-1 font-mono bg-muted/20 px-2 py-1 rounded inline-block w-max">
              {draft.seriesName} (Ep {draft.episodeNumber})
            </p>

            <div className="flex-1 space-y-3">
              <div>
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">Hook</span>
                <p className="text-sm text-foreground italic mt-1 line-clamp-3">
                  "{draft.hookText}"
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto pt-3 border-t border-border/20">
                <div className="text-xs">
                  <span className="text-muted-foreground block">Curiosity</span>
                  <span className="font-mono text-foreground">{draft.scoreCuriosity}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground block">Authority</span>
                  <span className="font-mono text-foreground">{draft.scoreAuthority}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground block">Local</span>
                  <span className="font-mono text-foreground">{draft.scoreLocalRelevance}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground block">Emotion</span>
                  <span className="font-mono text-foreground">{draft.scoreEmotion}</span>
                </div>
              </div>
            </div>

            {draft.errorMessage && (
              <div className="mt-3 text-xs bg-red-500/10 text-red-400 p-2 rounded-md border border-red-500/20 break-words">
                <span className="font-bold block mb-1">Error:</span>
                {draft.errorMessage}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
