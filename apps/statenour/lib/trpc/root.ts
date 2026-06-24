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
import { chatRouter } from "./routers/chat";
import { browserRouter } from "./routers/browser";
import { taskRouter } from "./routers/task";
import { journalRouter } from "./routers/journal";
import { brainRouter } from "./routers/brain";
import { aiRouter } from "./routers/ai";
import { contentStudioRouter } from "./routers/content-studio";

export const appRouter = router({
  nick: nickRouter,
  operator: operatorRouter,
  system: systemRouter,
  chat: chatRouter,
  browser: browserRouter,
  task: taskRouter,
  journal: journalRouter,
  brain: brainRouter,
  ai: aiRouter,
  contentStudio: contentStudioRouter,
});

/** Type-only export for the client · NEVER import appRouter on the
 *  client (would balloon the bundle with server-only code). */
export type AppRouter = typeof appRouter;
