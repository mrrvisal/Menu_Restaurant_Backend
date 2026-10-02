// Table calls — the customer-side "call the owner" feature on the public
// menu. A guest at a table sends ONE of two requests with just their table
// number:
//   • type = "bill"  → "come and give me the bill" (សុំគិតលុយ)
//   • type = "extra" → "I need something extra"   (សុំអ្វីបន្ថែម), with an
//                      optional free-text message (e.g. "more ice")
// The owner is alerted through the same three channels as a new order:
// SSE → dashboard, Web Push → their devices, Telegram → linked chat.
const db = require("../../config/db");
const { broadcast } = require("../../common/realtime/sse");
const webpushSvc = require("../notifications/webpush.service");
const { sendTableCallNotification } = require("../telegram/telegramBot.service");
const { logActivity } = require("../../common/audit/audit");

const CALL_TYPES = ["bill", "extra"];
const MAX_MESSAGE_LEN = 255;
const CALL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
// Cooldown so a guest cannot spam the owner by tapping the button repeatedly.
const COOLDOWN_MS = 30 * 1000;
const recentCalls = new Map(); // `${restaurantId}:${tableNo}:${type}` -> ts

async function deleteExpiredCalls() {
  await db.query(
    "DELETE FROM table_calls WHERE created_at < NOW() - INTERVAL 1 DAY",
  );
}

async function cleanupExpiredCalls() {
  try {
    await deleteExpiredCalls();
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") {
      console.warn("table_calls missing — run migration_v21_table_calls.sql");
    } else {
      console.error("Failed to clean up expired table calls:", err);
    }
  }
}

// Purge on startup and hourly; list requests also purge before returning data.
cleanupExpiredCalls();
setInterval(cleanupExpiredCalls, CALL_CLEANUP_INTERVAL_MS).unref();

// Expire cooldown entries so the map never grows unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentCalls) {
    if (now - ts > COOLDOWN_MS) recentCalls.delete(key);
  }
}, 60 * 1000).unref();

// POST /api/calls - guest calls the owner (public)
exports.create = async (req, res) => {
  const { table_no, type, message, restaurant_id } = req.body;

  if (!table_no || !String(table_no).trim()) {
    return res.status(400).json({ error: "Table number is required" });
  }
  if (!CALL_TYPES.includes(type)) {
    return res
      .status(400)
      .json({ error: "Call type must be 'bill' or 'extra'" });
  }
  const text = message ? String(message).trim().slice(0, MAX_MESSAGE_LEN) : "";

  // Same legacy fallback as orders: a menu opened without a restaurant
  // token belongs to the seeded restaurant.
  const restId = restaurant_id ? parseInt(restaurant_id, 10) : 1;
  const tableNo = String(table_no).trim().slice(0, 50);

  const cooldownKey = `${restId}:${tableNo}:${type}`;
  const last = recentCalls.get(cooldownKey) || 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return res.status(429).json({
      error: "Please wait a moment before calling again",
      code: "call_cooldown",
    });
  }

  try {
    const [restaurants] = await db.query(
      "SELECT id, name, telegram_chat_id, default_language FROM restaurants WHERE id = ?",
      [restId],
    );
    if (!restaurants.length) {
      return res.status(404).json({ error: "Restaurant not found" });
    }
    const restaurant = restaurants[0];
    const isKhmer = restaurant.default_language === "km";


    let callId = null;
    try {
      const [result] = await db.query(
        "INSERT INTO table_calls (restaurant_id, table_no, type, message) VALUES (?, ?, ?, ?)",
        [restId, tableNo, type, text || null],
      );
      callId = result.insertId;
    } catch (insertErr) {
      if (insertErr.code !== "ER_NO_SUCH_TABLE") throw insertErr;
      // Table not migrated yet — still alert the owner, just without history.
      console.warn("table_calls missing — run migration_v21_table_calls.sql");
    }
    recentCalls.set(cooldownKey, Date.now());

    const payload = {
      callId,
      restaurantId: restId,
      restaurantName: restaurant.name || null,
      tableNo,
      type,
      message: text || null,
      isKhmer,
      createdAt: new Date(),
    };

    // 🔔 Real-time SSE broadcast for the dashboard (guarded — an alert
    // failure must never fail the guest's request).
    try {
      broadcast(restId, "table-call", payload);
    } catch (sseErr) {
      console.error("SSE broadcast error:", sseErr?.message || sseErr);
    }

    // 📲 Web Push to the owner's devices. Fire-and-forget.
    const pushTitle = isKhmer
      ? `🔔 ${restaurant.name || "Digital Menu"} — ${type === "bill" ? "សុំគិតលុយ" : "សុំអ្វីបន្ថែម"}`
      : `🔔 ${restaurant.name || "Digital Menu"} — ${type === "bill" ? "Bill requested" : "Needs something extra"}`;
    const pushBody = isKhmer
      ? `តុលេខ ${tableNo}${text ? ` · ${text}` : ""}`
      : `Table ${tableNo}${text ? ` · ${text}` : ""}`;
    webpushSvc
      .sendToRestaurantOwner(restId, {
        title: pushTitle,
        body: pushBody,
        tag: `call-${restId}-${tableNo}-${type}`,
        url: "/dashboard",
      })
      .catch((err) => console.error("Web push error:", err.message));

    // 💬 Telegram message to the linked shop chat (guarded).
    if (restaurant.telegram_chat_id) {
      try {
        await sendTableCallNotification(restaurant.telegram_chat_id, payload);
      } catch (tgErr) {
        console.error("Telegram notify error:", tgErr?.message || tgErr);
      }
    }

    res.status(200).json({
      success: true,
      callId,
      message: isKhmer
        ? "បានជូនដំណឹងដល់ម្ចាស់ហាង!"
        : "The owner has been notified!",
    });
  } catch (error) {
    console.error("Table call error:", error);
    res.status(500).json({ error: "Failed to call the owner" });
  }
};

