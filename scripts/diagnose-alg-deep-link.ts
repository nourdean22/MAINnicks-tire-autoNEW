import "dotenv/config";

async function main() {
  const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
  const sample = "d1cd7074-87a9-4de3-a278-80b8ef73b0a1";
  const inv = "3572";
  for (const url of [
    `${SHOPDRIVER_BASE}/ticket/${sample}`,
    `${SHOPDRIVER_BASE}/Ticket/${sample}`,
    `${SHOPDRIVER_BASE}/ticket/${inv}`,
    `${SHOPDRIVER_BASE}/invoice/${inv}`,
    `${SHOPDRIVER_BASE}/Ticket/details/${sample}`,
    `${SHOPDRIVER_BASE}/recent?ticketId=${sample}`,
    `${SHOPDRIVER_BASE}/recent?invoiceNumber=${inv}`,
    `${SHOPDRIVER_BASE}/sessions/${sample}`,
    `${SHOPDRIVER_BASE}/ticketSession/${sample}`,
    `${SHOPDRIVER_BASE}/manage/ticket/${sample}`,
  ]) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual" });
      const text = await r.text();
      const isSPAShell = text.length < 5000 && /<div id="root">/.test(text);
      console.log(`${r.status} · len=${text.length} · ${isSPAShell ? "SPA-shell" : "OTHER"} · ${url}`);
    } catch (e) {
      console.log(`THREW · ${url} · ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
