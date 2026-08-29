// ═══════════════════════════════════════════════════════════╗
// fix-restaurants-unique.js
// One-command DB migration for "Multiple restaurants per owner"
//   Run from Menu_Restaurant_Backend:  node fix-restaurants-unique.js
//   Safe to re-run (idempotent).
// ═══════════════════════════════════════════════════════════╝
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_NAME = process.env.DB_NAME || 'menu_restaurant';
function log(ok, msg) { console.log(`${ok ? '✅' : '❌'} ${msg}`); }

async function main() {
  console.log(`\n📦 Connecting to ${process.env.DB_HOST}:${process.env.DB_PORT}/${DB_NAME} ...\n`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: DB_NAME,
    charset: 'utf8mb4',
    ssl: process.env.DB_CA_PATH
      ? { ca: fs.readFileSync(path.resolve(__dirname, process.env.DB_CA_PATH)), rejectUnauthorized: true }
      : undefined,
  });
  const q = async (sql, params = []) => (await conn.query(sql, params))[0];
  const one = async (sql, params = []) => (await conn.query(sql, params))[0][0];

  await applySteps(conn, q, one);
  await conn.end();
  console.log('\n🎉 DONE. "Create restaurant" (ER_DUP_ENTRY) and "Get menus" (ER_NO_SUCH_TABLE) should now be fixed.');
  console.log('   Reload the admin page and try adding a 2nd restaurant.\n');
}

