import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { readStatus, readStatusOfList, unavailableCopy } from "@/lib/queryState";
import { 
  MessageSquare, 
  ArrowRight, 
  RefreshCw, 
  Loader2, 
  Sparkles, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  Clock, 
  MessageCircle,
  AlertTriangle,
  ThumbsUp
} from "lucide-react";
import { toast } from "sonner";
import { checkReviewReply, hasBlockingFindings } from "@shared/reviewReplyQa";
import { writeCreateHandoff } from "./igViews";

interface InboxProps {
  onNavigate: (tab: string) => void;
}

export function Inbox({ onNavigate }: InboxProps) {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState<string>("");
  const [selectedTone, setSelectedTone] = useState<"warm" | "professional" | "witty" | "promo">("warm");
  /** Unanswered-first triage (Wave 7): the operator's actual job here is the
   *  comments nobody has replied to, not a flat chronological list. */
  const [commentFilter, setCommentFilter] = useState<"all" | "unanswered" | "replied">("all");

  // Load Content Opportunities from reviews
  // `isError` was not even destructured here, so a FAILED cluster read fell
  // through to "No prominent themes found right now." — a confident empty from a
  // read that never succeeded.
  const optQuery = trpc.reviewReplies.getContentClusters.useQuery();
  const { data: optData } = optQuery;
  const clusters = optData?.clusters;
  const optStatus = readStatus(optQuery, (d) => {
    const c = (d as { clusters?: unknown[] } | undefined)?.clusters;
    return Array.isArray(c) && c.length === 0;
  });

  // Load Live Post Feed
  const feedQuery = trpc.instagramAdmin.getLiveFeed.useQuery({ limit: 12 });
  const { data: posts, isLoading: loadingFeed, isError: feedError, error: feedErrorDetail, refetch: refetchFeed } = feedQuery;
  // The isError branch below is already honest. This catches the OTHER
  // not-read state: an offline/paused query leaves isError AND isLoading false
  // with data undefined, which fell through to "No posts cached. Make sure
  // Instagram credentials are set." — blaming a cause it never established.
  const feedStatus = readStatusOfList(feedQuery);

  // Load Comments for selected post
  const { data: commentsRes, isLoading: loadingComments, refetch: refetchComments } = trpc.instagramAdmin.getComments.useQuery(
    { mediaId: selectedPostId || "" },
    { enabled: !!selectedPostId }
  );

  // Sync Feed mutation
  const syncFeed = trpc.instagramAdmin.syncFeed.useMutation({
    onSuccess: () => {
      refetchFeed();
      toast.success("Feed cache successfully updated from Meta!");
    },
    onError: (err) => {
      toast.error("Failed to sync feed", { description: err.message });
    }
  });

  // Suggest AI Reply mutation
  const suggestReply = trpc.instagramAdmin.suggestReply.useMutation({
    onSuccess: (res) => {
      setReplyMessage(res.draft || "");
      if (res.blocked) {
        toast.warning("AI draft generated but triggered claim-safety rules. Please review and edit.");
      } else {
        toast.success("AI draft suggested!");
      }
    },
    onError: (err) => {
      toast.error("Failed to generate AI suggestion", { description: err.message });
    }
  });

  // Post Reply mutation
  const postReply = trpc.instagramAdmin.postReply.useMutation({
    onSuccess: () => {
      toast.success("Reply posted successfully!");
      setReplyingToCommentId(null);
      setReplyMessage("");
      refetchComments();
    },
    onError: (err) => {
      toast.error("Publish failed", { description: err.message });
    }
  });

  // Run claim-safety checker on the active reply message
  const clientFindings = replyMessage ? checkReviewReply(replyMessage) : [];
  const isBlockedBySafety = hasBlockingFindings(clientFindings);

  const selectedPost = posts?.find(p => p.id === selectedPostId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-medium flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Community Inbox
          </h3>
          <p className="text-sm text-muted-foreground">Moderate conversations, respond to followers, and find review-driven post ideas.</p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => syncFeed.mutate()} 
          disabled={syncFeed.isPending || loadingFeed}
          className="gap-2"
        >
          {syncFeed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync Feed
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar: Live Post List */}
        {/* dvh, not a fixed 600px: on the phone the two stacked 600px cards
            overflowed small viewports, and the fixed height put the reply
            composer under the iOS keyboard. dvh tracks the visual viewport,
            so the composer stays reachable while typing. */}
        <Card className="lg:col-span-4 flex flex-col h-[70dvh] lg:h-[600px] overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm font-semibold">Recent Instagram Feed</CardTitle>
            <CardDescription>Select a post to manage comments.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto flex-1 divide-y">
            {loadingFeed ? (
              <div className="flex flex-col items-center justify-center p-8 h-full space-y-2">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading feed...</span>
              </div>
            ) : feedError ? (
              // "No posts cached" is a claim about Instagram; when the QUERY
              // failed, the honest statement is that we could not look.
              <div className="flex flex-col items-center justify-center p-8 h-full text-center space-y-3">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <p className="text-sm">Could not read the cached feed — this is <strong>unknown</strong>, not empty.</p>
                <p className="text-xs text-muted-foreground">{feedErrorDetail?.message}</p>
                <Button size="sm" variant="outline" onClick={() => refetchFeed()}>Retry</Button>
              </div>
            ) : posts && posts.length > 0 ? (
              posts.map((post) => {
                const isSelected = post.id === selectedPostId;
                return (
                  <button
                    key={post.id}
                    onClick={() => {
                      setSelectedPostId(post.id);
                      setReplyingToCommentId(null);
                      setReplyMessage("");
                    }}
                    className={`w-full text-left p-3 transition-colors hover:bg-muted/50 flex gap-3 items-start ${
                      isSelected ? "bg-muted border-l-2 border-primary" : ""
                    }`}
                  >
                    {post.mediaUrl || post.thumbnailUrl ? (
                      <img 
                        src={post.mediaUrl || post.thumbnailUrl} 
                        alt="Post media" 
                        className="w-12 h-12 rounded object-cover border shrink-0 bg-muted"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0 border">
                        <MessageSquare className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-2 text-foreground/90">
                        {post.caption || <span className="italic text-muted-foreground">No caption</span>}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />
                          {new Date(post.posted).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <MessageCircle className="w-3 h-3" />
                          {post.comments} comments
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : feedStatus.state === "unavailable" ? (
              <div className="flex flex-col items-center justify-center p-8 h-full text-center space-y-3">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <p className="text-sm">{unavailableCopy(feedStatus.reason)}</p>
                <Button size="sm" variant="outline" onClick={() => refetchFeed()}>Retry</Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 h-full text-center space-y-4">
                {/* VERIFIED empty: the read succeeded and returned no posts. The
                    cache genuinely holds nothing — that is a real state and the
                    sync button is the right next action. */}
                <p className="text-sm text-muted-foreground">No posts in the feed cache — the cache was read and is empty.</p>
                <Button size="sm" onClick={() => syncFeed.mutate()} disabled={syncFeed.isPending}>
                  Sync Feed Cache
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Main Work Area: Comment Moderation */}
        <Card className="lg:col-span-8 flex flex-col h-[70dvh] lg:h-[600px] overflow-hidden">
          {selectedPostId ? (
            <>
              <CardHeader className="pb-3 border-b flex flex-row justify-between items-start gap-4">
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    Comment Moderation
                  </CardTitle>
                  <CardDescription className="line-clamp-1 mt-0.5">
                    Post: {selectedPost?.caption || "No caption"}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Refresh comments"
                  onClick={() => refetchComments()}
                  disabled={loadingComments}
                  className="h-11 w-11 p-0"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingComments ? "animate-spin" : ""}`} />
                </Button>
              </CardHeader>
              <CardContent className="p-0 overflow-y-auto flex-1 divide-y">
                {commentsRes?.ok !== false && (commentsRes?.comments?.length ?? 0) > 0 && (
                  <div className="flex gap-2 border-b bg-muted/10 p-2">
                    {(["all", "unanswered", "replied"] as const).map((f) => {
                      const count = f === "all"
                        ? commentsRes!.comments!.length
                        : commentsRes!.comments!.filter((c) => (f === "replied") === Boolean(c.replied)).length;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setCommentFilter(f)}
                          className={`min-h-11 rounded border px-3 text-xs capitalize transition-colors ${commentFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground hover:bg-muted border-border"}`}
                        >
                          {f} · {count}
                        </button>
                      );
                    })}
                  </div>
                )}
                {loadingComments ? (
                  <div className="flex flex-col items-center justify-center h-full space-y-2 p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Loading comments from Meta...</span>
                  </div>
                ) : commentsRes?.ok === false ? (
                  <div className="p-6">
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Meta Integration Error</AlertTitle>
                      <AlertDescription className="text-xs">
                        {commentsRes.error || "Failed to retrieve comments from the Instagram Graph API. Check your permissions and token status."}
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : commentsRes?.comments && commentsRes.comments.length > 0 ? (
                  <div className="divide-y">
                    {commentsRes.comments.filter((c) => commentFilter === "all" ? true : (commentFilter === "replied") === Boolean(c.replied)).map((comment) => (
                      <div key={comment.id} className="p-4 space-y-3 transition-colors hover:bg-muted/10">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-linear-to-tr from-rose-500/20 to-orange-500/20 border border-orange-500/30 flex items-center justify-center text-xs font-bold text-orange-600 dark:text-orange-400">
                              {comment.username.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-foreground">@{comment.username}</span>
                              <span className="text-[10px] text-muted-foreground ml-2">
                                {new Date(comment.timestamp).toLocaleDateString()} at {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {comment.likeCount > 0 && (
                              <Badge variant="outline" className="text-[10px] gap-1 py-0 px-1.5 text-muted-foreground border-muted-foreground/20">
                                <ThumbsUp className="w-2.5 h-2.5" />
                                {comment.likeCount}
                              </Badge>
                            )}
                            {comment.replied ? (
                              <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15 border-emerald-500/20 text-[10px] py-0 px-2 font-medium">
                                <CheckCircle2 className="w-3 h-3 mr-1 inline" /> Replied
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 border-amber-500/20 text-[10px] py-0 px-2 font-medium">
                                Pending
                              </Badge>
                            )}
                          </div>
                        </div>

                        <p className="text-sm text-foreground/90 pl-9 whitespace-pre-wrap leading-relaxed">
                          {comment.text}
                        </p>

                        {/* A real question in the comments is content evidence —
                            hand it to Create with the actual text, not a bare
                            tab switch (Wave 7). */}
                        {!comment.replied && comment.text.includes("?") && (
                          <div className="pl-9">
                            <Button size="sm" variant="ghost" className="min-h-11 px-2 text-xs text-primary" onClick={() => {
                              writeCreateHandoff({
                                sourceType: "customer_question",
                                detail: `A customer asked on Instagram: "${comment.text.slice(0, 400)}" — answer it usefully for everyone who has the same question.`,
                                objective: "education",
                              });
                              onNavigate("studio");
                            }}>
                              <Sparkles className="mr-1 h-3 w-3" /> Turn into a content idea
                            </Button>
                          </div>
                        )}

                        {!comment.replied && (
                          <div className="pl-9">
                            {replyingToCommentId === comment.id ? (
                              <Card className="border border-muted/80 bg-muted/30 p-4 space-y-4">
                                <div className="flex flex-col gap-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                                      Reply Draft
                                    </span>
                                    {/* 44px targets: the old px-2 py-0.5 text-[10px]
                                        chips were ~21px tall — a mis-tap silently
                                        changed which tone the AI drafts in. */}
                                    <div className="flex flex-wrap gap-2">
                                      {(["warm", "professional", "witty", "promo"] as const).map((t) => (
                                        <button
                                          key={t}
                                          type="button"
                                          disabled={suggestReply.isPending}
                                          onClick={() => setSelectedTone(t)}
                                          className={`min-h-11 px-3 text-xs rounded border capitalize transition-colors ${
                                            selectedTone === t
                                              ? "bg-primary text-primary-foreground border-primary font-medium"
                                              : "bg-background text-muted-foreground hover:bg-muted border-border"
                                          }`}
                                        >
                                          {t}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={suggestReply.isPending || postReply.isPending}
                                      onClick={() => suggestReply.mutate({ commentText: comment.text, tone: selectedTone })}
                                      className="w-full text-xs gap-1.5 min-h-11 border-dashed hover:border-solid"
                                    >
                                      {suggestReply.isPending ? (
                                        <>
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                          Drafting...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="w-3.5 h-3.5 text-primary" />
                                          Generate AI Suggestion
                                        </>
                                      )}
                                    </Button>
                                  </div>

                                  <Textarea
                                    value={replyMessage}
                                    onChange={(e) => setReplyMessage(e.target.value)}
                                    placeholder="Write a response..."
                                    className="text-xs min-h-[70px] bg-background"
                                    disabled={postReply.isPending}
                                    maxLength={2000}
                                  />

                                  {/* Claim-Safety feedback */}
                                  {clientFindings.length > 0 && (
                                    <div className="space-y-1.5">
                                      {clientFindings.map((f, i) => (
                                        <Alert key={i} variant={f.severity === "block" ? "destructive" : "default"} className={`py-1 px-3 border text-[11px] leading-normal flex items-start gap-2 ${f.severity === "warn" ? "border-yellow-500/30 text-yellow-600 dark:text-yellow-400 bg-yellow-500/10" : ""}`}>
                                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                          <div>
                                            <span className="font-semibold capitalize">{f.severity}</span>: matches rule "{f.rule}" on "{f.match}". Fix: {f.fix}
                                          </div>
                                        </Alert>
                                      ))}
                                    </div>
                                  )}

                                  <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1">
                                    <span>{replyMessage.length} / 2000 chars</span>
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={postReply.isPending}
                                        onClick={() => {
                                          setReplyingToCommentId(null);
                                          setReplyMessage("");
                                        }}
                                        className="min-h-11 px-3 text-xs"
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        size="sm"
                                        disabled={!replyMessage.trim() || isBlockedBySafety || postReply.isPending}
                                        onClick={() => postReply.mutate({ commentId: comment.id, message: replyMessage })}
                                        className="min-h-11 px-4 text-xs gap-1.5"
                                      >
                                        {postReply.isPending ? (
                                          <>
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Posting...
                                          </>
                                        ) : (
                                          <>
                                            <Send className="w-3 h-3" />
                                            Post Live
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </Card>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setReplyingToCommentId(comment.id);
                                  setReplyMessage("");
                                  setSelectedTone("warm");
                                }}
                                className="min-h-11 text-xs"
                              >
                                Reply
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 h-full text-center space-y-2 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 stroke-[1.5]" />
                    <p className="text-sm">No comments found on this post.</p>
                  </div>
                )}
              </CardContent>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center animate-pulse">
                <MessageSquare className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <div className="space-y-1 max-w-sm">
                <p className="text-sm font-semibold">Select a Post</p>
                <p className="text-xs text-muted-foreground">
                  Select a post from the live feed on the left to moderate comments, draft replies, and use the AI co-pilot.
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Review-Driven Content Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle>Content Opportunities (From Reviews)</CardTitle>
          <CardDescription>We analyzed recent reviews to find topics your customers care about.</CardDescription>
        </CardHeader>
        <CardContent>
          {optStatus.state === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Analyzing insights...</span>
            </div>
          ) : optStatus.state === "unavailable" ? (
            <div className="flex items-center gap-2 py-4 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
              <span>{unavailableCopy(optStatus.reason)}</span>
            </div>
          ) : clusters && clusters.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {clusters.map((cluster, i) => (
                <Card key={i} className="border bg-muted/20">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="capitalize">{cluster.label}</Badge>
                      <span className="text-xs text-muted-foreground">{cluster.count} mentions</span>
                    </div>
                  </CardHeader>
                  <CardContent className="pb-2">
                    <p className="text-xs text-muted-foreground italic line-clamp-3">
                      "{cluster.sample}"
                    </p>
                  </CardContent>
                  <CardFooter>
                    {/* REAL handoff (Wave 5): the theme, sample quote, and
                        mention count ride along — this used to be a bare tab
                        switch that threw away everything on this card. */}
                    <Button variant="ghost" size="sm" className="w-full justify-between min-h-11" onClick={() => {
                      writeCreateHandoff({
                        sourceType: "review",
                        detail: `Customers keep mentioning "${cluster.label}" (${cluster.count} mentions). Example: "${cluster.sample}"`,
                        objective: "trust",
                      });
                      onNavigate("studio");
                    }}>
                      Create Post
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4">No prominent themes found right now.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
