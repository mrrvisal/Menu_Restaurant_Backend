require("dotenv").config();
const fs = require("fs");
const mysql = require("mysql2/promise");
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { ca: fs.readFileSync(process.env.DB_CA_PATH), rejectUnauthorized: true },
  });
  const [rows] = await conn.query(
    "SELECT id, email, role, status, email_verified_at, google_id IS NOT NULL AS has_google FROM users ORDER BY id",
  );
  console.table(rows);
  await conn.end();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
