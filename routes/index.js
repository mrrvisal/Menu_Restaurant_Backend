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

module.exports = router;
