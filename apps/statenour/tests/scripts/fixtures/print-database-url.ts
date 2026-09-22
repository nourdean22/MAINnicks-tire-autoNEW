/**
 * Fixture for seed-policies-dry-run.test.ts (review on #2498): run @next/env's
 * loadEnvConfig the way lib/prisma.ts does, then print the DATABASE_URL a child
 * would actually connect with. The test asserts it is the inert url it injected,
 * proving an env file in the checkout cannot restore a real one.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
console.log(process.env.DATABASE_URL ?? "(unset)");