// Resolve which restaurant's calls the caller may see: the requested one
// when the account owns it, otherwise the account's FIRST restaurant —
// the exact same rule as GET /api/orders.
async function resolveOwnedRestaurant(req, res) {
  const requested = parseInt(req.query.restaurant_id || 0);
  if (!requested) {
    const [first] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
      [req.user.id],
    );
    if (!first.length) {
      res.status(404).json({ error: "Restaurant not found" });
      return null;
    }
    return first[0].id;
  }
  const [owned] = await db.query(
    "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
    [requested, req.user.id],
  );
  if (!owned.length) {
    res.status(404).json({ error: "Restaurant not found or not owned by you" });
    return null;
  }
  return requested;
}

// GET /api/calls - recent table calls for the owner's restaurant
exports.getAll = async (req, res) => {
  try {
    const restaurantId = await resolveOwnedRestaurant(req, res);
    if (!restaurantId) return; // reply already sent

    // Never return expired requests, even if the hourly cleanup has not run yet.
    await deleteExpiredCalls();

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    // `status` is validated against a whitelist above, so it is safe to
    // interpolate (mysql2 does not allow placeholders in column clauses).
    const statusFilter = ["pending", "handled"].includes(req.query.status)
      ? ` AND status = '${req.query.status}'`
      : "";

    const [rows] = await db.query(
      `SELECT * FROM table_calls WHERE restaurant_id = ?${statusFilter}
       ORDER BY created_at DESC LIMIT ${limit}`,
      [restaurantId],
    );
    res.json(rows);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); // not migrated yet
    console.error("Get table calls error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// PATCH /api/calls/:id/status - mark a call pending/handled
exports.updateStatus = async (req, res) => {
  const { status } = req.body;
  if (!["pending", "handled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    let rows;
    // Owners may only touch their own restaurant's calls; super admins any.
    if (req.user.role !== "super_admin") {
      [rows] = await db.query(
        `SELECT c.id, c.table_no, c.restaurant_id FROM table_calls c
         JOIN restaurants r ON r.id = c.restaurant_id
         WHERE c.id = ? AND r.owner_id = ?`,
        [req.params.id, req.user.id],
      );
    } else {
      [rows] = await db.query(
        "SELECT id, table_no, restaurant_id FROM table_calls WHERE id = ?",
        [req.params.id],
      );
    }
    if (!rows.length) {
      return res.status(404).json({ error: "Call not found" });
    }

    await db.query(
      "UPDATE table_calls SET status = ?, handled_at = IF(? = 'handled', NOW(), NULL) WHERE id = ?",
      [status, status, req.params.id],
    );

    logActivity({
      userId: req.user.id,
      action: "table_call_status",
      description: `Table call #${req.params.id} (table ${rows[0].table_no}) → ${status}`,
      ipAddress: req.ip,
      restaurantId: rows[0].restaurant_id,
    });

    res.json({ success: true, id: parseInt(req.params.id), status });
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") {
      return res.status(404).json({ error: "Call not found" });
    }
    console.error("Table call status error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
