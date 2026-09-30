const express = require("express");
const {
  auth,
  softAuth,
  requireOwnerOrAdmin,
} = require("../../common/middleware/auth");
const controller = require("./categories.controller");

const router = express.Router();
router.get("/categories", softAuth, controller.getAll);
router.post("/categories", auth, requireOwnerOrAdmin, controller.create);
router.patch("/categories/:id", auth, requireOwnerOrAdmin, controller.update);
router.delete("/categories/:id", auth, requireOwnerOrAdmin, controller.remove);

module.exports = router;
