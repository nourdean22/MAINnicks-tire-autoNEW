import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  console.log("Connecting to database to check for backup tables...");
  const conn = await mysql.createConnection(url);

  try {
    const [tables] = await conn.execute("SHOW TABLES");
    const tableNames = (tables as any[]).map(r => Object.values(r)[0] as string);
    const backupTables = tableNames.filter(name => name.startsWith("_bak_") || name.includes("_dedup_"));

    console.log("---------------------------------------------------------");
    console.log("Backup Tables Audit:");
    console.log("---------------------------------------------------------");

    if (backupTables.length === 0) {
      console.log("No backup tables starting with _bak_ or containing _dedup_ found.");
    } else {
      for (const table of backupTables) {
        const [countResult] = await conn.execute(`SELECT COUNT(*) as count FROM \`${table}\``);
        const count = (countResult as any[])[0]?.count ?? 0;

        // Get approximate table size from information_schema
        const [sizeResult] = await conn.execute(`
          SELECT (data_length + index_length) as size_bytes 
          FROM information_schema.TABLES 
          WHERE table_schema = DATABASE() AND table_name = '${table}'
        `);
        const sizeBytes = (sizeResult as any[])[0]?.size_bytes ?? 0;
        const sizeKB = (sizeBytes / 1024).toFixed(2);

        console.log(`Table: ${table}`);
        console.log(`  Rows: ${count}`);
        console.log(`  Size: ${sizeKB} KB (${sizeBytes} bytes)`);
        console.log("---------------------------------------------------------");
      }
    }
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error("Error running backup tables check:", err);
});
