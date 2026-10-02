const express = require("express");
const { auth, requireOwnerOrAdmin } = require("../../common/middleware/auth");
const controller = require("./calls.controller");

const router = express.Router();

// Public: a guest at a table calls the owner (no login at the table!)
router.post("/calls", controller.create);

// Owner: list + resolve calls from the dashboard
router.get("/calls", auth, requireOwnerOrAdmin, controller.getAll);
router.patch(
  "/calls/:id/status",
  auth,
  requireOwnerOrAdmin,
  controller.updateStatus,
);

module.exports = router;
