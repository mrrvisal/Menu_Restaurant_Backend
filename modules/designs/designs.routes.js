const express = require("express");
const { auth, requireOwnerOrAdmin } = require("../../common/middleware/auth");
const controller = require("./designs.controller");

const router = express.Router();

// Saved "Menu Studio" designs (one owner may manage many restaurants)
router.get("/menu-designs", auth, controller.getAll);
router.post("/menu-designs", auth, requireOwnerOrAdmin, controller.create);
router.patch("/menu-designs/:id", auth, requireOwnerOrAdmin, controller.update);
router.delete("/menu-designs/:id", auth, requireOwnerOrAdmin, controller.remove);

// Lightweight QR image for the generated menu footer — POST body: { url, dark?, light? }
router.post("/menu-designs/qr", auth, requireOwnerOrAdmin, controller.qr);

module.exports = router;
