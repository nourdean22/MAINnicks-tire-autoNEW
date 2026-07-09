const mysql = require('mysql2/promise');
async function run() {
  const con = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await con.query(`SHOW TABLES LIKE 'sms_preferences'`);
  console.log(rows.length > 0 ? 'EXISTS' : 'ABSENT');
  process.exit(0);
}
run();
