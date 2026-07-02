/**
 * lib/trpc/root.ts · Phase J (2026-05-18 PM)
 *
 * Root tRPC router. Aggregates all domain sub-routers and exports
 * AppRouter as the TYPE-ONLY import the client uses.
 *
 * Phase J scope: H-series surfaces only. Legacy REST endpoints
 * coexist · gradual migration · no big-bang cutover.
 */

import { router } from "./trpc";
import { nickRouter } from "./routers/nick";
import { operatorRouter } from "./routers/operator";
import { systemRouter } from "./routers/system";
import { systemAutomationRouter } from "./routers/system-automation";
import { systemBrainRouter } from "./routers/system-brain";
import { chatRouter } from "./routers/chat";
import { browserRouter } from "./routers/browser";
import { taskRouter } from "./routers/task";
import { journalRouter } from "./routers/journal";
import { brainRouter } from "./routers/brain";
import { aiRouter } from "./routers/ai";
import { contentStudioRouter } from "./routers/content-studio";
import { intelligenceRouter } from "./routers/intelligence";
import { observabilityRouter } from "./routers/observability";

export const appRouter = router({
  nick: nickRouter,
  operator: operatorRouter,
  system: systemRouter,
  systemAutomation: systemAutomationRouter,
  systemBrain: systemBrainRouter,
  chat: chatRouter,
  browser: browserRouter,
  task: taskRouter,
  journal: journalRouter,
  brain: brainRouter,
  ai: aiRouter,
  contentStudio: contentStudioRouter,
  intelligence: intelligenceRouter,
  observability: observabilityRouter,
});

/** Type-only export for the client · NEVER import appRouter on the
 *  client (would balloon the bundle with server-only code). */
export type AppRouter = typeof appRouter;
