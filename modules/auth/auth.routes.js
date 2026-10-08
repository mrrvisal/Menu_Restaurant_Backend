const express = require("express");
const auth = require("../../common/middleware/auth").auth;
const upload = require("../../common/middleware/imageUpload");
const controller = require("./auth.controller");

const router = express.Router();

router.post("/auth/register", upload.single("logo"), controller.register);
router.post("/auth/login/super-admin", controller.superAdminLogin);
router.post("/auth/login", controller.login);
router.post("/auth/google", controller.googleLogin);
router.post("/auth/refresh", controller.refresh);
router.get("/auth/verify-email", controller.verifyEmail);
router.post("/auth/resend-verification", controller.resendVerification);
router.post("/auth/forgot-password", controller.forgotPassword);
router.post("/auth/reset-password", controller.resetPassword);
router.get("/auth/devices", auth, controller.listDevices);
router.get("/auth/devices/history", auth, controller.listLoginHistory);
router.delete("/auth/devices", auth, controller.revokeAllOtherDevices);
router.delete("/auth/devices/:id", auth, controller.revokeDevice);
router.get("/auth/me", auth, controller.me);
router.patch("/auth/account", auth, controller.updateAccount);
router.get("/auth/link-code", auth, controller.getLinkCode);
router.patch("/auth/unlink-telegram", auth, controller.unlinkTelegram);
router.patch("/auth/language", auth, controller.updateLanguage);
router.patch(
  "/auth/restaurant",
  auth,
  upload.single("logo"),
  controller.updateRestaurant,
);
router.post(
  "/auth/restaurants",
  auth,
  upload.single("logo"),
  controller.createRestaurant,
);
router.delete("/auth/restaurants/:id", auth, controller.deleteRestaurant);
router.patch("/auth/theme", auth, controller.updateTheme);
router.patch("/auth/sidebar", auth, controller.updateSidebar);
router.patch("/auth/currency", auth, controller.updateCurrency);
router.patch("/auth/tracking", auth, controller.updateOrderTracking);
router.patch("/auth/call-button", auth, controller.updateCallButton);

module.exports = router;
