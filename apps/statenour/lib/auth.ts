import { auth, authEnabled } from "@/auth";

export type OperatorSession = {
  id: string;
  name: string;
  email: string;
  role: "operator";
};

function getMockOperatorSession(): OperatorSession {
  return {
    id: process.env.AUTH_MOCK_USER_ID || "operator-1",
    name: process.env.AUTH_MOCK_USER_NAME || "Nick Statenour",
    email: process.env.AUTH_MOCK_USER_EMAIL || "operator@statenour.local",
    role: "operator"
  };
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  if (!authEnabled) {
    return getMockOperatorSession();
  }

  const session = await auth();
  // 07-SN-13 (b): auth is on and nobody is signed in. The mock operator here let the sign-in page
  // treat an anonymous visitor as the owner whenever the mock email matched AUTH_ALLOWED_EMAIL.
  if (!session?.user?.email) {
    return null;
  }

  return {
    id: (session.user as { id?: string }).id || "operator-1",
    name: session.user.name || "Operator",
    email: session.user.email,
    role: "operator"
  };
}

export function getAuthRuntimeMode() {
  return authEnabled ? "google" : "mock";
}
