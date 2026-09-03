// backend/routes/index.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();

const {
  auth,
  softAuth,
  requireSuperAdmin,
  requireOwner,
  requireOwnerOrAdmin,
} = require("../middleware/auth");
const authCtrl = require("../controllers/authController");
const foodsCtrl = require("../controllers/foodsController");
const catsCtrl = require("../controllers/categoriesController");
const menusCtrl = require("../controllers/menusController");
const ordersCtrl = require("../controllers/ordersController");
const telegramCtrl = require("../controllers/telegramController");
const { addClient } = require("../services/sse");
const db = require("../config/db");

// ─── FILE UPLOAD CONFIG ────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ok =
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error("Only images allowed"));
  },
});

// ─── PUBLIC ROUTES ─────────────────────────────────────────
// Restaurants list
router.get("/restaurants", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, logo_url, default_language, theme_color FROM restaurants WHERE status = 'active' ORDER BY id ASC",
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/restaurants/:id", ordersCtrl.getRestaurant);

// ─── AUTH ROUTES ───────────────────────────────────────────
router.post("/auth/register", upload.single("logo"), authCtrl.register);
router.post("/auth/login", authCtrl.login);
router.post("/auth/google", authCtrl.googleLogin);
router.get("/auth/verify-email", authCtrl.verifyEmail);
router.post("/auth/resend-verification", authCtrl.resendVerification);
router.post("/auth/forgot-password", authCtrl.forgotPassword);
router.post("/auth/reset-password", authCtrl.resetPassword);
router.get("/auth/me", auth, authCtrl.me);
router.get("/auth/link-code", auth, authCtrl.getLinkCode);
router.patch("/auth/unlink-telegram", auth, authCtrl.unlinkTelegram);
router.patch("/auth/language", auth, authCtrl.updateLanguage);
router.patch("/auth/restaurant", auth, upload.single("logo"), authCtrl.updateRestaurant);

// Owner adds ANOTHER restaurant to their account
router.post("/auth/restaurants", auth, upload.single("logo"), authCtrl.createRestaurant);
router.patch("/auth/theme", auth, authCtrl.updateTheme);
router.patch("/auth/sidebar", auth, authCtrl.updateSidebar);

// ─── MENUS (public read per restaurant, owner/super_admin write) ─
router.get("/menus", softAuth, menusCtrl.getAll);
router.post("/menus", auth, requireOwnerOrAdmin, menusCtrl.create);
router.patch("/menus/:id", auth, requireOwnerOrAdmin, menusCtrl.update);
router.delete("/menus/:id", auth, requireOwnerOrAdmin, menusCtrl.remove);

// ─── TELEGRAM BOT ──────────────────────────────────────────
router.post("/telegram/webhook", telegramCtrl.webhook);
router.get("/telegram/set-webhook", telegramCtrl.setWebhook);
router.get("/telegram/delete-webhook", telegramCtrl.deleteWebhook);

// ─── CATEGORIES (public read with optional auth, owner/super_admin write) ─
router.get("/categories", softAuth, catsCtrl.getAll);
router.post("/categories", auth, requireOwnerOrAdmin, catsCtrl.create);
router.patch("/categories/:id", auth, requireOwnerOrAdmin, catsCtrl.update);
router.delete("/categories/:id", auth, requireOwnerOrAdmin, catsCtrl.remove);

// ─── FOODS (public read with optional auth, owner/super_admin write) ─
router.get("/foods", softAuth, foodsCtrl.getAll);
router.get("/foods/:id", foodsCtrl.getOne);
router.post(
  "/foods",
  auth,
  requireOwnerOrAdmin,
  upload.single("image"),
  foodsCtrl.create,
);
router.patch(
  "/foods/:id",
  auth,
  requireOwnerOrAdmin,
  upload.single("image"),
  foodsCtrl.update,
);
router.patch(
  "/foods/:id/status",
  auth,
  requireOwnerOrAdmin,
  foodsCtrl.toggleStatus,
);
router.delete("/foods/:id", auth, requireOwnerOrAdmin, foodsCtrl.remove);

// ─── ORDERS (public create, owner/super_admin view) ────────
router.post("/orders", ordersCtrl.create);

// ─── ORDER SSE STREAM (real-time new order alerts) ─────────
router.get("/orders/stream", (req, res, next) => {
  // EventSource (native browser API) can't set custom headers,
  // so also accept the JWT token as a query parameter.
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  auth(req, res, () => requireOwnerOrAdmin(req, res, next));
}, (req, res) => {
  // Determine restaurant id from the query param or the owner's first restaurant
  const fetchRestaurant = () => {
    const requested = parseInt(req.query.restaurant_id || 0);
    if (requested) {
      return db
        .query(
          "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
          [requested, req.user.id],
        )
        .then(([rows]) => (rows.length ? [{ id: rows[0].id }] : []));
    }
    return db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
      [req.user.id],
    );
  };

  fetchRestaurant().then(([rows]) => {
    if (!rows.length) {
      return res.status(404).json({ error: "Restaurant not found" });
    }
    const restaurantId = rows[0].id;

    // Headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial heartbeat so client knows the stream is live
    res.write(`event: connected\ndata: {"message":"stream connected"}\n\n`);

    // Periodic keep-alive comment (prevents proxy timeouts)
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 25000);

    // Register this client
    addClient(restaurantId, res);

    // Cleanup interval on close
    res.on("close", () => {
      clearInterval(heartbeat);
    });
  }).catch((err) => {
    console.error("SSE setup error:", err);
    res.status(500).json({ error: "Server error" });
  });
});
router.get("/orders", auth, requireOwnerOrAdmin, ordersCtrl.getAll);
router.get("/orders/stats", auth, requireOwnerOrAdmin, ordersCtrl.stats);
router.patch(
  "/orders/:id/status",
  auth,
  requireOwnerOrAdmin,
  ordersCtrl.updateStatus,
);

