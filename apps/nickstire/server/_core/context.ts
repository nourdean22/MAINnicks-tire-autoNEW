import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * wave-148 — set to true ONLY by the VAPI webhook handler when it
   * dispatches a tool call via voiceAgentRouter.createCaller. Gates
   * voiceAgent write mutations so direct HTTP callers can't insert
   * bookings/callbacks or trigger SMS sends without the VAPI
   * signature verification that happens at the webhook layer.
   */
  isVoiceAgentInternal?: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
