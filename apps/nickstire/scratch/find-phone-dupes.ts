import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    console.log("=== Checking Duplicate Phones within 24h ===");
    
    // Bookings
    const [bookingsRaw] = await conn.execute(
      "SELECT id, name, phone, service, createdAt FROM bookings ORDER BY createdAt ASC"
    );
    const bookings = bookingsRaw as any[];
    for (let i = 0; i < bookings.length; i++) {
      const bA = bookings[i];
      const pA = bA.phone.replace(/\D/g, "");
      if (pA.length < 7) continue;
      for (let j = i + 1; j < bookings.length; j++) {
        const bB = bookings[j];
        const pB = bB.phone.replace(/\D/g, "");
        if (pA === pB) {
          const hours = Math.abs(bA.createdAt.getTime() - bB.createdAt.getTime()) / (1000 * 60 * 60);
          if (hours <= 24) {
            console.log(`Booking duplicate phone found:`);
            console.log(`  Row A: ID ${bA.id} | Name: "${bA.name}" | Phone: "${bA.phone}" | Date: ${bA.createdAt.toISOString()} | Service: ${bA.service}`);
            console.log(`  Row B: ID ${bB.id} | Name: "${bB.name}" | Phone: "${bB.phone}" | Date: ${bB.createdAt.toISOString()} | Service: ${bB.service}`);
            console.log(`  Time Diff: ${hours.toFixed(1)} hours\n`);
          }
        }
      }
    }

    // Leads
    const [leadsRaw] = await conn.execute(
      "SELECT id, name, phone, problem, createdAt FROM leads ORDER BY createdAt ASC"
    );
    const leads = leadsRaw as any[];
    for (let i = 0; i < leads.length; i++) {
      const lA = leads[i];
      const pA = lA.phone.replace(/\D/g, "");
      if (pA.length < 7) continue;
      for (let j = i + 1; j < leads.length; j++) {
        const lB = leads[j];
        const pB = lB.phone.replace(/\D/g, "");
        if (pA === pB) {
          const hours = Math.abs(lA.createdAt.getTime() - lB.createdAt.getTime()) / (1000 * 60 * 60);
          if (hours <= 24) {
            console.log(`Lead duplicate phone found:`);
            console.log(`  Row A: ID ${lA.id} | Name: "${lA.name}" | Phone: "${lA.phone}" | Date: ${lA.createdAt.toISOString()}`);
            console.log(`  Row B: ID ${lB.id} | Name: "${lB.name}" | Phone: "${lB.phone}" | Date: ${lB.createdAt.toISOString()}`);
            console.log(`  Time Diff: ${hours.toFixed(1)} hours\n`);
          }
        }
      }
    }

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
