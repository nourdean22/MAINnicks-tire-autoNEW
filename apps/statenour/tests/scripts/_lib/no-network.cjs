// Preload for the brain-hygiene spawn tests (node --require). Any TCP, TLS, DNS or fetch attempt
// prints NETWORK_ATTEMPT and exits 97, so "the dry run never connects" is observed, not assumed.
// Local IPC (a string path or {path}) is allowed because tsx talks to its own child over a pipe.
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");

const trip = (what) => {
  process.stderr.write(`NETWORK_ATTEMPT:${what}\n`);
  process.exit(97);
};
const isIpc = (a) => (typeof a === "string" && !/^\d+$/.test(a)) || (a && typeof a === "object" && typeof a.path === "string");

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (!isIpc(first)) trip("net.Socket.connect");
  return origConnect.apply(this, args);
};
tls.connect = () => trip("tls.connect");
dns.lookup = () => trip("dns.lookup");
dns.promises.lookup = () => trip("dns.promises.lookup");
if (typeof globalThis.fetch === "function") globalThis.fetch = () => trip("fetch");
