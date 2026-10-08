/**
 * Operator marks on a vehicle visit (migration 0145; camera audit 2026-10-07, N1).
 *
 * The sign camera sees a car arrive, park and enter a bay. It cannot see that the customer is
 * waiting in the lobby, that a technician started on the car in the lot, that the job is
 * finished and the car is waiting to be picked up, or that the car was never a job at all
 * (a delivery, a visitor, the owner's own car). Each of those is one tap on the floor board.
 *
 * The vocabulary is a VARCHAR on the wire and in the table, never an ENUM: TiDB rejects an
 * out-of-enum write and loses the row (skill nickstire-tidb-ddl). Adding a mark is adding a
 * string here and a label below; the server validates against this list.
 *
 * What a mark is NOT: a link. Nothing here binds a phone, a customer or an invoice to the
 * visit, and no mark calls a work-order or booking mutation (those text the customer).
 */
export const VISIT_MARKS = ["CUSTOMER_WAITING", "SERVICE_STARTED", "SERVICE_DONE", "NOT_A_JOB"] as const;
export type VisitMark = (typeof VISIT_MARKS)[number];

export const VISIT_MARK_LABELS: Record<VisitMark, string> = {
  CUSTOMER_WAITING: "Customer waiting",
  SERVICE_STARTED: "Service started",
  SERVICE_DONE: "Service done",
  NOT_A_JOB: "Not a job",
};

export function isVisitMark(value: unknown): value is VisitMark {
  return typeof value === "string" && (VISIT_MARKS as readonly string[]).includes(value);
}
