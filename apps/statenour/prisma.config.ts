import { defineConfig } from "prisma/config";
import { loadEnvConfig } from "@next/env";

// Load environment variables from .env and .env.local
loadEnvConfig(process.cwd());

const placeholderUrl = "postgresql://user:password@localhost:5432/statenour";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts"
  },
  // @ts-expect-error — Prisma 7 removed engine from defineConfig type but Vercel still needs it at runtime
  engine: "classic",
  datasource: {
    url: process.env.DATABASE_URL || placeholderUrl
  }
});
