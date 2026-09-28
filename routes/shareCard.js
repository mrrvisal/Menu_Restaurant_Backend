// Public share routes (mounted outside /api — see server.js):
//   GET /s/menu   → crawler-friendly Open Graph card that bounces visitors
//                   to the SPA menu page
//   GET /s/qr.png → PNG QR used by the in-app share sheet
// Both are public on purpose — chat apps and crawlers cannot log in.
const express = require("express");
const QRCode = require("qrcode");
const db = require("../config/db");
const { decryptRestaurantId } = require("../helpers/qrWithLogo");
const {
  DEFAULT_LOGO,
  isWebUrl,
  sanitizeHexColor,
  allowedOrigins,
  resolveTargetOrigin,
  buildSpaMenuUrl,
  buildCardTitle,
  buildCardDescription,
  buildShareCardHtml,
} = require("../helpers/shareCard");

const router = express.Router();

// Crawlers cache hard — 5 min keeps the card fresh while saving DB round-trips.
const CARD_CACHE = "public, max-age=300, s-maxage=600";

function digitsOnly(value) {
  const str = String(value || "").trim();
  return /^\d+$/.test(str) ? str : "";
}

// Resolve the restaurant from ?rid=<encrypted token> or ?restaurant_id=<id>.
// Returns null when the link is generic / the restaurant is gone.
async function findRestaurant(query) {
  let id = query.rid ? decryptRestaurantId(String(query.rid)) : null;
  if (!id) id = parseInt(digitsOnly(query.restaurant_id) || "0", 10) || null;
  if (!id) return null;

  const [rows] = await db.query(
    `SELECT id, name, logo_url, theme_color
       FROM restaurants
      WHERE id = ? AND status = 'active'
      LIMIT 1`,
    [id],
  );
  return rows.length ? rows[0] : null;
}

// ─── GET /s/menu — the link that gets pasted into chats ────────────────────
router.get("/menu", async (req, res) => {
  const table = digitsOnly(req.query.table);
  // `to` must be allow-listed (FRONTEND_URL / SHARE_ALLOWED_ORIGINS) so this
  // endpoint cannot become an open redirect.
  const origin = resolveTargetOrigin(req, req.query.to);
  const params = {
    rid: req.query.rid ? String(req.query.rid) : "",
    restaurant_id: digitsOnly(req.query.restaurant_id),
    table,
  };
  const spaUrl = buildSpaMenuUrl(origin, params);

  let restaurant = null;
  try {
    restaurant = await findRestaurant(req.query);
  } catch (err) {
    // DB hiccup: still bounce the visitor with the generic card.
    console.error("[shareCard] restaurant lookup failed:", err.message);
  }

  const html = buildShareCardHtml({
    spaUrl,
    cardUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
    title: buildCardTitle(restaurant?.name, table),
    description: buildCardDescription(restaurant?.name, table),
    image: restaurant?.logo_url || DEFAULT_LOGO,
    logoUrl: restaurant?.logo_url || DEFAULT_LOGO,
    accent: restaurant?.theme_color || undefined,
  });

  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", CARD_CACHE);
  res.set("X-Robots-Tag", "noindex, follow");
  res.status(200).send(html);
});

// ─── GET /s/qr.png — QR of a share/menu URL (WeChat, desktop → phone) ──────
router.get("/qr.png", async (req, res) => {
  const data = String(req.query.data || "");
  if (!isWebUrl(data)) {
    return res
      .status(400)
      .json({ error: "A valid http(s) url is required in ?data=" });
  }

  // Only known origins (the SPA, this API, configured origins) may be encoded,
  // so this cannot be abused as a public QR generator for arbitrary links.
  const origin = new URL(data).origin;
  if (!allowedOrigins(req).includes(origin)) {
    return res.status(403).json({ error: "URL host is not allowed" });
  }

  const size = Math.min(600, Math.max(120, parseInt(req.query.size, 10) || 240));
  const dark = sanitizeHexColor(req.query.color, "#111827");
  const light = sanitizeHexColor(req.query.bg, "#ffffff");

  try {
    const png = await QRCode.toBuffer(data, {
      type: "png",
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark, light },
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400, immutable");
    return res.send(png);
  } catch (err) {
    console.error("[shareCard] QR generation failed:", err.message);
    return res.status(500).json({ error: "Could not build the QR code" });
  }
});

module.exports = router;
