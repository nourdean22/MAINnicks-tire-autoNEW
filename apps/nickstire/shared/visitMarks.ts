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
 * CLEARED is the undo: rows are append-only, so a mis-tap (a thumb that landed on "Not a job"
 * on a phone) is reversed by appending CLEARED, after which only later marks count. The history
 * keeps every row, including the mistake and its correction.
 *
 * What a mark is NOT: a link. Nothing here binds a phone, a customer or an invoice to the
 * visit, and no mark calls a work-order or booking mutation (those text the customer).
 */
export const VISIT_MARKS = ["CUSTOMER_WAITING", "SERVICE_STARTED", "SERVICE_DONE", "NOT_A_JOB", "CLEARED"] as const;
export type VisitMark = (typeof VISIT_MARKS)[number];

/** The four marks the floor board offers as buttons; CLEARED is the separate undo. */
export const VISIT_MARK_BUTTONS = ["CUSTOMER_WAITING", "SERVICE_STARTED", "SERVICE_DONE", "NOT_A_JOB"] as const satisfies readonly VisitMark[];

export const VISIT_MARK_LABELS: Record<VisitMark, string> = {
  CUSTOMER_WAITING: "Customer waiting",
  SERVICE_STARTED: "Service started",
  SERVICE_DONE: "Service done",
  NOT_A_JOB: "Not a job",
  CLEARED: "Clear marks",
};

export function isVisitMark(value: unknown): value is VisitMark {
  return typeof value === "string" && (VISIT_MARKS as readonly string[]).includes(value);
}

/**
 * What the marks say about one visit, derived server-side (server/lib/visitMarks.ts) and read
 * by the Lot page. One type on both sides of the wire, so a server rename cannot compile on one
 * side and render a dash on the other.
 */
export type VisitMarkState = {
  /** The most recent mark still in force (after the last CLEARED), for the card's one-line status. */
  latest: { mark: VisitMark; atMs: number; note: string | null } | null;
  customerWaiting: boolean;
  notAJob: boolean;
  /** min(bayEnteredAt, SERVICE_STARTED mark); null = UNKNOWN. */
  serviceStartedAtMs: number | null;
  serviceStartedBy: "camera" | "mark" | null;
  serviceDoneAtMs: number | null;
  /**
   * When the service clock stopped without a done mark: the camera saw the car leave the bay
   * and no tap says otherwise. Null while the clock runs or when a done mark stopped it.
   */
  serviceEndedAtMs: number | null;
  /** True while the service clock is still advancing (started, not done, not ended, car still here). */
  serviceRunning: boolean;
  /** Start -> done, bay exit, departure or now. Null when service never started. */
  serviceMinutes: number | null;
  pickupPending: boolean;
  /** Done -> departure or now. Null when the job was never marked done. */
  pickupWaitMinutes: number | null;
  /** Marks in force (after the last CLEARED) that this build understood; 0 = nobody has said anything. */
  markCount: number;
};
