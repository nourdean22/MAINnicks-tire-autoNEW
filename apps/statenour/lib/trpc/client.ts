/**
 * lib/trpc/client.ts · Phase J (2026-05-18 PM)
 *
 * The client-side tRPC instance · type-safe import path for every
 * React component. Re-exports AppRouter as a TYPE only · never the
 * full router (would balloon the client bundle).
 *
 * Used as: import { trpc } from "@/lib/trpc/client"
 * Then:    const { data } = trpc.nick.history.useQuery();
 */

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "./root";

export const trpc = createTRPCReact<AppRouter>();
