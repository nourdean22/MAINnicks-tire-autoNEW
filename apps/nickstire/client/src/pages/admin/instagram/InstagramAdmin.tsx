import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HQ } from "./HQ";
import StudioV2 from "./StudioV2";
import QueueV2 from "./QueueV2";
import { Inbox } from "./Inbox";
import Learn from "./Learn";
import Settings from "./Settings";

export function InstagramAdmin() {
  const [activeTab, setActiveTab] = useState("hq");

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Instagram Operating System</h2>
          <p className="text-muted-foreground">Create, verify, render, approve, publish, and learn from one controlled workflow.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 gap-1 lg:grid-cols-6">
          <TabsTrigger value="hq">HQ</TabsTrigger>
          <TabsTrigger value="studio">Studio</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="learn">Learn</TabsTrigger>
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
        <TabsContent value="inbox" className="mt-4">
          <Inbox onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="learn" className="mt-4">
          <Learn onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <Settings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
