import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { NextResponse } from "next/server";

const allowedEmail = (process.env.AUTH_ALLOWED_EMAIL || "").trim().toLowerCase();

/**
 * AUTH_FORCE_MOCK=1 bypasses Google OAuth even when all credentials
 * are present. Useful for local dev where localhost isn't in the
 * registered redirect URIs + you don't want to touch the Google
 * Cloud Console just to open the app on :3001. Set in .env.local
 * — production never reads this flag because .env.local isn't
 * deployed.
 */
const forceMock =
  (process.env.AUTH_FORCE_MOCK ?? "").trim() === "1" ||
  (process.env.AUTH_FORCE_MOCK ?? "").trim().toLowerCase() === "true";

export const authEnabled = !forceMock && Boolean(
  process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET
);

const authRuntime = authEnabled
  ? NextAuth({
      trustHost: true,
      session: {
        strategy: "jwt"
      },
      providers: [
        Google({
          clientId: process.env.AUTH_GOOGLE_CLIENT_ID,
          clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET
        })
      ],
      pages: {
        signIn: "/auth/sign-in"
      },
      callbacks: {
        async signIn({ user }) {
          const email = (user.email || "").trim().toLowerCase();
          if (!email || !allowedEmail) {
            return false;
          }

          return email === allowedEmail;
        },
        async jwt({ token, user }) {
          if (user?.name) {
            token.name = user.name;
          }
          if (user?.email) {
            token.email = user.email;
          }
          return token;
        },
        async session({ session, token }) {
          if (session.user) {
            session.user.name = session.user.name || (typeof token.name === "string" ? token.name : "Operator");
            session.user.email = session.user.email || (typeof token.email === "string" ? token.email : "");
            (session.user as { id?: string; role?: "operator" }).id = token.sub || "operator-1";
            (session.user as { id?: string; role?: "operator" }).role = "operator";
          }

          return session;
        }
      }
    })
  : null;

const disabledHandler = async () => NextResponse.json({ error: "Auth disabled." }, { status: 404 });

const disabledAuth = ((input?: unknown) => {
  if (typeof input === "function") {
    return async (...args: unknown[]) => (input as (...handlerArgs: unknown[]) => unknown)(...args);
  }

  return null;
}) as {
  (): Promise<null>;
  <T extends (...args: any[]) => any>(handler: T): T;
};

export const handlers = authRuntime?.handlers ?? {
  GET: disabledHandler,
  POST: disabledHandler
};

export const auth = authRuntime?.auth ?? disabledAuth;

export const signIn =
  authRuntime?.signIn ??
  (async () => {
    throw new Error("Auth is disabled.");
  });

export const signOut =
  authRuntime?.signOut ??
  (async () => {
    throw new Error("Auth is disabled.");
  });
