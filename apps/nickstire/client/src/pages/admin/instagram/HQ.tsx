import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface HQProps {
  onNavigate: (tab: string) => void;
}

export function HQ({ onNavigate }: HQProps) {
  const { data: brief, isLoading } = trpc.instagramAdmin.getCreationBrief.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-medium">Headquarters</h3>
        <Button onClick={() => onNavigate("studio")} className="gap-2">
          <Plus className="h-4 w-4" />
          Enter Studio
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="col-span-full">
          <CardHeader>
            <CardTitle>Current Creation Brief</CardTitle>
            <CardDescription>Performance-seeded guidance for your next post.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : brief ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Top Archetype (30d)</span>
                    <p className="text-lg font-semibold capitalize">{brief.topArchetypeLast30Days}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Optimal Posting Window</span>
                    <p className="text-lg font-semibold">{brief.optimalPostingWindow}</p>
                  </div>
                </div>
                
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Topics to Avoid</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-2">
                      {brief.topicsToAvoid.map((topic, i) => (
                        <li key={i}>{topic}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>

                <div>
                  <h4 className="font-medium mt-4 mb-2">Recent Winners</h4>
                  <div className="grid gap-2">
                    {brief.recentWinners.map((w, i) => (
                      <div key={i} className="text-sm p-2 bg-muted rounded border">
                        {w.caption || "Media post (no text)"}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Failed to load brief.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
