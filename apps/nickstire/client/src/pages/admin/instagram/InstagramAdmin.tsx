import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HQ } from "./HQ";
import StudioV2 from "./StudioV2";
import QueueV2 from "./QueueV2";
import { Inbox } from "./Inbox";
import Learn from "./Learn";
import Settings from "./Settings";
import DraftBoardPanel from "../DraftBoardPanel";
import AutonomyCommandCenter from "@/components/admin/AutonomyCommandCenter";
import ActionCenter from "./ActionCenter";

export function InstagramAdmin() {
  const [activeTab, setActiveTab] = useState("hq");

  // A count ON THE TAB, so a held reel is visible without going looking for it.
  // Three reels once sat stuck for 32 hours precisely because nothing surfaced
  // them until someone thought to ask.
  const attention = trpc.contentAdmin.reelJobsNeedingAttention.useQuery(undefined, {
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const needsAttention = attention.data?.count ?? 0;

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Instagram Operating System</h2>
          <p className="text-muted-foreground">Create, verify, render, approve, publish, and learn from one controlled workflow.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 gap-1 lg:grid-cols-9">
          <TabsTrigger value="hq">HQ</TabsTrigger>
          <TabsTrigger value="studio">Studio</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="actions" className="relative">
            Actions
            {needsAttention > 0 && (
              <span
                className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white"
                aria-label={`${needsAttention} reel job(s) need attention`}
              >
                {needsAttention}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="drafts" title="Plan and edit drafts here — approving and publishing happens in Queue">Planning</TabsTrigger>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="learn">Learn</TabsTrigger>
          <TabsTrigger value="control">Control</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="hq" className="mt-4">
          <HQ onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="studio" className="mt-4">
          <StudioV2 />
        </TabsContent>
        <TabsContent value="queue" className="mt-4">
          <QueueV2 />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <ActionCenter />
        </TabsContent>
        <TabsContent value="drafts" className="mt-4">
          <DraftBoardPanel />
        </TabsContent>
        <TabsContent value="inbox" className="mt-4">
          <Inbox onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="learn" className="mt-4">
          <Learn onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="control" className="mt-4">
          <AutonomyCommandCenter />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <Settings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
