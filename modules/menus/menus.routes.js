const express = require("express");
const {
  auth,
  softAuth,
  requireOwnerOrAdmin,
} = require("../../common/middleware/auth");
const controller = require("./menus.controller");

const router = express.Router();
router.get("/menus", softAuth, controller.getAll);
router.post("/menus", auth, requireOwnerOrAdmin, controller.create);
router.patch("/menus/:id", auth, requireOwnerOrAdmin, controller.update);
router.delete("/menus/:id", auth, requireOwnerOrAdmin, controller.remove);

module.exports = router;
