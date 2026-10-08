import { useState } from "react";
import { AlertTriangle, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

/**
 * BLIND PAIRWISE REVIEW (2026-10-08, services/pairwiseReview.ts).
 *
 * Two recent photo posts, no scores, one tap. The pick is the only ground
 * truth the independent judge has ever been measured against; the line under
 * the pair is the running agreement. Three states: a pair to pick, verified
 * nothing left to compare, or unreadable. Every tap target is >= 48px.
 */
const PICK_LABEL = { a: "Left is better", b: "Right is better", tie: "Can't tell" } as const;

export function PairwisePick() {
  const utils = trpc.useUtils();
  const next = trpc.contentAdmin.pairwiseNext.useQuery(undefined, { refetchInterval: 300_000 });
  const pick = trpc.contentAdmin.pairwisePick.useMutation({
    onSuccess: () => { void utils.contentAdmin.pairwiseNext.invalidate(); },
  });
  const [error, setError] = useState<string | null>(null);
  const data = next.data;
  const pair = data?.available ? data.pair : null;
  const readout = data?.available ? data.readout : null;

  const submit = (choice: "a" | "b" | "tie") => {
    if (!pair) return;
    setError(null);
    pick.mutate({ aId: pair.a.id, bId: pair.b.id, pick: choice }, { onError: (e) => setError(e.message) });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Scale className="h-5 w-5 text-primary" /> Which post is better?</CardTitle>
        <CardDescription>
          Blind: no scores shown. Your pick is compared with the judge that gates live posts.
          {readout && readout.scored > 0
            ? ` So far you agreed with it ${readout.agreed} of ${readout.scored} time${readout.scored === 1 ? "" : "s"}${readout.ties ? ` (${readout.ties} too close to call)` : ""}.`
            : readout ? " No scored pick yet." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {next.isLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : next.isError || !data ? (
          <div role="alert" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>Could not load a pair — this is <strong>unknown</strong>, not empty.{next.error?.message ? ` (${next.error.message})` : ""}</span>
          </div>
        ) : !data.available ? (
          <div role="alert" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>Pairs unreadable: {data.reason}</span>
          </div>
        ) : !pair ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nothing left to compare — every recent judged post has been paired ({data.candidates} in the last 30 days).
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {([["a", pair.a], ["b", pair.b]] as const).map(([side, post]) => (
                <figure key={side} className="min-w-0 space-y-2">
                  <img src={post.imageUrl} alt={side === "a" ? "Left post" : "Right post"} className="aspect-[4/5] w-full rounded-lg object-cover" loading="lazy" />
                  <figcaption className="line-clamp-4 text-xs text-muted-foreground">{post.caption}</figcaption>
                </figure>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["a", "tie", "b"] as const).map((choice) => (
                <Button key={choice} variant={choice === "tie" ? "outline" : "default"} className="min-h-12" disabled={pick.isPending} onClick={() => submit(choice)}>
                  {pick.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : PICK_LABEL[choice]}
                </Button>
              ))}
            </div>
            {error && <p role="alert" className="text-xs text-red-400">Pick not recorded: {error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
