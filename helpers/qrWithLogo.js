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

// Safe composite: never throws on overlay/background problems — degrades gracefully.
function safeComposite(base, overlay, opts = {}) {
  return new Promise((resolve) => {
    sharp(base)
      .composite([{ ...opts, input: overlay }])
      .png()
      .toBuffer()
      .then(resolve)
      .catch(() => resolve(null));
  });
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
    color: {
      dark: darkColor,
      light: lightColor,
    },
    errorCorrectionLevel: "H",
  });

  const logoSize = Math.round(width * 0.22);
  const cornerRadius = Math.round(logoSize * 0.15);

  let finalBuffer = qrBuffer;

  // ─── Dynamic restaurant logo / default logo ───────────────
  const defaultLogoUrl =
    "https://res.cloudinary.com/daji2ml3y/image/upload/v1783262055/ChatGPT_Image_Jul_5_2026_09_32_32_PM_c6ziic.png";

  // If logoUrl is null, undefined, or empty,
  // use the default logo
  const finalLogoUrl =
    typeof logoUrl === "string" && logoUrl.trim()
      ? logoUrl.trim()
      : defaultLogoUrl;

  try {
    console.log("[qrWithLogo] Using logo:", finalLogoUrl);

    const logoResp = await fetch(finalLogoUrl);

    if (!logoResp.ok) {
      throw new Error(`HTTP ${logoResp.status}`);
    }

    const logoBuffer = Buffer.from(await logoResp.arrayBuffer());

    const logoRounded = await sharp(logoBuffer, {
      failOn: "none",
    })
      .resize(logoSize, logoSize, {
        fit: "fill",
        background: {
          r: 0,
          g: 0,
          b: 0,
          alpha: 0,
        },
      })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${logoSize}" height="${logoSize}">
              <rect
                x="0"
                y="0"
                width="${logoSize}"
                height="${logoSize}"
                rx="${cornerRadius}"
                ry="${cornerRadius}"
                fill="white"
              />
            </svg>`,
          ),
          blend: "dest-over",
        },
      ])
      .png()
      .toBuffer();

    const out = await safeComposite(qrBuffer, logoRounded, {
      top: Math.round((width - logoSize) / 2),
      left: Math.round((width - logoSize) / 2),
    });

    if (out) {
      finalBuffer = out;
    } else {
      console.error("[qrWithLogo] logo composite skipped");
    }
  } catch (logoErr) {
    console.error(
      "[qrWithLogo] logo error:",
      logoErr.message,
      "logoUrl:",
      logoUrl,
    );

    // If restaurant logo fails, try default logo
    if (finalLogoUrl !== defaultLogoUrl) {
      try {
        const defaultResp = await fetch(defaultLogoUrl);

        if (!defaultResp.ok) {
          throw new Error(`HTTP ${defaultResp.status}`);
        }

        const defaultBuffer = Buffer.from(await defaultResp.arrayBuffer());

        const defaultRounded = await sharp(defaultBuffer, {
          failOn: "none",
        })
          .resize(logoSize, logoSize, {
            fit: "fill",
            background: {
              r: 0,
              g: 0,
              b: 0,
              alpha: 0,
            },
          })
          .png()
          .toBuffer();

        const out = await safeComposite(qrBuffer, defaultRounded, {
          top: Math.round((width - logoSize) / 2),
          left: Math.round((width - logoSize) / 2),
        });

        if (out) {
          finalBuffer = out;
        }
      } catch (defaultErr) {
        console.error("[qrWithLogo] default logo error:", defaultErr.message);

        // QR without logo
        finalBuffer = qrBuffer;
      }
    }
  }

  // ─── Table text footer ────────────────────────────────────
  if (tableText) {
    try {
      const textHeight = Math.round(width * 0.12);
      const fontSize = Math.round(textHeight * 0.55);

      const safeText = String(tableText)
        .replace(/&/g, String.fromCharCode(38))
        .replace(/</g, String.fromCharCode(60))
        .replace(/>/g, String.fromCharCode(62))
        .replace(/"/g, String.fromCharCode(34))
        .replace(/'/g, String.fromCharCode(39));

      const svgText = `
        <svg width="${width}" height="${textHeight}">
          <rect
            x="0"
            y="0"
            width="${width}"
            height="${textHeight}"
            fill="${lightColor}"
          />

          <text
            x="50%"
            y="55%"
            font-family="sans-serif"
            font-size="${fontSize}"
            font-weight="bold"
            fill="${darkColor}"
            text-anchor="middle"
          >
            ${safeText}
          </text>
        </svg>
      `;

      const extended = await sharp(finalBuffer)
        .extend({
          bottom: textHeight,
        })
        .png()
        .toBuffer();

      const out = await safeComposite(extended, Buffer.from(svgText), {
        top: width,
        left: 0,
      });

      if (out) {
        finalBuffer = out;
      } else {
        console.error("[qrWithLogo] text composite skipped");
      }
    } catch (textErr) {
      console.error("[qrWithLogo] text error:", textErr.message);
    }
  }
  return finalBuffer;
}

module.exports = {
  generateQrWithLogo,
  encryptRestaurantId,
  decryptRestaurantId,
};