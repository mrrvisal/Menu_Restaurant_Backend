// backend/services/webpush.js
// Web Push (VAPID) sender — pushes "New order" alerts to the restaurant
// owner's subscribed browsers/devices (works even when the dashboard tab
// is closed). Subscriptions live in the `push_subscriptions` table and are
// pruned automatically when the push service reports them as gone (404/410).
const webpush = require("web-push");
const db = require("../config/db");

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@example.com";

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (err) {
    console.error("Web Push configuration error:", err.message);
  }
}

function isConfigured() {
  return configured;
}

/**
 * Send a push notification to every device subscribed by a user.
 * @param {number} userId
 * @param {{title?:string, body?:string, tag?:string, url?:string, icon?:string}} payload
 */
async function sendToUser(userId, payload) {
  if (!configured || !userId) return;
  const [rows] = await db.query(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    [userId],
  );
  for (const row of rows) {
    await sendToSubscription(row, payload);
  }
}

/**
 * Send a push to the owner of a restaurant (used for new-order alerts).
 * @param {number} restaurantId
 * @param {object} payload
 */
async function sendToRestaurantOwner(restaurantId, payload) {
  if (!configured || !restaurantId) return;
  const [rows] = await db.query(
    "SELECT owner_id FROM restaurants WHERE id = ? LIMIT 1",
    [restaurantId],
  );
  if (!rows.length) return;
  await sendToUser(rows[0].owner_id, payload);
}

/** Send to one subscription row; drop it if the endpoint is gone (404/410). */
async function sendToSubscription(row, payload) {
  const body = JSON.stringify({
    title: payload.title || "Digital Menu",
    body: payload.body || "",
    tag: payload.tag,
    url: payload.url || "/dashboard",
    icon: payload.icon,
  });
  try {
    await webpush.sendNotification(
      {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      body,
      { TTL: 3600 }, // keep the alert for an hour if the device is offline
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Subscription expired / browser uninstalled — remove it.
      try {
        await db.query("DELETE FROM push_subscriptions WHERE id = ?", [row.id]);
      } catch (delErr) {
        console.error("Push subscription cleanup error:", delErr.message);
      }
    } else {
      console.error(
        "Push send error:",
        err.statusCode || "",
        err.message,
      );
    }
  }
}

module.exports = { isConfigured, sendToUser, sendToRestaurantOwner };
