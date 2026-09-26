// backend/helpers/shareCard.js
// ─── SHARE CARD (per-restaurant link preview) ──────────────────────────────
// Facebook, Messenger, Telegram, WhatsApp, LinkedIn, X, Instagram and WeChat
// do NOT run JavaScript: they fetch the first HTML response of a shared URL.
// That means an SPA route like /menu?restaurant_id=3 always previews the same
// generic index.html card — the restaurant name, logo and table were lost.
//
// This helper renders a tiny, cacheable HTML document that carries the FULL
// Open Graph / Twitter / WeChat metadata for ONE restaurant and then bounces
// real visitors (JS + a visible link) to the SPA menu page.
//
// Everything here is pure (no database, no express) so it can be unit-tested.

const DEFAULT_LOGO =
  "https://res.cloudinary.com/daji2ml3y/image/upload/v1783262055/ChatGPT_Image_Jul_5_2026_09_32_32_PM_c6ziic.png";

const DEFAULT_SITE_NAME = "Digital Menu";
const DEFAULT_ACCENT = "#166534";

// ─── SMALL UTILITIES ───────────────────────────────────────────────────────

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value, max = 300) {
  const str = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

// "https://x.com/y/z" → "https://x.com"  (null when not a web URL)
function normalizeOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isWebUrl(value) {
  return !!normalizeOrigin(value);
}

// "…/logo.jpeg" → "image/jpeg" (null when the type cannot be told)
function imageMimeType(url) {
  if (!isWebUrl(url)) return null;
  const path = String(url).split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return null;
}

// "#16a34a" / "16a34a" → "#16a34a" ; anything else → fallback
function sanitizeHexColor(value, fallback = DEFAULT_ACCENT) {
  const raw = String(value || "").trim();
  const hex = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : fallback;
}

// ─── ALLOWED BOUNCE TARGETS (keeps /s/menu from being an open redirect) ────

function allowedOrigins(req) {
  const list = [];
  const push = (value) => {
    const origin = normalizeOrigin(value);
    if (origin && !list.includes(origin)) list.push(origin);
  };
  String(process.env.FRONTEND_URL || "")
    .split(",")
    .forEach(push);
  String(process.env.SHARE_ALLOWED_ORIGINS || "")
    .split(",")
    .forEach(push);
  if (req) {
    push(`${req.protocol}://${req.get("host")}`);
    push(req.get("origin"));
  }
  return list;
}

// Which origin should the card bounce to?
//  1. the origin the sharer asked for (`to=`) — only when it is allow-listed
//  2. FRONTEND_URL (the canonical SPA address)
//  3. the request origin, as a last resort
function resolveTargetOrigin(req, requested) {
  const requestedOrigin = normalizeOrigin(requested);
  const list = allowedOrigins(req);

  if (requestedOrigin && list.includes(requestedOrigin)) return requestedOrigin;

  const frontend = normalizeOrigin(
    String(process.env.FRONTEND_URL || "").split(",")[0],
  );
  if (frontend) return frontend;

  return list[0] || "http://localhost:5173";
}

// ─── URL BUILDERS ──────────────────────────────────────────────────────────

// Build the SPA menu URL that humans end up on.
// Keeps the same query params the QR code / share link used, so the encrypted
// `rid` token (or plain restaurant_id) and the table number survive the trip.
function buildSpaMenuUrl(origin, params = {}) {
  const base = `${String(origin).replace(/\/$/, "")}/menu`;
  const search = new URLSearchParams();
  if (params.rid) search.set("rid", params.rid);
  else if (params.restaurant_id)
    search.set("restaurant_id", params.restaurant_id);
  if (params.table) search.set("table", params.table);
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

// Public address of the share-card route for a restaurant (the URL that gets
// pasted into chats — crawlers read the card, humans bounce to the SPA).
function buildCardUrl(origin, params = {}) {
  const base = `${String(origin).replace(/\/$/, "")}/s/menu`;
  const search = new URLSearchParams();
  if (params.rid) search.set("rid", params.rid);
  else if (params.restaurant_id)
    search.set("restaurant_id", params.restaurant_id);
  if (params.table) search.set("table", params.table);
  if (params.to) search.set("to", params.to);
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

// ─── TEXT ──────────────────────────────────────────────────────────────────

// Bilingual (Khmer first, English after) so the preview reads well for every
// customer, whichever chat app renders it.
function buildCardTitle(restaurantName, tableNo) {
  const name = restaurantName || DEFAULT_SITE_NAME;
  const table = tableNo ? ` — តុ ${tableNo} / Table ${tableNo}` : "";
  return `${name} — មីនុយ / Menu${table}`;
}

function buildCardDescription(restaurantName, tableNo) {
  const name = restaurantName || DEFAULT_SITE_NAME;
  const km = tableNo
    ? `តុលេខ ${tableNo} · ស្កេន QR ដើម្បីមើលមីនុយ ${name} និងកម្មង់ភ្លាមៗ`
    : `ស្កេន QR ដើម្បីមើលមីនុយ ${name} និងកម្មង់ភ្លាមៗ`;
  const en = tableNo
    ? `Table ${tableNo} · Scan the QR code to browse ${name} and order straight from your table.`
    : `Scan the QR code to browse ${name} and order straight from your table.`;
  return truncate(`${km} · ${en}`);
}

// ─── HTML ──────────────────────────────────────────────────────────────────

function metaTag(attr, key, content) {
  return `    <meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
}

/**
 * Renders the share-card document.
 *
 * @param {object} opts
 * @param {string} opts.spaUrl      final menu URL (humans land here)
 * @param {string} opts.cardUrl     this card's own URL (og:url + canonical)
 * @param {string} opts.title       og:title
 * @param {string} opts.description og:description
 * @param {string} opts.image       og:image (absolute https URL)
 * @param {string} [opts.accent]    restaurant theme color
 * @param {string} [opts.siteName]
 * @param {string} [opts.logoUrl]   logo shown on the bounce page
 * @returns {string} full HTML document
 */
function buildShareCardHtml(opts = {}) {
  const {
    spaUrl,
    cardUrl,
    title,
    description,
    image,
    accent,
    siteName = DEFAULT_SITE_NAME,
    logoUrl,
  } = opts;

  const safeTitle = truncate(title, 120);
  const safeDescription = truncate(description, 300);
  const safeImage = isWebUrl(image) ? image : DEFAULT_LOGO;
  const safeLogo = isWebUrl(logoUrl) ? logoUrl : safeImage;
  const color = sanitizeHexColor(accent);
  const finalUrl = isWebUrl(spaUrl) ? spaUrl : "/menu";
  const canonical = isWebUrl(cardUrl) ? cardUrl : finalUrl;
  // JSON.stringify keeps the JS string safe; escaping "</" stops the URL from
  // breaking out of the <script> block.
  const jsUrl = JSON.stringify(finalUrl).replace(/<\//g, "<\\/");
  const htmlUrl = escapeHtml(finalUrl);

  const meta = [
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:site_name", siteName),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:title", safeTitle),
    metaTag("property", "og:description", safeDescription),
    metaTag("property", "og:locale", "km_KH"),
    metaTag("property", "og:locale:alternate", "en_US"),
    metaTag("property", "og:image", safeImage),
    metaTag("property", "og:image:url", safeImage),
    metaTag("property", "og:image:secure_url", safeImage),
    metaTag("property", "og:image:alt", safeTitle),
    metaTag("property", "og:image:width", "600"),
    metaTag("property", "og:image:height", "600"),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", safeTitle),
    metaTag("name", "twitter:description", safeDescription),
    metaTag("name", "twitter:image", safeImage),
    metaTag("name", "twitter:image:alt", safeTitle),
    metaTag("itemprop", "name", safeTitle),
    metaTag("itemprop", "description", safeDescription),
    metaTag("itemprop", "image", safeImage),
  ];
  const mime = imageMimeType(safeImage);
  if (mime) meta.push(metaTag("property", "og:image:type", mime));

  const page = `<!DOCTYPE html>
<html lang="km">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(safeTitle)}</title>
    <meta name="description" content="${escapeHtml(safeDescription)}" />
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="icon" href="${escapeHtml(safeLogo)}" />

    <!-- ─── Open Graph · Facebook, Messenger, WhatsApp, Instagram, WeChat, Viber, Telegram ─── -->
${meta.join("\n")}

    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: flex; align-items: center;
        justify-content: center; padding: 24px; background: ${color}; color: #fff;
        font-family: "Hanuman", "Kantumruy Pro", system-ui, -apple-system,
          "Segoe UI", Roboto, sans-serif;
      }
      .card { text-align: center; max-width: 380px; }
      .logo {
        width: 96px; height: 96px; border-radius: 22px; object-fit: cover;
        border: 3px solid rgba(255, 255, 255, 0.4);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
        background: rgba(255, 255, 255, 0.12);
      }
      h1 { font-size: 21px; margin: 18px 0 6px; }
      p { margin: 0 0 20px; font-size: 14px; opacity: 0.88; line-height: 1.6; }
      .bar {
        height: 4px; border-radius: 99px; overflow: hidden;
        background: rgba(255, 255, 255, 0.28);
      }
      .bar i {
        display: block; height: 100%; width: 40%; border-radius: 99px;
        background: #fff; animation: slide 1s ease-in-out infinite;
      }
      @keyframes slide {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(260%); }
      }
      .link {
        display: inline-block; margin-top: 22px; padding: 12px 22px;
        border-radius: 999px; background: #fff; color: ${color};
        font-weight: 700; font-size: 14px; text-decoration: none;
      }
      @media (prefers-reduced-motion: reduce) { .bar i { animation: none; } }
    </style>
  </head>
  <body>
    <div class="card">
      <img class="logo" src="${escapeHtml(safeLogo)}" alt="${escapeHtml(siteName)}" />
      <h1>${escapeHtml(safeTitle)}</h1>
      <p>កំពុងបើកមីនុយ… · Opening the menu…</p>
      <div class="bar"><i></i></div>
      <a class="link" href="${htmlUrl}">បើកមីនុយ / Open menu</a>
    </div>
    <script>
      // Non-JS crawlers stop here and read the Open Graph tags above, while
      // real visitors jump straight to the SPA menu (no meta-refresh: some
      // crawlers follow it and would lose the tags above).
      window.location.replace(${jsUrl});
    </script>
  </body>
</html>
`;

  return page;
}

module.exports = {
  DEFAULT_LOGO,
  DEFAULT_SITE_NAME,
  DEFAULT_ACCENT,
  escapeHtml,
  truncate,
  normalizeOrigin,
  isWebUrl,
  imageMimeType,
  sanitizeHexColor,
  allowedOrigins,
  resolveTargetOrigin,
  buildSpaMenuUrl,
  buildCardUrl,
  buildCardTitle,
  buildCardDescription,
  buildShareCardHtml,
};

