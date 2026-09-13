// backend/helpers/audit.js
// Fire-and-forget activity logging for the Super Admin "Access" panel.
// Never throws / never blocks the request — best-effort only.
const db = require("../config/db");

async function logActivity({ userId, action, description, ipAddress, restaurantId }) {
  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, restaurant_id, action, description, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [userId || null, restaurantId || null, action, description || null, ipAddress || null],
    );
  } catch (e) {
    if (e.code !== "ER_NO_SUCH_TABLE") {
      console.error("Audit log insert failed:", e.message);
    }
  }
}

module.exports = { logActivity };