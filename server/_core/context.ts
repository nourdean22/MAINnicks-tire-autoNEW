import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/**
 * Dev-only synthetic admin user for local preview.
 * Activates ONLY when NODE_ENV=development AND LOCAL_DEV_BYPASS_AUTH=1.
 * Never active in production — the env gate is a hard requirement.
 */
function buildDevAdminUser(): User {
  return {
    id: 0,
    openId: "dev:local-admin",
    name: "Local Dev Admin",
    email: process.env.ADMIN_EMAIL || "dev@localhost",
    loginMethod: "dev-bypass",
    role: "admin",
    loyaltyPoints: 0,
    loyaltyTier: "bronze",
    totalVisits: 0,
    totalSpent: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

const DEV_BYPASS_ACTIVE =
  process.env.NODE_ENV === "development" && process.env.LOCAL_DEV_BYPASS_AUTH === "1";

if (DEV_BYPASS_ACTIVE) {
  console.warn(
    "\n⚠ [dev-bypass] LOCAL_DEV_BYPASS_AUTH=1 — all requests authenticated as synthetic admin. Dev only.\n"
  );
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // Dev bypass: skip real auth entirely when explicitly enabled for local preview.
  if (DEV_BYPASS_ACTIVE) {
    return {
      req: opts.req,
      res: opts.res,
      user: buildDevAdminUser(),
    };
  }

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
