import * as fs from "fs";
import * as path from "path";
import { sendTelegramOpsAlert } from "../ai/telegram-ops";
import { prisma } from "../../lib/prisma";

export async function runIntelligenceMatching() {
  const csvPath = path.resolve(process.cwd(), "../../apps/nickstire/data/shopdriver-customers.csv");
  
  if (!fs.existsSync(csvPath)) {
    console.warn("[intelligence-matching] CSV not found at:", csvPath);
    return;
  }

  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  
  if (lines.length <= 1) return; // Only headers

  // Pick a random customer from the first 50 lines to simulate a match
  const matchIndex = Math.floor(Math.random() * 50) + 1;
  const matchLine = lines[matchIndex];
  
  // Format: firstName,lastName,companyName,workPhone,homePhone,mobilePhone,email,address1,...
  const columns = matchLine.split(",").map(c => c.replace(/^"|"$/g, ""));
  const firstName = columns[0];
  const lastName = columns[1];
  const rawMobile = columns[5];

  // E.164 normalization
  let normalizedPhone = rawMobile?.replace(/\D/g, "");
  if (normalizedPhone && normalizedPhone.length === 10) {
    normalizedPhone = "+1" + normalizedPhone;
  }

  if (!normalizedPhone || normalizedPhone.length < 11) {
    console.warn(`[intelligence-matching] Invalid phone for ${firstName} ${lastName}`);
    return;
  }

  // Mock NHTSA Recall Match
  const mockVehicle = "2012 Honda Civic";
  const mockRecall = "Takata Airbag Inflator Rupture Risk";

  const messageText = `🚨 **INTELLIGENCE MATCH** 🚨
*Customer:* ${firstName} ${lastName}
*Phone:* ${normalizedPhone}
*Vehicle:* ${mockVehicle}
*Recall:* ${mockRecall}
    
⚠️ *Action Required:* Do you want to dispatch a warning SMS and invite them for a free inspection?`;

  // Create ActionReceipt
  const receipt = await (prisma as any).actionReceipt.create({
    data: {
      actionType: "SMS_BROADCAST",
      targetId: normalizedPhone,
      status: "PENDING",
      payload: {
        customerName: `${firstName} ${lastName}`,
        vehicle: mockVehicle,
        recall: mockRecall,
        smsBody: `Hi ${firstName}, Nick's Tire Auto here. Your ${mockVehicle} has an active recall for: ${mockRecall}. Please call us at (440) 263-1576 to schedule a free inspection.`
      }
    }
  });

  // Send interactive alert
  await sendTelegramOpsAlert(messageText, {
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "✅ Approve & Send SMS", callback_data: `intell_recall:approve:${receipt.id}` },
          { text: "❌ Reject", callback_data: `intell_recall:reject:${receipt.id}` }
        ]
      ]
    }
  });
  
  console.log(`[intelligence-matching] Match flagged and sent to Telegram for receipt ${receipt.id}`);
}
