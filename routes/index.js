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
const ordersCtrl = require("../controllers/ordersController");
const telegramCtrl = require("../controllers/telegramController");
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
      "SELECT id, name, logo_url, default_language FROM restaurants WHERE status = 'active' ORDER BY id ASC",
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
router.get("/auth/verify-email", authCtrl.verifyEmail);
router.post("/auth/forgot-password", authCtrl.forgotPassword);
router.post("/auth/reset-password", authCtrl.resetPassword);
router.get("/auth/me", auth, authCtrl.me);
router.get("/auth/link-code", auth, authCtrl.getLinkCode);
router.patch("/auth/unlink-telegram", auth, authCtrl.unlinkTelegram);
router.patch("/auth/language", auth, authCtrl.updateLanguage);

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
      `SELECT u.id, u.email, u.full_name, u.role, u.status, u.email_verified_at, u.last_login_at, u.created_at,
              r.name AS restaurant_name
       FROM users u
       LEFT JOIN restaurants r ON r.owner_id = u.id
       ORDER BY u.created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
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
const { generateQrWithLogo, encryptRestaurantId } = require("../helpers/qrWithLogo");

router.get("/qr/table/:number", softAuth, async (req, res) => {
  try {
    const tableNumber = req.params.number;
    if (!tableNumber || isNaN(tableNumber))
      return res.status(400).json({ error: "Invalid table number" });

    let restaurantId = null;
    if (req.query.restaurant_id) restaurantId = req.query.restaurant_id;
    else if (req.user) {
      const [rows] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ?",
        [req.user.id],
      );
      if (rows.length) restaurantId = String(rows[0].id);
    }

    const frontendUrl =
      process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    let qrUrl = `${frontendUrl}?table=${tableNumber}`;
    if (restaurantId) {
      const encryptedId = encryptRestaurantId(restaurantId);
      qrUrl += `&rid=${encryptedId}`;
    }

    const darkColor = "#2d5a27";
    const lightColor = "#f5f0e8";

    if (req.query.format === "png") {
      const pngBuffer = await generateQrWithLogo(qrUrl, {
        width: 500,
        margin: 2,
        darkColor,
        lightColor,
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
    });
    const qrCodeDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    res.json({
      success: true,
      tableNumber: parseInt(tableNumber),
      qrCode: qrCodeDataUrl,
      url: qrUrl,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

module.exports = router;
