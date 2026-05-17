// v10.0.209 · empty shim for the `server-only` package in vitest.
// In production, Next.js wires the real `server-only` module which
// throws if imported by a client bundle. In tests there's no client/
// server split — we just need the import to resolve to a no-op.
export {};
