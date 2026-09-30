const express = require("express");
const {
  auth,
  softAuth,
  requireOwnerOrAdmin,
} = require("../../common/middleware/auth");
const upload = require("../../common/middleware/imageUpload");
const controller = require("./foods.controller");

const router = express.Router();
router.get("/foods", softAuth, controller.getAll);
router.get("/foods/:id", controller.getOne);
router.post(
  "/foods",
  auth,
  requireOwnerOrAdmin,
  upload.single("image"),
  controller.create,
);
router.patch(
  "/foods/:id",
  auth,
  requireOwnerOrAdmin,
  upload.single("image"),
  controller.update,
);
router.patch(
  "/foods/:id/status",
  auth,
  requireOwnerOrAdmin,
  controller.toggleStatus,
);
router.delete("/foods/:id", auth, requireOwnerOrAdmin, controller.remove);

module.exports = router;
