// create-qr-codes-table.js
// One-shot: ensure the `qr_codes` table exists on the connected database
// (idempotent). Uses the app's real connection config (config/db.js).
// Run: node create-qr-codes-table.js
require("dotenv").config();
const db = require("./config/db");

const CREATE = `
CREATE TABLE IF NOT EXISTS qr_codes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  table_no      INT NOT NULL,
  qr_url        TEXT,
  qr_data_url   LONGTEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_restaurant_table (restaurant_id, table_no)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

const ENSURE_FK = `
SELECT COUNT(*) AS c FROM information_schema.table_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'qr_codes'
  AND constraint_name = 'fk_qr_restaurant'
  AND constraint_type = 'FOREIGN KEY'
`;

async function main() {
  console.log(`Ensuring qr_codes table exists (${process.env.DB_NAME})...`);
  await db.query(CREATE);
  console.log("✅ qr_codes table ready");

  const [[{ c }]] = await db.query(ENSURE_FK);
  if (c === 0) {
    try {
      await db.query(
        `ALTER TABLE qr_codes ADD CONSTRAINT fk_qr_restaurant
         FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE`,
      );
      console.log("✅ Added fk_qr_restaurant foreign key");
    } catch (e) {
      // FK may fail if TiDB tier doesn't support it on this table — non-fatal
      console.log("ℹ️ FK note:", e.message);
    }
  } else {
    console.log("✅ fk_qr_restaurant already exists");
  }

  const [cols] = await db.query("SHOW COLUMNS FROM qr_codes");
  console.log("Columns:", cols.map((c) => c.Field).join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  });