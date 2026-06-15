/**
 * Send VAPI dashboard quick-link to Telegram + email + create desktop shortcut.
 * One-off · 2026-05-08.
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const LINK = `https://dashboard.vapi.ai/assistants/${ASSISTANT_ID}`;

async function sendTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("Telegram env vars missing");
    return;
  }
  const text = `📞 VAPI Assistant Dashboard\n\nQuick link to edit Nick (the AI receptionist):\n${LINK}\n\nTo change the transfer number: Tools tab → transferCall → Destinations → Number field → SAVE/PUBLISH at top.`;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });
  console.log(`Telegram: ${res.status} · ${res.ok ? "✅ sent" : await res.text()}`);
}

async function sendEmail() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = "nourdean22@gmail.com";
  if (!apiKey) {
    console.error("RESEND_API_KEY missing");
    return;
  }
  const html = `
    <h2>📞 VAPI Assistant Dashboard</h2>
    <p>Quick link to edit Nick (the AI receptionist):</p>
    <p><a href="${LINK}" style="display:inline-block;padding:12px 20px;background:#10b981;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Open VAPI Dashboard →</a></p>
    <p style="color:#666;font-size:13px;">${LINK}</p>
    <hr/>
    <h3>To change the transfer number:</h3>
    <ol>
      <li>Click <strong>Tools</strong> tab</li>
      <li>Find <code>transferCall</code> in the list</li>
      <li>Expand it → Destinations → first entry</li>
      <li>Edit the Number field (E.164 format: <code>+12168620005</code>)</li>
      <li><strong>Click SAVE / PUBLISH at the top</strong> — this is the step that's easy to miss</li>
    </ol>
    <p>Most likely your earlier edit didn't stick because the publish button wasn't clicked. The dashboard keeps drafts separate from live until publish.</p>
  `;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || "Nick's Tire & Auto <onboarding@resend.dev>",
      to: [to],
      subject: "📞 VAPI Assistant Dashboard — Quick Link",
      html,
    }),
  });
  console.log(`Email: ${res.status} · ${res.ok ? "✅ sent to " + to : await res.text()}`);
}

function createDesktopShortcut() {
  // Windows .url file format — a Windows internet shortcut
  const desktop = join(homedir(), "OneDrive", "Desktop");
  const filePath = join(desktop, "VAPI Dashboard - Nick.url");
  const content = `[InternetShortcut]\nURL=${LINK}\nIconIndex=0\n`;
  writeFileSync(filePath, content, "utf8");
  console.log(`Desktop shortcut: ✅ created at ${filePath}`);
}

async function main() {
  console.log(`\n═══ Sending VAPI dashboard link 3 ways ═══`);
  console.log(`Link: ${LINK}\n`);
  await sendTelegram();
  await sendEmail();
  createDesktopShortcut();
  console.log(`\n✅ Done.`);
}

main().catch(err => { console.error(err); process.exit(1); });
