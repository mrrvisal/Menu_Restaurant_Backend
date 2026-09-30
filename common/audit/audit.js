const db = require("../../config/db");

// Fire-and-forget activity logging (never throws or blocks requests)
async function logActivity({
  userId,
  action,
  description,
  ipAddress,
  restaurantId,
}) {
  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, restaurant_id, action, description, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId || null,
        restaurantId || null,
        action,
        description || null,
        ipAddress || null,
      ],
    );
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE") {
      console.error("Audit log insert failed:", err.message);
    }
  }
}

module.exports = { logActivity };
