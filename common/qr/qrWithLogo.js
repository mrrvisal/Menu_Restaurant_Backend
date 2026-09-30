// QR helper — generates a QR code with an optional restaurant logo + table text.
// Logo is fetched dynamically from the given URL each time so it is always fresh.
const QRCode = require("qrcode");
const sharp = require("sharp");
const crypto = require("crypto");

const QR_SECRET =
  process.env.QR_SECRET || "fallback-qr-secret-change-in-production";

function encryptRestaurantId(restaurantId) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(QR_SECRET.padEnd(32).slice(0, 32));
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(restaurantId), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptRestaurantId(token) {
  try {
    const [ivBase64, encryptedBase64] = token.split(".");
    const iv = Buffer.from(ivBase64, "base64url");
    const encrypted = Buffer.from(encryptedBase64, "base64url");
    const key = Buffer.from(QR_SECRET.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const result = parseInt(decrypted.toString("utf8"), 10);
    return isNaN(result) ? null : result;
  } catch { 
    return null;
  }
}

// Safe composite: degrades gracefully without throwing
function safeComposite(base, overlay, opts = {}) {
  return sharp(base)
    .composite([{ ...opts, input: overlay }])
    .png()
    .toBuffer()
    .catch(() => null);
}

// Fetch logo image and render with rounded white background
async function prepareLogoBuffer(url, size, radius) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  const maskSvg = Buffer.from(
    `<svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white" />
    </svg>`,
  );

  return sharp(buffer, { failOn: "none" })
    .resize(size, size, {
      fit: "fill",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .composite([{ input: maskSvg, blend: "dest-over" }])
    .png()
    .toBuffer();
}

async function generateQrWithLogo(data, opts = {}) {
  const {
    width = 500,
    margin = 2,
    logoUrl = null,
    darkColor = "#2d5a27",
    lightColor = "#f5f0e8",
    tableText = "",
  } = opts;

  const qrBuffer = await QRCode.toBuffer(data, {
    width,
    margin,
    color: { dark: darkColor, light: lightColor },
    errorCorrectionLevel: "H",
  });

  const logoSize = Math.round(width * 0.22);
  const cornerRadius = Math.round(logoSize * 0.15);
  let finalBuffer = qrBuffer;

  const defaultLogoUrl =
    "https://res.cloudinary.com/daji2ml3y/image/upload/v1783262055/ChatGPT_Image_Jul_5_2026_09_32_32_PM_c6ziic.png";
  const targetLogoUrl =
    typeof logoUrl === "string" && logoUrl.trim()
      ? logoUrl.trim()
      : defaultLogoUrl;

  try {
    const logoRounded = await prepareLogoBuffer(
      targetLogoUrl,
      logoSize,
      cornerRadius,
    );
    const out = await safeComposite(qrBuffer, logoRounded, {
      top: Math.round((width - logoSize) / 2),
      left: Math.round((width - logoSize) / 2),
    });
    if (out) finalBuffer = out;
  } catch (err) {
    console.error("[qrWithLogo] Primary logo error:", err.message);

    if (targetLogoUrl !== defaultLogoUrl) {
      try {
        const fallbackRounded = await prepareLogoBuffer(
          defaultLogoUrl,
          logoSize,
          cornerRadius,
        );
        const out = await safeComposite(qrBuffer, fallbackRounded, {
          top: Math.round((width - logoSize) / 2),
          left: Math.round((width - logoSize) / 2),
        });
        if (out) finalBuffer = out;
      } catch (fallbackErr) {
        console.error(
          "[qrWithLogo] Fallback logo error:",
          fallbackErr.message,
        );
      }
    }
  }

  // Table text footer
  if (tableText) {
    try {
      const textHeight = Math.round(width * 0.12);
      const fontSize = Math.round(textHeight * 0.55);

      const safeText = String(tableText)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

      const svgText = `
        <svg width="${width}" height="${textHeight}">
          <rect x="0" y="0" width="${width}" height="${textHeight}" fill="${lightColor}" />
          <text x="50%" y="55%" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="${darkColor}" text-anchor="middle">
            ${safeText}
          </text>
        </svg>
      `;

      const extended = await sharp(finalBuffer)
        .extend({ bottom: textHeight })
        .png()
        .toBuffer();

      const out = await safeComposite(extended, Buffer.from(svgText), {
        top: width,
        left: 0,
      });

      if (out) finalBuffer = out;
    } catch (textErr) {
      console.error("[qrWithLogo] Text composite error:", textErr.message);
    }
  }

  return finalBuffer;
}

module.exports = {
  generateQrWithLogo,
  encryptRestaurantId,
  decryptRestaurantId,
};