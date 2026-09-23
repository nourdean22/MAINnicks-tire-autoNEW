/**
 * verify-resend-domain — is the sending domain actually able to send?
 *
 * WHY. 2026-09-23: EMAIL_FROM pointed at autonicks.com, a RETIRED domain that was
 * not registered on this Resend account at all, while the only domain on the
 * account (nickstire.org) had never been verified — status `not_started`, created
 * 2026-04-05, with no DNS records present. So every owner and applicant email was
 * failing, and a handoff note proposed fixing DNS for a domain the app did not
 * send from. This script answers the question directly instead of by inference:
 * it compares the sender domain against what Resend says it can send from.
 *
 * CORRECTION (audit-G, 2026-09-23). The paragraph above is #2593's account, and
 * its variable is wrong: no runtime code reads EMAIL_FROM. Both senders resolve
 * `RESEND_FROM_EMAIL || "Nick's Tire & Auto <noreply@nickstire.org>"`, so the app
 * was already sending from nickstire.org and the block is that domain's missing
 * DNS verification. This script now resolves the sender the same way (see
 * resend-sender.mjs) and prints which source it used.
 *
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/verify-resend-domain.mjs
 *   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/verify-resend-domain.mjs --trigger
 *
 * `--trigger` asks Resend to re-check DNS for the sender domain (the button in
 * their dashboard). It sends NO email and changes nothing else; run it after the
 * records are added. Verification is asynchronous, so re-run without the flag to
 * read the result.
 *
 * Three states, never two: a domain can be verified, not verified, or ABSENT from
 * the account — and absent is the one that looks like a DNS problem and is not.
 */
import { resolveSender } from "./resend-sender.mjs";

const API = "https://api.resend.com";

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error("RESEND_API_KEY is not set — run this through `railway run -s MAINnicks-tire-auto --`.");
  process.exit(1);
}
const TRIGGER = process.argv.includes("--trigger");

const sender = resolveSender(process.env);
const sendingDomain = sender.domain;
console.log(`sender: ${sender.from} (source: ${sender.source})`);
if (sender.ignoredEmailFrom) {
  console.log(`note: EMAIL_FROM="${sender.ignoredEmailFrom}" is set but no runtime code reads it — ignored.`);
}
if (!sendingDomain) {
  console.error(`cannot read a domain from "${sender.from}" — fix RESEND_FROM_EMAIL.`);
  process.exit(1);
}
console.log(`sender domain: ${sendingDomain}`);

const call = async (path, init) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
};

const list = await call("/domains");
const domains = list.data ?? [];
console.log(`domains on this Resend account: ${domains.length ? domains.map((d) => `${d.name} (${d.status})`).join(", ") : "none"}`);

const match = domains.find((d) => d.name === sendingDomain);
if (!match) {
  // The failure mode that reads like a DNS problem and is not one. Adding DNS for
  // some OTHER domain on the account will never fix this.
  console.log(`\nVERDICT: BLOCKED — ${sendingDomain} is NOT registered on this Resend account.`);
  console.log("Resend refuses a send whose From domain it does not hold, whatever the DNS says.");
  console.log(`Fix: add ${sendingDomain} in Resend and verify it, or point RESEND_FROM_EMAIL at a domain already on the account (unset it to use the nickstire.org default).`);
  process.exit(0);
}

if (TRIGGER) {
  console.log(`\nasking Resend to re-check DNS for ${sendingDomain} …`);
  await call(`/domains/${match.id}/verify`, { method: "POST" });
  console.log("verification requested — it is asynchronous; re-run without --trigger to read the result.");
}

const full = await call(`/domains/${match.id}`);
console.log(`\ndomain ${full.name} · status ${full.status} · region ${full.region}`);
const records = full.records ?? [];
for (const r of records) {
  const host = r.name === "" || r.name === "@" ? sendingDomain : `${r.name}.${sendingDomain}`;
  console.log(`  ${String(r.record).padEnd(5)} ${String(r.type).padEnd(4)} ${host.padEnd(34)} ${r.status ?? "?"}`);
}
const pending = records.filter((r) => r.status && r.status !== "verified");
console.log(
  full.status === "verified"
    ? `\nVERDICT: SENDING — ${sendingDomain} is verified; owner and applicant email can be delivered.`
    : `\nVERDICT: NOT SENDING — status ${full.status}${pending.length ? `, ${pending.length} record(s) not yet verified` : ""}. Add the records above at the DNS host, then re-run with --trigger.`,
);
process.exit(0);
