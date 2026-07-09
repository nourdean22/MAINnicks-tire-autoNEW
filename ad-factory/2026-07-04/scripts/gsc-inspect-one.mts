/** One-off URL inspection: pnpm exec tsx gsc-inspect-one.mts <url> */
import path from "node:path";
import fs from "node:fs";

const NICKSTIRE_DIR = "C:/Users/nourd/NOURCITY/apps/nickstire";
const envText = fs.readFileSync(path.join(NICKSTIRE_DIR, ".env"), "utf8");
const env: Record<string, string> = {};
{
  const lines = envText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
    if (quote && !(value.length > 1 && value.endsWith(quote))) {
      const parts = [value.slice(1)];
      while (++i < lines.length) {
        if (lines[i].endsWith(quote)) { parts.push(lines[i].slice(0, -1)); break; }
        parts.push(lines[i]);
      }
      value = parts.join("\n");
    } else if (quote) value = value.slice(1, -1);
    env[m[1]] = value;
  }
}

const { google } = await import("googleapis");
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/webmasters"],
});
const sc = google.searchconsole({ version: "v1", auth });
const url = process.argv[2];
const r = await sc.urlInspection.index.inspect({
  requestBody: { inspectionUrl: url, siteUrl: "https://nickstire.org/" },
});
console.log(JSON.stringify(r.data.inspectionResult?.indexStatusResult, null, 2));
