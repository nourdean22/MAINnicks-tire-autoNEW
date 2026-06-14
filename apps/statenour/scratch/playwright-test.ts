import { chromium } from "@playwright/test";

async function main() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  page.on("pageerror", (err) => {
    console.error(`[BROWSER PAGE ERROR] ${err.stack || err.message}`);
  });

  console.log("Navigating to http://localhost:3001/stats...");
  try {
    await page.goto("http://localhost:3001/stats", { waitUntil: "networkidle", timeout: 30000 });
    console.log("Navigation completed. Waiting 5s for hydration...");
    await page.waitForTimeout(5000);
    
    console.log("Taking screenshot...");
    await page.screenshot({ path: "C:/Users/nourd/.gemini/antigravity-ide/brain/a0e50981-726b-439c-a72a-b28465a7bf9a/test_screenshot.png" });
    console.log("Screenshot saved.");
  } catch (err) {
    console.error("Error during test:", err);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main();
