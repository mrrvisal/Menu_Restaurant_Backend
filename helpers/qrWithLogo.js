const QRCode = require("qrcode");
const sharp = require("sharp");
const crypto = require("crypto");

const QR_SECRET = process.env.QR_SECRET || "fallback-qr-secret-change-in-production";

/**
 * Generate a QR code PNG buffer with a center logo and natural color palette.
 *
 * @param {string}  data          - The URL or text to encode in the QR
 * @param {object}  [opts]
 * @param {number}  [opts.width=500]
 * @param {number}  [opts.margin=2]
 * @param {string}  [opts.logoUrl] - URL of the logo image to overlay (optional)
 * @param {string}  [opts.darkColor="#2d5a27"] - Dark module colour (earthy green)
 * @param {string}  [opts.lightColor="#f5f0e8"] - Light module colour (warm cream)
 * @returns {Promise<Buffer>} PNG buffer
 */
function encryptRestaurantId(restaurantId) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(QR_SECRET.padEnd(32).slice(0, 32));
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(restaurantId), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptRestaurantId(token) {
  try {
    const [ivBase64, encryptedBase64] = token.split(".");
    const iv = Buffer.from(ivBase64, "base64url");
    const encrypted = Buffer.from(encryptedBase64, "base64url");
    const key = Buffer.from(QR_SECRET.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const result = parseInt(decrypted.toString("utf8"), 10);
    return isNaN(result) ? null : result;
  } catch {
    return null;
  }
}

async function generateQrWithLogo(data, opts = {}) {
  const {
    width = 500,
    margin = 2,
    logoUrl = process.env.LOGO_URL ||
      "https://res.cloudinary.com/daji2ml3y/image/upload/v1777712294/ChatGPT_Image_May_2_2026_03_39_44_PM-Picsart-BackgroundRemover_1_x4yi9t.png",
    darkColor = "#2d5a27",    // natural deep green
    lightColor = "#f5f0e8",   // warm cream
  } = opts;

  // 1. Generate plain QR (with natural colours)
  const qrBuffer = await QRCode.toBuffer(data, {
    width,
    margin,
    color: { dark: darkColor, light: lightColor },
    // errorCorrectionLevel must be high so the logo doesn't break scanning
    errorCorrectionLevel: "H",
  });

  // 2. Resize logo to ~22 % of QR width (good balance)
  const logoSize = Math.round(width * 0.22);
  // Round corners on logo
  const cornerRadius = Math.round(logoSize * 0.15);

  // 3. Fetch & composite logo in the centre
  let logoComposite;

  try {
    const logoResp = await fetch(logoUrl);
    if (!logoResp.ok) throw new Error(`HTTP ${logoResp.status}`);
    const logoBuffer = Buffer.from(await logoResp.arrayBuffer());

    // Resize, add rounded corners & a subtle white border/stroke
    const logoRounded = await sharp(logoBuffer)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .composite([
        {
          // overlay a rounded white rect to act as a soft background behind the logo
          input: Buffer.from(
            `<svg width="${logoSize}" height="${logoSize}">
              <rect
                x="0" y="0"
                width="${logoSize}" height="${logoSize}"
                rx="${cornerRadius}" ry="${cornerRadius}"
                fill="white"
              />
            </svg>`
          ),
          blend: "dest-over",
        },
      ])
      .png()
      .toBuffer();

    logoComposite = { input: logoRounded, top: Math.round((width - logoSize) / 2), left: Math.round((width - logoSize) / 2) };
  } catch {
    // If logo download fails, just return QR without logo
    return qrBuffer;
  }

  // 4. Overlay logo onto QR
  const finalBuffer = await sharp(qrBuffer)
    .composite([logoComposite])
    .png()
    .toBuffer();

  return finalBuffer;
}

module.exports = { generateQrWithLogo, encryptRestaurantId, decryptRestaurantId };