async function applySteps(conn, q, one) {
  // ─── 0. DIAGNOSE ──────────────────────────────────────────
  console.log('──── 0. Current state ────');
  const indexes = await q(
    `SELECT index_name AS idx, non_unique AS uniq
     FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'restaurants' GROUP BY index_name, non_unique`,
    [DB_NAME]
  );
  console.log('   Indexes on restaurants:');
  for (const i of indexes) console.log(`     - ${i.idx} (unique=${i.uniq === 0})`);
  const fks = await q(
    `SELECT constraint_name AS cn, column_name AS col, referenced_table_name AS rt
     FROM information_schema.key_column_usage
     WHERE table_schema = ? AND table_name = 'restaurants' AND referenced_table_name IS NOT NULL`,
    [DB_NAME]
  );
  console.log('   Foreign keys on restaurants:');
  for (const f of fks) console.log(`     - ${f.cn} (${f.col} -> ${f.rt}.id)`);

  // ─── 1. Drop FK on owner_id ──────────────────────────────
  const ownerFk = await one(
    `SELECT constraint_name AS cn FROM information_schema.key_column_usage
     WHERE table_schema = ? AND table_name = 'restaurants'
       AND column_name = 'owner_id' AND referenced_table_name = 'users' LIMIT 1`,
    [DB_NAME]
  );
  if (ownerFk && ownerFk.cn) {
    await conn.query(`ALTER TABLE restaurants DROP FOREIGN KEY \`${ownerFk.cn}\``);
    log(true, `Dropped FK \`${ownerFk.cn}\` on owner_id`);
  } else {
    log(true, 'No FK on owner_id to drop');
  }

  // ─── 2. Drop UNIQUE owner_id ─────────────────────────────
  const uniqueOwner = await one(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'restaurants'
       AND index_name = 'owner_id' AND non_unique = 0`,
    [DB_NAME]
  );
  if (Number(uniqueOwner.c) > 0) {
    await conn.query('ALTER TABLE restaurants DROP INDEX owner_id');
    log(true, 'Dropped UNIQUE index `owner_id`');
  } else {
    log(true, 'owner_id is already not unique');
  }

  // ─── 3. Add plain non-unique index ───────────────────────
  const plain = await one(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'restaurants' AND index_name = 'idx_restaurants_owner'`,
    [DB_NAME]
  );
  if (Number(plain.c) === 0) {
    await conn.query('ALTER TABLE restaurants ADD INDEX idx_restaurants_owner (owner_id)');
    log(true, 'Added plain index `idx_restaurants_owner` on owner_id');
  } else {
    log(true, 'idx_restaurants_owner already exists');
  }

  // ─── 4. Re-create FK ─────────────────────────────────────
  const reFk = await one(
    `SELECT COUNT(*) AS c FROM information_schema.table_constraints
     WHERE constraint_schema = ? AND table_name = 'restaurants'
       AND constraint_name = 'fk_restaurants_owner' AND constraint_type = 'FOREIGN KEY'`,
    [DB_NAME]
  );
  if (Number(reFk.c) === 0) {
    await conn.query(
      'ALTER TABLE restaurants ADD CONSTRAINT fk_restaurants_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE'
    );
    log(true, 'Re-created FK fk_restaurants_owner (owner_id -> users.id)');
  } else {
    log(true, 'fk_restaurants_owner already exists');
  }

  // ─── 5. Create menus table ───────────────────────────────
  await conn.query(`CREATE TABLE IF NOT EXISTS menus (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    name          VARCHAR(255) NOT NULL,
    sort_order    INT NOT NULL DEFAULT 0,
    status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  log(true, 'Created/verified `menus` table');

  // ─── 6. Add menu_id to categories & foods ────────────────
  for (const tbl of ['categories', 'foods']) {
    const hasCol = await one(
      `SELECT COUNT(*) AS c FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND column_name = 'menu_id'`,
      [DB_NAME, tbl]
    );
    if (Number(hasCol.c) === 0) {
      await conn.query(`ALTER TABLE ${tbl} ADD COLUMN menu_id INT DEFAULT NULL AFTER restaurant_id`);
      log(true, `Added menu_id column to ${tbl}`);
    } else {
      log(true, `${tbl}.menu_id already exists`);
    }
    const hasFk = await one(
      `SELECT COUNT(*) AS c FROM information_schema.table_constraints
       WHERE constraint_schema = ? AND table_name = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY'`,
      [DB_NAME, tbl, `fk_${tbl}_menu`]
    );
    if (Number(hasFk.c) === 0) {
      await conn.query(`ALTER TABLE ${tbl} ADD CONSTRAINT fk_${tbl}_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE`);
      log(true, `Added FK fk_${tbl}_menu`);
    } else {
      log(true, `fk_${tbl}_menu already exists`);
    }
  }

  // ─── 7. Backfill default menus ───────────────────────────
  const backfilled = await q(
    `INSERT INTO menus (restaurant_id, name, sort_order)
     SELECT r.id, 'Default Menu', 0 FROM restaurants r
     WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.restaurant_id = r.id)`
  );
  const affected = Array.isArray(backfilled) ? backfilled.affectedRows : (backfilled && backfilled.affectedRows);
  if (affected > 0) {
    log(true, `Backfilled ${affected} default menu(s)`);
  } else {
    log(true, 'All restaurants already have a menu');
  }
  await conn.query(
    `UPDATE categories c JOIN menus m ON m.restaurant_id = c.restaurant_id
     SET c.menu_id = m.id WHERE c.menu_id IS NULL`
  );
  await conn.query(
    `UPDATE foods f JOIN menus m ON m.restaurant_id = f.restaurant_id
     SET f.menu_id = m.id WHERE f.menu_id IS NULL`
  );
  log(true, 'Linked existing categories & foods to their default menu');

  // ─── 8. VERIFY ───────────────────────────────────────────
  console.log('\n──── 8. Verify ────');
  const afterIdx = await q(
    `SELECT index_name AS idx, non_unique AS uniq
     FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'restaurants' GROUP BY index_name, non_unique`,
    [DB_NAME]
  );
  console.log('   Indexes now:');
  for (const i of afterIdx) console.log(`     - ${i.idx} (unique=${i.uniq === 0})`);
  const menus = await q('SELECT id, restaurant_id, name FROM menus ORDER BY restaurant_id');
  console.log(`   Menus: ${menus.length}`);
  for (const m of menus) console.log(`     - #${m.id} restaurant ${m.restaurant_id}: ${m.name}`);
  const orphans = await one('SELECT COUNT(*) AS c FROM categories WHERE menu_id IS NULL');
  log(orphans.c === 0, `Categories without menu: ${orphans.c}`);
}

main().catch((e) => {
  console.error('\n❌ FAILED:', e.message);
  console.error('   Permission/SSL error? DB user may need ALTER/CREATE privileges.');
  console.error('   Full:', e);
  process.exit(1);
});

