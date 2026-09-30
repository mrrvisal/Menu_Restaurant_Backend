const express = require("express");
const { auth, requireOwnerOrAdmin } = require("../../common/middleware/auth");
const controller = require("./orders.controller");

const router = express.Router();
router.get("/restaurants/:id", controller.getRestaurant);
router.post("/orders", controller.create);
router.get("/orders", auth, requireOwnerOrAdmin, controller.getAll);
router.get("/orders/stats", auth, requireOwnerOrAdmin, controller.stats);
router.get("/orders/export", auth, requireOwnerOrAdmin, controller.exportCsv);
router.get("/orders/track", controller.track);
router.patch(
  "/orders/:id/status",
  auth,
  requireOwnerOrAdmin,
  controller.updateStatus,
);

module.exports = router;