// ─── SUPER ADMIN ROUTES ────────────────────────────────────
router.get("/admin/users", auth, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.role, u.status, u.email_verified_at, u.last_login_at, u.created_at,
              r.name AS restaurant_name
       FROM users u
       LEFT JOIN restaurants r ON r.owner_id = u.id
       ORDER BY u.created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    console.error("Admin users fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch(
  "/admin/users/:id/status",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    const { status } = req.body;
    if (!["active", "suspended", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    try {
      await db.query("UPDATE users SET status = ? WHERE id = ?", [
        status,
        req.params.id,
      ]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: Manually verify a user's email
router.post(
  "/admin/users/:id/verify",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        "SELECT id, email, email_verified_at FROM users WHERE id = ?",
        [req.params.id],
      );
      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }
      if (rows[0].email_verified_at) {
        return res.json({ success: true, message: "Email already verified" });
      }
      await db.query(
        "UPDATE users SET email_verified_at = NOW(), email_verify_token = NULL, status = 'active' WHERE id = ?",
        [req.params.id],
      );
      res.json({ success: true, message: "User email verified successfully" });
    } catch (err) {
      console.error("Admin verify user error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: Resend verification email to a user
router.post(
  "/admin/users/:id/resend-verification",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        "SELECT id, email, email_verified_at FROM users WHERE id = ?",
        [req.params.id],
      );
      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }
      const user = rows[0];
      if (user.email_verified_at) {
        return res.json({ success: true, message: "Email already verified" });
      }

      // Generate new verification token
      const crypto = require("crypto");
      const verifyToken = crypto.randomBytes(32).toString("hex");
      await db.query(
        "UPDATE users SET email_verify_token = ? WHERE id = ?",
        [verifyToken, user.id],
      );

      // Send verification email
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
      const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
      const { sendMail } = require("../config/mailer");
      sendMail({
        to: user.email,
        subject: "Verify your email - Digital Menu",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="width: 48px; height: 48px; background: #166534; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
            </div>
            <h2 style="color: #14532d; text-align: center; margin-bottom: 16px;">Email Verification</h2>
            <p style="color: #4a6650; line-height: 1.6; margin-bottom: 20px;">
              Hello${user.full_name ? " " + user.full_name : ""},<br/><br/>
              An administrator has requested you to verify your email address. Please click the button below to verify.
            </p>
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #166534, #22c55e); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
                Verify Email Address
              </a>
            </div>
            <p style="color: #6b7280; font-size: 12px; text-align: center;">
              Or copy this link into your browser:<br/>
              <a href="${verifyUrl}" style="color: #22c55e; word-break: break-all;">${verifyUrl}</a>
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 11px; text-align: center;">
              This link expires when a new verification is requested. If you didn't expect this email, please ignore it.
            </p>
          </div>
        `,
      }).catch(err => console.error("Background email send failed:", err.message));

      res.json({ success: true, message: "Verification email sent" });
    } catch (err) {
      console.error("Admin resend verification error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.get("/admin/restaurants", auth, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.email AS owner_email
       FROM restaurants r
       JOIN users u ON u.id = r.owner_id
       ORDER BY r.created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/stats", auth, requireSuperAdmin, async (req, res) => {
  try {
    const [[{ totalUsers }]] = await db.query(
      "SELECT COUNT(*) AS totalUsers FROM users",
    );
    const [[{ totalRestaurants }]] = await db.query(
      "SELECT COUNT(*) AS totalRestaurants FROM restaurants",
    );
    const [[{ totalOrders }]] = await db.query(
      "SELECT COUNT(*) AS totalOrders FROM orders",
    );
    const [[{ totalFoods }]] = await db.query(
      "SELECT COUNT(*) AS totalFoods FROM foods",
    );
    res.json({ totalUsers, totalRestaurants, totalOrders, totalFoods });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ─── QR CODES ──────────────────────────────────────────────
const {
  generateQrWithLogo,
  encryptRestaurantId,
  decryptRestaurantId,
} = require("../helpers/qrWithLogo");

router.get("/qr/table/:number", softAuth, async (req, res) => {
  try {
    const tableNumber = parseInt(req.params.number);
    if (!tableNumber || isNaN(tableNumber))
      return res.status(400).json({ error: "Invalid table number" });

    let restaurantId = null;
    if (req.query.restaurant_id) restaurantId = parseInt(req.query.restaurant_id);
    else if (req.user) {
      const [rows] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ?",
        [req.user.id],
      );
      if (rows.length) restaurantId = rows[0].id;
    }

    const frontendUrl =
      process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;

    // 🏪 Resolve the current restaurant logo FIRST (so cache is always fresh)
    let restaurantLogo = null;
    if (restaurantId) {
      const [restRows] = await db.query(
        "SELECT logo_url FROM restaurants WHERE id = ?",
        [restaurantId],
      );
      if (restRows.length && restRows[0].logo_url) {
        restaurantLogo = restRows[0].logo_url;
      }
    }

    // Force regenerate even if a cached QR exists for this table
    const force = req.query.force === "1" || req.query.force === "true";

    // 🔍 Check if QR code already exists for this restaurant + table.
    // If it exists AND the restaurant has a logo, regenerate using the current
    // logo so the embedded logo stays dynamic. If force, always regenerate.
    if (restaurantId && !force) {
      const [existing] = await db.query(
        "SELECT qr_data_url, qr_url, created_at FROM qr_codes WHERE restaurant_id = ? AND table_no = ?",
        [restaurantId, tableNumber],
      );
      if (existing.length && !restaurantLogo) {
        return res.json({
          success: true,
          tableNumber,
          qrCode: existing[0].qr_data_url,
          url: existing[0].qr_url,
          alreadyExists: true,
          createdAt: existing[0].created_at,
        });
      }
    }

    let qrUrl = `${frontendUrl}/menu?table=${tableNumber}`;
    if (restaurantId) {
      const encryptedToken = encryptRestaurantId(String(restaurantId));
      qrUrl += `&rid=${encodeURIComponent(encryptedToken)}`;
    }

    const darkColor = "#2d5a27";
    const lightColor = "#f5f0e8";

    if (req.query.format === "png") {
      const pngBuffer = await generateQrWithLogo(qrUrl, {
        width: 500,
        margin: 2,
        darkColor,
        lightColor,
        logoUrl: restaurantLogo,
        tableText: `តុលេខ ${tableNumber}`,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="table-${tableNumber}.png"`,
      );
      return res.send(pngBuffer);
    }

    const pngBuffer = await generateQrWithLogo(qrUrl, {
      width: 500,
      margin: 2,
      darkColor,
      lightColor,
      logoUrl: restaurantLogo,
      tableText: `តុលេខ ${tableNumber}`,
    });
    const qrCodeDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    // 💾 Store the QR code in the database (upsert) so later requests reuse it.
    // If the row already existed we are refreshing it (logo changed) → mark
    // `updated` so the UI doesn't show a misleading "already exists" warning.
    let alreadyExists = false;
    let updated = false;
    let createdAt = null;
    if (restaurantId) {
      const [existingRow] = await db.query(
        "SELECT created_at FROM qr_codes WHERE restaurant_id = ? AND table_no = ?",
        [restaurantId, tableNumber],
      );
      alreadyExists = existingRow.length > 0;
      updated = alreadyExists;
      createdAt = alreadyExists ? existingRow[0].created_at : null;
      await db.query(
        `INSERT INTO qr_codes (restaurant_id, table_no, qr_url, qr_data_url)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qr_url = VALUES(qr_url), qr_data_url = VALUES(qr_data_url)`,
        [restaurantId, tableNumber, qrUrl, qrCodeDataUrl],
      );
    }

    res.json({
      success: true,
      tableNumber,
      qrCode: qrCodeDataUrl,
      url: qrUrl,
      alreadyExists,
      updated,
      createdAt,
    });
  } catch (error) {
    console.error("QR generation error:", error.message);
    // If qr_codes table doesn't exist yet, fall back to just generating
    if (error.code === "ER_NO_SUCH_TABLE") {
      try {
        const tableNumber = parseInt(req.params.number);
        const frontendUrl =
          process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
        let qrUrl = `${frontendUrl}/menu?table=${tableNumber}`;
        let restaurantId = req.query.restaurant_id || (req.user ? null : null);
        if (req.user) {
          const [rows] = await db.query(
            "SELECT id FROM restaurants WHERE owner_id = ?",
            [req.user.id],
          );
          if (rows.length) {
            restaurantId = rows[0].id;
            const encryptedToken = encryptRestaurantId(String(restaurantId));
            qrUrl += `&rid=${encodeURIComponent(encryptedToken)}`;
          }
        }
        // Include the restaurant logo dynamically in the fallback too
        let restaurantLogo = null;
        if (restaurantId) {
          const [restRows] = await db.query(
            "SELECT logo_url FROM restaurants WHERE id = ?",
            [restaurantId],
          );
          if (restRows.length && restRows[0].logo_url) {
            restaurantLogo = restRows[0].logo_url;
          }
        }
        const pngBuffer = await generateQrWithLogo(qrUrl, {
          width: 500,
          margin: 2,
          darkColor: "#2d5a27",
          lightColor: "#f5f0e8",
          logoUrl: restaurantLogo,
          tableText: `តុលេខ ${tableNumber}`,
        });
        const qrCodeDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
        return res.json({
          success: true,
          tableNumber,
          qrCode: qrCodeDataUrl,
          url: qrUrl,
          alreadyExists: false,
        });
      } catch (fallbackErr) {
        return res.status(500).json({ error: "Failed to generate QR code" });
      }
    }
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

// GET /api/qr/decrypt - Decrypt restaurant token
router.get("/qr/decrypt", softAuth, (req, res) => {
  try {
    const token = req.query.rid || req.query.token;
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    const decrypted = decryptRestaurantId(token);
    if (!decrypted) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    res.json({ restaurantId: decrypted });
  } catch (error) {
    res.status(500).json({ error: "Failed to decrypt token" });
  }
});

// GET /api/restaurants/share-link/:id - Generate shareable link with encrypted token
router.get("/restaurants/share-link/:id", softAuth, (req, res) => {
  try {
    const restaurantId = parseInt(req.params.id);
    if (isNaN(restaurantId)) {
      return res.status(400).json({ error: "Invalid restaurant ID" });
    }

    const encryptedToken = encryptRestaurantId(restaurantId);
    const frontendUrl =
      process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const shareLink = `${frontendUrl}/menu?rid=${encodeURIComponent(encryptedToken)}`;

    res.json({ shareLink, token: encryptedToken });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate share link" });
  }
});

module.exports = router;
