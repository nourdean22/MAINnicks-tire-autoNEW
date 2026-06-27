import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Kanban, Search, RefreshCw, Send, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DraftStatus = "needs_review" | "ready" | "scheduled" | "published" | "rejected";

export default function Queue({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<DraftStatus | "all">("all");

  const { data: drafts, isLoading, refetch } = trpc.instagramAdmin.getAllDrafts.useQuery();

  const publishDraft = trpc.instagramAdmin.publishManualDraft.useMutation({
    onSuccess: () => {
      toast.success("Published Successfully!");
      refetch();
    },
    onError: (err) => {
      toast.error("Publishing Failed", { description: err.message });
    }
  });

  const rejectDraft = trpc.instagramAdmin.rejectDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft Rejected");
      refetch();
    }
  });

  const filteredDrafts = (drafts || []).filter(d => {
    if (filter !== "all" && d.status !== filter) return false;
    if (searchQuery && !d.conceptBrief?.sourceSummary?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-xl font-medium flex items-center gap-2">
            <Kanban className="h-5 w-5" />
            Publishing Queue & Gates
          </h3>
          <p className="text-sm text-muted-foreground">Manage staged content, review quality gates, and publish.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-muted/20 p-4 rounded-lg border border-border/50">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search drafts..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "needs_review", "ready", "scheduled", "published", "rejected"] as const).map(status => (
            <Button
              key={status}
              variant={filter === status ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(status as any)}
              className="capitalize"
            >
              {status.replace("_", " ")}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredDrafts.length === 0 ? (
        <Card className="bg-muted/10 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Kanban className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
            <h3 className="text-lg font-medium">No drafts found</h3>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or head to the Studio to create one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDrafts.map((draft: any) => (
            <Card key={draft.id} className="flex flex-col h-full overflow-hidden">
              <div className="h-40 bg-muted/50 border-b relative flex items-center justify-center">
                {draft.assetPack?.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={draft.assetPack.imageUrl} alt="Asset" className="object-cover h-full w-full" />
                ) : (
                  <span className="text-sm text-muted-foreground">No Media Attached</span>
                )}
                <Badge className="absolute top-2 right-2 bg-black/70 hover:bg-black/80 capitalize">
                  {draft.format}
                </Badge>
              </div>
              <CardHeader className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant={
                    draft.status === "published" ? "default" : 
                    draft.status === "ready" ? "secondary" : 
                    draft.status === "rejected" ? "destructive" : "outline"
                  } className="capitalize">
                    {draft.status.replace("_", " ")}
                  </Badge>
                  {draft.qualityScore && (
                    <div className="flex items-center gap-1 text-xs font-bold px-2 py-1 bg-muted rounded-full">
                      {draft.qualityScore.gate === "pass" ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : 
                       draft.qualityScore.gate === "warn" ? <AlertTriangle className="h-3 w-3 text-yellow-500" /> :
                       <XCircle className="h-3 w-3 text-red-500" />}
                      {draft.qualityScore.overall}
                    </div>
                  )}
                </div>
                <CardTitle className="text-base line-clamp-2">
                  {draft.conceptBrief?.sourceSummary || "Generated Draft"}
                </CardTitle>
                <CardDescription className="line-clamp-3 mt-2 text-sm">
                  {draft.caption || draft.conceptBrief?.hookOptions?.[0] || "No caption written."}
                </CardDescription>
              </CardHeader>
              <CardContent className="bg-muted/10 pt-4 border-t mt-auto">
                <div className="flex gap-2">
                  <Button 
                    className="flex-1" 
                    variant="default"
                    disabled={draft.status === "published" || publishDraft.isPending}
                    onClick={() => publishDraft.mutate({ caption: draft.caption || "", imageUrl: draft.assetPack?.imageUrl || "" })}
                  >
                    <Send className="h-4 w-4 mr-2" /> Publish
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-none text-destructive hover:bg-destructive/10"
                    disabled={draft.status === "published" || draft.status === "rejected"}
                    onClick={() => rejectDraft.mutate({ id: draft.id, reason: "Manual Rejection" })}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
