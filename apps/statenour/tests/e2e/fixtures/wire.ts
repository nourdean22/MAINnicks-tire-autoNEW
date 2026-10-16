/**
 * What a tRPC output looks like ON THE WIRE. The routers declare their outputs
 * with the service types, where timestamps are `Date`; the app has no tRPC
 * transformer, so the browser receives JSON and every Date arrives as an ISO
 * string. A fixture typed against the raw router output would have to lie
 * (a Date that is really a string) or fail; `Wire<T>` makes the declared type
 * say what the client really gets.
 */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
