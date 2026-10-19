/**
 * Bind the HTTP port, or die loudly.
 *
 * Express 5 changed `app.listen(port, callback)`: the callback also runs when the server emits an
 * `error` event (EADDRINUSE, EACCES), with the error as its first argument; Express 4 never did.
 * A callback that ignores its argument would log "listening" and leave the scheduler running with
 * nothing bound to the port, and Railway would see a healthy-looking process that serves nothing.
 *
 * Side-effect free and import-free on purpose: apps/statenour/tests/repo/worker-listen-error.test.ts
 * loads this file directly and drives it with a fake app.
 *
 * Typing is loose (`(error?: Error) => void`) so it also accepts Express 4 types, whose callback
 * is `() => void`.
 */
export interface Listenable<S> {
  listen(port: number, callback: (error?: Error) => void): S;
}

export interface ListenOptions {
  role: string;
  log: (line: string) => void;
  error: (line: string, cause?: unknown) => void;
  exit: (code: number) => void;
}

/** Returns whatever `app.listen` returned (the http.Server) so shutdown can still close it. */
export function listenOrExit<S>(app: Listenable<S>, port: number, opts: ListenOptions): S {
  return app.listen(port, (err?: Error) => {
    if (err) {
      opts.error(`[worker] failed to listen on :${port} · exiting 1`, err);
      opts.exit(1);
      return;
    }
    opts.log(`[worker] listening on :${port} · role=${opts.role} · scheduler started`);
  });
}
