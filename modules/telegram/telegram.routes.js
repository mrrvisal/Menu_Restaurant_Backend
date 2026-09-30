const express = require("express");
const controller = require("./telegram.controller");

const router = express.Router();
router.post("/telegram/webhook", controller.webhook);
router.get("/telegram/set-webhook", controller.setWebhook);
router.get("/telegram/delete-webhook", controller.deleteWebhook);

module.exports = router;
