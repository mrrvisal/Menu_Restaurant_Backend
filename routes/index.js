// backend/routes/index.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();

const auth = require("../middleware/auth");
const authCtrl = require("../controllers/authController");
const foodsCtrl = require("../controllers/foodsController");
const catsCtrl = require("../controllers/categoriesController");
const ordersCtrl = require("../controllers/ordersController");

// ✅ FIXED: Use memoryStorage so req.file.buffer is available for ImageKit upload
// diskStorage saves to disk and does NOT populate req.file.buffer
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ok =
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error("Only images allowed"));
  },
});

// ─── AUTH ────────────────────────────────────────────────────
router.post("/auth/login", authCtrl.login);

// ─── CATEGORIES ─────────────────────────────────────────────
router.get("/categories", catsCtrl.getAll);

// ─── FOODS (public reads, admin writes) ──────────────────────
router.get("/foods", foodsCtrl.getAll);
router.get("/foods/:id", foodsCtrl.getOne);
router.post("/foods", auth, upload.single("image"), foodsCtrl.create);
router.patch("/foods/:id", auth, upload.single("image"), foodsCtrl.update);
router.patch("/foods/:id/status", auth, foodsCtrl.toggleStatus);
router.delete("/foods/:id", auth, foodsCtrl.remove);

// ─── ORDERS ──────────────────────────────────────────────────
router.post("/orders", ordersCtrl.create);

// ─── TABLE QR CODES ────────────────────────────────────────
const { generateQrWithLogo } = require("../helpers/qrWithLogo");

// GET /api/qr/table/:number - Generate QR for a table
router.get("/qr/table/:number", async (req, res) => {
  try {
    const tableNumber = req.params.number;
    if (!tableNumber || isNaN(tableNumber)) {
      return res.status(400).json({ error: "Invalid table number" });
    }

    // Use the server's own URL (works locally + in production)
    const host = req.get("host");
    const protocol = req.protocol;
    const frontendUrl = process.env.FRONTEND_URL || `${protocol}://${host}`;
    const qrUrl = `${frontendUrl}?table=${tableNumber}`;

    // Natural / earthy color palette
    const darkColor = "#2d5a27";   // deep forest green
    const lightColor = "#f5f0e8";  // warm cream

    // Also return as PNG stream for downloading (includes logo)
    if (req.query.format === "png") {
      const pngBuffer = await generateQrWithLogo(qrUrl, {
        width: 500,
        margin: 2,
        darkColor,
        lightColor,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `attachment; filename="table-${tableNumber}.png"`);
      return res.send(pngBuffer);
    }

    // Default JSON – generate with logo and convert to data URL
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
    console.error("QR generation error:", error.message);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

module.exports = router;
