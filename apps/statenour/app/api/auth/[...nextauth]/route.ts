import { handlers } from "@/auth";

// public: NextAuth's own sign-in, callback, session and csrf handlers; they ARE the session gate.
export const { GET, POST } = handlers;
