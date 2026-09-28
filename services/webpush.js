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

// Send push notification to all subscriptions of a specific user
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

// Send push notification to the owner of a restaurant (new order alerts)
async function sendToRestaurantOwner(restaurantId, payload) {
  if (!configured || !restaurantId) return;
  const [rows] = await db.query(
    "SELECT owner_id FROM restaurants WHERE id = ? LIMIT 1",
    [restaurantId],
  );
  if (!rows.length) return;
  await sendToUser(rows[0].owner_id, payload);
}

// Send to one subscription and delete if dead (404/410)
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
      { TTL: 3600 },
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      try {
        await db.query("DELETE FROM push_subscriptions WHERE id = ?", [row.id]);
      } catch (delErr) {
        console.error("Push subscription cleanup error:", delErr.message);
      }
    } else {
      console.error("Push send error:", err.statusCode || "", err.message);
    }
  }
}

module.exports = { isConfigured, sendToUser, sendToRestaurantOwner };

