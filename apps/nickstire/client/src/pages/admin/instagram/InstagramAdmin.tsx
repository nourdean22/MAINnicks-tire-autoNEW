import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HQ } from "./HQ";
import { Studio } from "./Studio";
import { Queue } from "./Queue";
import { Inbox } from "./Inbox";
import { Learn } from "./Learn";

export function InstagramAdmin() {
  const [activeTab, setActiveTab] = useState("hq");

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Instagram Engine</h2>
          <p className="text-muted-foreground">Command and Control for social operations.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="hq">HQ</TabsTrigger>
          <TabsTrigger value="studio">Studio</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="learn">Learn</TabsTrigger>
        </TabsList>
        <TabsContent value="hq" className="mt-4">
          <HQ onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="studio" className="mt-4">
          <Studio onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="queue" className="mt-4">
          <Queue onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="inbox" className="mt-4">
          <Inbox onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="learn" className="mt-4">
          <Learn onNavigate={setActiveTab} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
