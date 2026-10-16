const express = require("express");
const { auth, requireSuperAdmin } = require("../../common/middleware/auth");
const controller = require("./telegram.controller");

const router = express.Router();
// Webhook mode (TELEGRAM_UPDATES_MODE=webhook): Telegram POSTs updates to
// /telegram/webhook, authenticated by TELEGRAM_WEBHOOK_SECRET; in polling
// mode this endpoint is simply never called. The set/delete endpoints were
// UNAUTHENTICATED in the audit (High #5): anyone could delete the webhook
// (notification DoS) or re-point it at their own server via a spoofed Host
// header — both are super-admin-only now and the URL comes from
// TELEGRAM_WEBHOOK_URL env only (never the Host header).
router.post("/telegram/webhook", controller.webhook);
router.get(
  "/telegram/set-webhook",
  auth,
  requireSuperAdmin,
  controller.setWebhook,
);
router.get(
  "/telegram/delete-webhook",
  auth,
  requireSuperAdmin,
  controller.deleteWebhook,
);

module.exports = router;
