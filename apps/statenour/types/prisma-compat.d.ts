/**
 * Retired-model compat types (Apr 18)
 *
 * These Prisma models were dropped from schema.prisma as part of the
 * April separation pass. Call sites haven't been individually
 * rewritten — instead, a proxy shim in lib/prisma.ts returns empty
 * results from every method, and this module augmentation keeps the
 * PrismaClient type surface happy.
 *
 * When the LAST caller of a given model is gone, drop:
 *   1. its entry in RETIRED_MODELS in lib/prisma.ts
 *   2. its interface below
 */
import "@prisma/client";

type AnyArgs = Record<string, unknown> | undefined;

// Permissive shape that mirrors the runtime shim. Each method resolves
// to something the caller can null-check; counts/aggregates return 0
// or zero-valued objects.
type RetiredModelStub = {
  findFirst(args?: AnyArgs): Promise<any | null>;
  findUnique(args?: AnyArgs): Promise<any | null>;
  findMany(args?: AnyArgs): Promise<any[]>;
  count(args?: AnyArgs): Promise<number>;
  aggregate(args?: AnyArgs): Promise<any>;
  groupBy(args?: AnyArgs): Promise<any[]>;
  create(args?: AnyArgs): Promise<any | null>;
  update(args?: AnyArgs): Promise<any | null>;
  upsert(args?: AnyArgs): Promise<any | null>;
  delete(args?: AnyArgs): Promise<any | null>;
  deleteMany(args?: AnyArgs): Promise<{ count: number }>;
  updateMany(args?: AnyArgs): Promise<{ count: number }>;
  createMany(args?: AnyArgs): Promise<{ count: number }>;
};

declare module "@prisma/client" {
  interface PrismaClient {
    // Retirement group 1 — concept retirements
    dailyScore: RetiredModelStub;
    openLoop: RetiredModelStub;
    morningBrief: RetiredModelStub;

    // Retirement group 2 — business layer (moved to nickstire.org)
    customer: RetiredModelStub;
    customerProfile: RetiredModelStub;
    job: RetiredModelStub;
    lead: RetiredModelStub;
    quote: RetiredModelStub;
    quoteItem: RetiredModelStub;
    quoteTemplate: RetiredModelStub;
    markupRule: RetiredModelStub;
    tire: RetiredModelStub;
    laborOperation: RetiredModelStub;
    scraperRun: RetiredModelStub;
    applicant: RetiredModelStub;
    appointmentRequest: RetiredModelStub;
    competitorPrice: RetiredModelStub;
    paymentRecord: RetiredModelStub;
    googleReview: RetiredModelStub;
    smsLog: RetiredModelStub;
    contentPost: RetiredModelStub;
    contentCalendar: RetiredModelStub;
    projection: RetiredModelStub;

    // Retirement group 3 — unused shell models
    masteryHabit: RetiredModelStub;
    weeklyReview: RetiredModelStub;
    notificationQueue: RetiredModelStub;
    integrationSyncLog: RetiredModelStub;
    simulation: RetiredModelStub;
    cameraRecording: RetiredModelStub;
    brokenPromiseLog: RetiredModelStub;
    cameraMetric: RetiredModelStub;
    cameraAlert: RetiredModelStub;
    knownFace: RetiredModelStub;
    plateLog: RetiredModelStub;
  }
}
