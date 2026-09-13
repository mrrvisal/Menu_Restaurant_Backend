// backend/routes/index.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();

const {
  auth,
  softAuth,
  requireSuperAdmin,
  requireOwner,
  requireOwnerOrAdmin,
} = require("../middleware/auth");
const authCtrl = require("../controllers/authController");
const foodsCtrl = require("../controllers/foodsController");
const catsCtrl = require("../controllers/categoriesController");
const menusCtrl = require("../controllers/menusController");
const ordersCtrl = require("../controllers/ordersController");
const telegramCtrl = require("../controllers/telegramController");
const { addClient } = require("../services/sse");
const db = require("../config/db");
const { logActivity } = require("../helpers/audit");

// ─── FILE UPLOAD CONFIG ────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ok =
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error("Only images allowed"));
  },
});

// ─── PUBLIC ROUTES ─────────────────────────────────────────
// Restaurants list
router.get("/restaurants", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, logo_url, default_language, theme_color FROM restaurants WHERE status = 'active' ORDER BY id ASC",
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/restaurants/:id", ordersCtrl.getRestaurant);

// ─── AUTH ROUTES ───────────────────────────────────────────
router.post("/auth/register", upload.single("logo"), authCtrl.register);
// Dedicated Super Admin login — the ONLY entry point for super_admin accounts.
router.post("/auth/login/super-admin", authCtrl.superAdminLogin);
router.post("/auth/login", authCtrl.login);
router.post("/auth/google", authCtrl.googleLogin);
router.get("/auth/verify-email", authCtrl.verifyEmail);
router.post("/auth/resend-verification", authCtrl.resendVerification);
router.post("/auth/forgot-password", authCtrl.forgotPassword);
router.post("/auth/reset-password", authCtrl.resetPassword);
// ─── DEVICE SESSIONS (see + revoke every device on the account) ───
router.get("/auth/devices", auth, authCtrl.listDevices);
router.get("/auth/devices/history", auth, authCtrl.listLoginHistory);
router.delete("/auth/devices", auth, authCtrl.revokeAllOtherDevices);
router.delete("/auth/devices/:id", auth, authCtrl.revokeDevice);
router.get("/auth/me", auth, authCtrl.me);
// Logged-in user changes their OWN email and/or password (current password required)
router.patch("/auth/account", auth, authCtrl.updateAccount);
router.get("/auth/link-code", auth, authCtrl.getLinkCode);
router.patch("/auth/unlink-telegram", auth, authCtrl.unlinkTelegram);
router.patch("/auth/language", auth, authCtrl.updateLanguage);
router.patch("/auth/restaurant", auth, upload.single("logo"), authCtrl.updateRestaurant);

// Owner adds ANOTHER restaurant to their account
router.post("/auth/restaurants", auth, upload.single("logo"), authCtrl.createRestaurant);
router.patch("/auth/theme", auth, authCtrl.updateTheme);
router.patch("/auth/sidebar", auth, authCtrl.updateSidebar);

// ─── MENUS (public read per restaurant, owner/super_admin write) ─
router.get("/menus", softAuth, menusCtrl.getAll);
router.post("/menus", auth, requireOwnerOrAdmin, menusCtrl.create);
router.patch("/menus/:id", auth, requireOwnerOrAdmin, menusCtrl.update);
router.delete("/menus/:id", auth, requireOwnerOrAdmin, menusCtrl.remove);

// ─── TELEGRAM BOT ──────────────────────────────────────────
router.post("/telegram/webhook", telegramCtrl.webhook);
router.get("/telegram/set-webhook", telegramCtrl.setWebhook);
router.get("/telegram/delete-webhook", telegramCtrl.deleteWebhook);

// ─── CATEGORIES (public read with optional auth, owner/super_admin write) ─
router.get("/categories", softAuth, catsCtrl.getAll);
router.post("/categories", auth, requireOwnerOrAdmin, catsCtrl.create);
router.patch("/categories/:id", auth, requireOwnerOrAdmin, catsCtrl.update);
router.delete("/categories/:id", auth, requireOwnerOrAdmin, catsCtrl.remove);

// ─── FOODS (public read with optional auth, owner/super_admin write) ─
router.get("/foods", softAuth, foodsCtrl.getAll);
router.get("/foods/:id", foodsCtrl.getOne);
router.post(
  "/foods",
  auth,
  requireOwnerOrAdmin,
  upload.single("image"),
  foodsCtrl.create,
);
router.patch(
  "/foods/:id",
  auth,
  requireOwnerOrAdmin,
  upload.single("image"),
  foodsCtrl.update,
);
router.patch(
  "/foods/:id/status",
  auth,
  requireOwnerOrAdmin,
  foodsCtrl.toggleStatus,
);
router.delete("/foods/:id", auth, requireOwnerOrAdmin, foodsCtrl.remove);

// ─── ORDERS (public create, owner/super_admin view) ────────
router.post("/orders", ordersCtrl.create);

// ─── ORDER SSE STREAM (real-time new order alerts) ─────────
router.get("/orders/stream", (req, res, next) => {
  // EventSource (native browser API) can't set custom headers,
  // so also accept the JWT token as a query parameter.
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  auth(req, res, () => requireOwnerOrAdmin(req, res, next));
}, (req, res) => {
  // Resolve the restaurant(s) to stream: the requested one when
  // restaurant_id is supplied (must be owned by the caller), otherwise EVERY
  // restaurant the account owns — so multi-restaurant owners never miss
  // orders, and the stream follows the restaurant selected in the dashboard
  // when the client passes one.
  const fetchRestaurants = () => {
    const requested = parseInt(req.query.restaurant_id || 0);
    if (requested) {
      return db.query(
        "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
        [requested, req.user.id],
      );
    }
    return db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC",
      [req.user.id],
    );
  };

  fetchRestaurants().then(([rows]) => {
    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "No restaurant found for this account" });
    }
    const restaurantIds = rows.map((r) => r.id);

    // Headers for SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial event so client knows the stream is live (and for which
    // restaurants)
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        message: "stream connected",
        restaurantIds,
      })}\n\n`,
    );

    // Periodic keep-alive comment (prevents proxy timeouts)
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 25000);

    // Register this client for every streamed restaurant
    restaurantIds.forEach((id) => addClient(id, res));

    // Cleanup interval on close (addClient removes the res from each set)
    res.on("close", () => {
      clearInterval(heartbeat);
    });
  }).catch((err) => {
    console.error("SSE setup error:", err);
    res.status(500).json({ error: "Server error" });
  });
});
router.get("/orders", auth, requireOwnerOrAdmin, ordersCtrl.getAll);
router.get("/orders/stats", auth, requireOwnerOrAdmin, ordersCtrl.stats);
router.patch(
  "/orders/:id/status",
  auth,
  requireOwnerOrAdmin,
  ordersCtrl.updateStatus,
);

// ─── SUPER ADMIN ROUTES ────────────────────────────────────
router.get("/admin/users", auth, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.role, u.status, u.email_verified_at, u.last_login_at, u.created_at,
              GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS restaurant_name
       FROM users u
       LEFT JOIN restaurants r ON r.owner_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    console.error("Admin users fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.patch(
  "/admin/users/:id/status",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    const { status } = req.body;
    if (!["active", "suspended", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    try {
      await db.query("UPDATE users SET status = ? WHERE id = ?", [
        status,
        req.params.id,
      ]);
      logActivity({
        userId: req.user.id,
        action: "user_status",
        description: `Changed user #${req.params.id} status → ${status}`,
        ipAddress: req.ip,
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: change a user's role (owner <-> super_admin)
router.patch(
  "/admin/users/:id/role",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    const { role } = req.body;
    if (!["owner", "super_admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    // Safety: a super admin cannot change their own role (avoid lockout)
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "You cannot change your own role" });
    }
    try {
      const [result] = await db.query("UPDATE users SET role = ? WHERE id = ?", [
        role,
        req.params.id,
      ]);
      if (!result.affectedRows) {
        return res.status(404).json({ error: "User not found" });
      }
      logActivity({
        userId: req.user.id,
        action: "user_role",
        description: `Changed user #${req.params.id} role → ${role}`,
        ipAddress: req.ip,
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Admin change role error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: Manually verify a user's email
router.post(
  "/admin/users/:id/verify",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        "SELECT id, email, email_verified_at FROM users WHERE id = ?",
        [req.params.id],
      );
      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }
      if (rows[0].email_verified_at) {
        return res.json({ success: true, message: "Email already verified" });
      }
      await db.query(
        "UPDATE users SET email_verified_at = NOW(), email_verify_token = NULL, status = 'active' WHERE id = ?",
        [req.params.id],
      );
      logActivity({
        userId: req.user.id,
        action: "user_verified",
        description: `Verified email for user ${rows[0].email}`,
        ipAddress: req.ip,
      });
      res.json({ success: true, message: "User email verified successfully" });
    } catch (err) {
      console.error("Admin verify user error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: Resend verification email to a user
router.post(
  "/admin/users/:id/resend-verification",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        "SELECT id, email, email_verified_at FROM users WHERE id = ?",
        [req.params.id],
      );
      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }
      const user = rows[0];
      if (user.email_verified_at) {
        return res.json({ success: true, message: "Email already verified" });
      }

      // Generate new verification token
      const crypto = require("crypto");
      const verifyToken = crypto.randomBytes(32).toString("hex");
      await db.query(
        "UPDATE users SET email_verify_token = ? WHERE id = ?",
        [verifyToken, user.id],
      );

      // Send verification email
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
      const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
      const { sendMail } = require("../config/mailer");
      sendMail({
        to: user.email,
        subject: "Verify your email - Digital Menu",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="width: 48px; height: 48px; background: #166534; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
            </div>
            <h2 style="color: #14532d; text-align: center; margin-bottom: 16px;">Email Verification</h2>
            <p style="color: #4a6650; line-height: 1.6; margin-bottom: 20px;">
              Hello${user.full_name ? " " + user.full_name : ""},<br/><br/>
              An administrator has requested you to verify your email address. Please click the button below to verify.
            </p>
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #166534, #22c55e); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
                Verify Email Address
              </a>
            </div>
            <p style="color: #6b7280; font-size: 12px; text-align: center;">
              Or copy this link into your browser:<br/>
              <a href="${verifyUrl}" style="color: #22c55e; word-break: break-all;">${verifyUrl}</a>
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 11px; text-align: center;">
              This link expires when a new verification is requested. If you didn't expect this email, please ignore it.
            </p>
          </div>
        `,
      }).catch(err => console.error("Background email send failed:", err.message));

      res.json({ success: true, message: "Verification email sent" });
    } catch (err) {
      console.error("Admin resend verification error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: recent login history fora user (from device_login_history audit trail))
router.get(
  "/admin/users/:id/login-history",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT id, device_name AS deviceName, method, ip_address AS ipAddress,
                city, region, country, browser, os, created_at AS createdAt
         FROM device_login_history
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 15`,
        [req.params.id],
      );
      res.json(rows);
    } catch (err) {
      if (err.code === "ER_NO_SUCH_TABLE") return res.json([]);
      console.error("Admin login history error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: reset a user's password to a temporary one (returned once)
router.post(
  "/admin/users/:id/reset-password",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [rows] = await db.query("SELECT id FROM users WHERE id = ?", [
        req.params.id,
      ]);
      if (!rows.length)
        return res.status(404).json({ error: "User not found" });

      // Readable 10-char temp password (avoid 0/O, 1/l/I ambiguities)
      const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
      let tempPassword = "";
      for (let i = 0; i < 10; i++)
        tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
      const bcrypt = require("bcryptjs");
      const hash = await bcrypt.hash(tempPassword, 10);
      await db.query("UPDATE users SET password = ? WHERE id = ?", [
        hash,
        req.params.id,
      ]);
      logActivity({
        userId: req.user.id,
        action: "password_reset_admin",
        description: `Admin reset password for user #${req.params.id}`,
        ipAddress: req.ip,
      });
      res.json({ success: true, tempPassword });
    } catch (err) {
      console.error("Admin reset password error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// Super Admin: deletea user account (cascades their restaurants, menus, foods, orders))
router.delete(
  "/admin/users/:id",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    // Never allow deleting your own account (would lock the system out)
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }
    try {
      const [result] = await db.query("DELETE FROM users WHERE id = ?", [
        req.params.id,
      ]);
      if (!result.affectedRows)
        return res.status(404).json({ error: "User not found" });
      logActivity({
        userId: req.user.id,
        action: "user_deleted",
        description: `Deleted user #${req.params.id}`,
        ipAddress: req.ip,
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Admin delete user error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.get("/admin/restaurants", auth, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, u.email AS owner_email,
              (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) AS orders_count,
              (SELECT COUNT(*) FROM foods f WHERE f.restaurant_id = r.id) AS foods_count
       FROM restaurants r
       JOIN users u ON u.id = r.owner_id
       ORDER BY r.created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Super Admin: suspend / activate / deactivate a restaurant
router.patch(
  "/admin/restaurants/:id/status",
  auth,
  requireSuperAdmin,
  async (req, res) => {
    const { status } = req.body;
    if (!["active", "inactive", "suspended"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    try {
      const [result] = await db.query(
        "UPDATE restaurants SET status = ? WHERE id = ?",
        [status, req.params.id],
      );
      if (!result.affectedRows) {
        return res.status(404).json({ error: "Restaurant not found" });
      }
      logActivity({
        userId: req.user.id,
        action: "restaurant_status",
        description: `Changed restaurant #${req.params.id} status → ${status}`,
        ipAddress: req.ip,
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Admin restaurant status error:", err);
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.get("/admin/stats", auth, requireSuperAdmin, async (req, res) => {
  try {
    const [[{ totalUsers }]] = await db.query(
      "SELECT COUNT(*) AS totalUsers FROM users",
    );
    const [[{ totalRestaurants }]] = await db.query(
      "SELECT COUNT(*) AS totalRestaurants FROM restaurants",
    );
    const [[{ totalOrders }]] = await db.query(
      "SELECT COUNT(*) AS totalOrders FROM orders",
    );
    const [[{ totalFoods }]] = await db.query(
      "SELECT COUNT(*) AS totalFoods FROM foods",
    );
    const [[{ todayOrders }]] = await db.query(
      "SELECT COUNT(*) AS todayOrders FROM orders WHERE created_at >= CURDATE()",
    );
    const [[{ revenue }]] = await db.query(
      "SELECT COALESCE(SUM(total), 0) AS revenue FROM orders",
    );
    const [[{ unverifiedUsers }]] = await db.query(
      "SELECT COUNT(*) AS unverifiedUsers FROM users WHERE email_verified_at IS NULL",
    );
    const [[{ pendingOrders }]] = await db.query(
      "SELECT COUNT(*) AS pendingOrders FROM orders WHERE status = 'pending'",
    );
    res.json({
      totalUsers,
      totalRestaurants,
      totalOrders,
      totalFoods,
      todayOrders,
      revenue,
      unverifiedUsers,
      pendingOrders,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Super Admin: global order feed (all restaurants, optional status filter)
router.get("/admin/orders", auth, requireSuperAdmin, async (req, res) => {
  try {
    const status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit || 100, 10), 500);
    const filters = [limit];
    let whereClause = "";
    if (status && ["pending", "confirmed", "preparing", "ready", "served", "cancelled"].includes(status)) {
      whereClause = "WHERE o.status = ? ";
      filters.unshift(status);
    }
    const [rows] = await db.query(
      `SELECT o.id, o.restaurant_id, o.table_no AS tableNo, o.customer_name AS customerName,
              o.items, o.note, o.total, o.status, o.created_at AS createdAt,
              r.name AS restaurant_name
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT ?`,
      filters,
    );
    res.json(rows);
  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Super Admin: consolidated ACCESS + ACTIVITY feed across ALL users
// Session heartbeat (last_active_at) comes from middleware/auth throttled updates.
router.get("/admin/access", auth, requireSuperAdmin, async (req, res) => {
  try {
    // ── Summary stats ──────────────────────────────────────────
    const [[stats]] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM device_login_history)                  AS totalLogins,
         (SELECT COUNT(*) FROM device_login_history WHERE created_at >= CURDATE()) AS loginsToday,
         (SELECT COUNT(DISTINCT user_id) FROM device_login_history WHERE created_at >= CURDATE()) AS usersToday,
         (SELECT COUNT(*) FROM device_sessions WHERE revoked = 0)     AS activeSessions,
         (SELECT COUNT(*) FROM device_sessions WHERE revoked = 1)     AS revokedSessions,
         (SELECT COUNT(*) FROM device_sessions
          WHERE revoked = 0 AND last_active_at >= (NOW() - INTERVAL 15 MINUTE)) AS onlineNow
       FROM dual`,
    );

    // ── Current live sessions (every device logged in, anything sent recent heartbeat) ──
    const [sessions] = await db.query(
      `SELECT ds.id, ds.device_id AS deviceId, ds.device_name AS deviceName,
              ds.device_type AS deviceType, ds.browser, ds.browser_version AS browserVersion,
              ds.os, ds.screen, ds.timezone, ds.language, ds.platform, ds.hardware,
              ds.ip_address AS ipAddress, ds.city, ds.region, ds.country,
              ds.login_count AS loginCount, ds.last_active_at AS lastActiveAt,
              ds.last_login_at AS lastLoginAt, ds.revoked, ds.revoked_at AS revokedAt,
              u.email, u.full_name AS fullName, u.role, u.status AS userStatus
       FROM device_sessions ds
       LEFT JOIN users u ON u.id = ds.user_id
       ORDER BY ds.last_active_at DESC
       LIMIT 200`,
    );

    // ── Recent login history (every login event across all users) ──
    const [logins] = await db.query(
      `SELECT dlh.id, dlh.device_id AS deviceId, dlh.device_name AS deviceName,
              dlh.method, dlh.ip_address AS ipAddress, dlh.city, dlh.region, dlh.country,
              dlh.browser, dlh.os, dlh.asn, dlh.created_at AS createdAt,
              u.email, u.full_name AS fullName, u.role
       FROM device_login_history dlh
       LEFT JOIN users u ON u.id = dlh.user_id
       ORDER BY dlh.id DESC
       LIMIT 200`,
    );

    // ── Recent actions (audit trail of what users did) ──
    const [activities] = await db.query(
      `SELECT al.id, al.action, al.description, al.ip_address AS ipAddress,
              al.created_at AS createdAt,
              u.email, u.full_name AS fullName, u.role
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.id DESC
       LIMIT 100`,
    );

    res.json({ stats, sessions, logins, activities });
  } catch (err) {
    console.error("Admin access error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── QR CODES ──────────────────────────────────────────────
const {
  generateQrWithLogo,
  encryptRestaurantId,
  decryptRestaurantId,
} = require("../helpers/qrWithLogo");

router.get("/qr/table/:number", softAuth, async (req, res) => {
  try {
    const tableNumber = parseInt(req.params.number);
    if (!tableNumber || isNaN(tableNumber))
      return res.status(400).json({ error: "Invalid table number" });

    let restaurantId = null;
    if (req.query.restaurant_id) restaurantId = parseInt(req.query.restaurant_id);
    else if (req.user) {
      const [rows] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ?",
        [req.user.id],
      );
      if (rows.length) restaurantId = rows[0].id;
    }

    const frontendUrl =
      process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;

    // 🏪 Resolve the current restaurant logo FIRST (so cache is always fresh)
    let restaurantLogo = null;
    if (restaurantId) {
      const [restRows] = await db.query(
        "SELECT logo_url FROM restaurants WHERE id = ?",
        [restaurantId],
      );
      if (restRows.length && restRows[0].logo_url) {
        restaurantLogo = restRows[0].logo_url;
      }
    }

    // Force regenerate even if a cached QR exists for this table
    const force = req.query.force === "1" || req.query.force === "true";

    // 🔍 Check if QR code already exists for this restaurant + table.
    // Once an owner has "made done" a table's QR, the SAME table number can
    // NOT be made again — the stored QR is always returned as-is (even if the
    // restaurant has a logo). Regenerating is only possible explicitly with
    // ?force=1 (used to refresh the embedded logo after a logo change), and
    // that path upserts the stored row instead of creating a duplicate.
    if (restaurantId && !force) {
      const [existing] = await db.query(
        "SELECT qr_data_url, qr_url, created_at FROM qr_codes WHERE restaurant_id = ? AND table_no = ?",
        [restaurantId, tableNumber],
      );
      if (existing.length) {
        return res.json({
          success: true,
          tableNumber,
          qrCode: existing[0].qr_data_url,
          url: existing[0].qr_url,
          alreadyExists: true,
          createdAt: existing[0].created_at,
        });
      }
    }

    let qrUrl = `${frontendUrl}/menu?table=${tableNumber}`;
    if (restaurantId) {
      const encryptedToken = encryptRestaurantId(String(restaurantId));
      qrUrl += `&rid=${encodeURIComponent(encryptedToken)}`;
    }

    const darkColor = "#2d5a27";
    const lightColor = "#f5f0e8";

    if (req.query.format === "png") {
      const pngBuffer = await generateQrWithLogo(qrUrl, {
        width: 500,
        margin: 2,
        darkColor,
        lightColor,
        logoUrl: restaurantLogo,
        tableText: `តុលេខ ${tableNumber}`,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="table-${tableNumber}.png"`,
      );
      return res.send(pngBuffer);
    }

    const pngBuffer = await generateQrWithLogo(qrUrl, {
      width: 500,
      margin: 2,
      darkColor,
      lightColor,
      logoUrl: restaurantLogo,
      tableText: `តុលេខ ${tableNumber}`,
    });
    const qrCodeDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    // 💾 Store the QR code in the database (upsert) so later requests reuse it.
    // If the row already existed we are refreshing it (logo changed) → mark
    // `updated` so the UI doesn't show a misleading "already exists" warning.
    let alreadyExists = false;
    let updated = false;
    let createdAt = null;
    if (restaurantId) {
      const [existingRow] = await db.query(
        "SELECT created_at FROM qr_codes WHERE restaurant_id = ? AND table_no = ?",
        [restaurantId, tableNumber],
      );
      alreadyExists = existingRow.length > 0;
      updated = alreadyExists;
      createdAt = alreadyExists ? existingRow[0].created_at : null;
      await db.query(
        `INSERT INTO qr_codes (restaurant_id, table_no, qr_url, qr_data_url)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE qr_url = VALUES(qr_url), qr_data_url = VALUES(qr_data_url)`,
        [restaurantId, tableNumber, qrUrl, qrCodeDataUrl],
      );
    }

    res.json({
      success: true,
      tableNumber,
      qrCode: qrCodeDataUrl,
      url: qrUrl,
      alreadyExists,
      updated,
      createdAt,
    });
  } catch (error) {
    console.error("QR generation error:", error.message);
    // If qr_codes table doesn't exist yet, fall back to just generating
    if (error.code === "ER_NO_SUCH_TABLE") {
      try {
        const tableNumber = parseInt(req.params.number);
        const frontendUrl =
          process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
        let qrUrl = `${frontendUrl}/menu?table=${tableNumber}`;
        let restaurantId = req.query.restaurant_id || (req.user ? null : null);
        if (req.user) {
          const [rows] = await db.query(
            "SELECT id FROM restaurants WHERE owner_id = ?",
            [req.user.id],
          );
          if (rows.length) {
            restaurantId = rows[0].id;
            const encryptedToken = encryptRestaurantId(String(restaurantId));
            qrUrl += `&rid=${encodeURIComponent(encryptedToken)}`;
          }
        }
        // Include the restaurant logo dynamically in the fallback too
        let restaurantLogo = null;
        if (restaurantId) {
          const [restRows] = await db.query(
            "SELECT logo_url FROM restaurants WHERE id = ?",
            [restaurantId],
          );
          if (restRows.length && restRows[0].logo_url) {
            restaurantLogo = restRows[0].logo_url;
          }
        }
        const pngBuffer = await generateQrWithLogo(qrUrl, {
          width: 500,
          margin: 2,
          darkColor: "#2d5a27",
          lightColor: "#f5f0e8",
          logoUrl: restaurantLogo,
          tableText: `តុលេខ ${tableNumber}`,
        });
        const qrCodeDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
        return res.json({
          success: true,
          tableNumber,
          qrCode: qrCodeDataUrl,
          url: qrUrl,
          alreadyExists: false,
        });
      } catch (fallbackErr) {
        return res.status(500).json({ error: "Failed to generate QR code" });
      }
    }
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

// ─── SAVED QR CODES (owner) ────────────────────────────────
// Every generated table QR is stored in `qr_codes`. These endpoints let the
// owner browse / search / preview / download the QRs they already made.
// A table number that was "made done" can never be generated again —
// see /qr/table/:number above which always returns the stored QR.

// GET /api/qr/codes?restaurant_id=X&search=12 — metadata list of saved QRs
router.get("/qr/codes", auth, async (req, res) => {
  try {
    const requested = parseInt(req.query.restaurant_id || 0);
    let ids;
    if (req.user.role === "super_admin") {
      ids = requested ? [requested] : null; // null = every restaurant
    } else {
      const [owned] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ?",
        [req.user.id],
      );
      const ownedIds = owned.map((r) => r.id);
      if (requested) {
        if (!ownedIds.includes(requested))
          return res
            .status(404)
            .json({ error: "Restaurant not found or not owned by you" });
        ids = [requested];
      } else {
        ids = ownedIds;
      }
    }
    if (ids && !ids.length) return res.json([]);

    // Search is by table number (digits only, partial match allowed)
    const search = String(req.query.search || "").replace(/[^0-9]/g, "");
    let sql =
      "SELECT id, restaurant_id, table_no, qr_url, created_at FROM qr_codes";
    const where = [];
    const params = [];
    if (ids) {
      where.push("restaurant_id IN (?)");
      params.push(ids);
    }
    if (search) {
      where.push("CAST(table_no AS CHAR) LIKE ?");
      params.push(`%${search}%`);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY table_no ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return res.json([]);
    console.error("Saved QR list error:", err.message);
    res.status(500).json({ error: "Failed to load saved QR codes" });
  }
});

// GET /api/qr/codes/:tableNo?restaurant_id=X — one saved QR (with image data
// URL) used by the admin UI for preview and download.
router.get("/qr/codes/:tableNo", auth, async (req, res) => {
  try {
    const tableNo = parseInt(req.params.tableNo);
    if (!tableNo || isNaN(tableNo))
      return res.status(400).json({ error: "Invalid table number" });

    const requested = parseInt(req.query.restaurant_id || 0);
    let ids;
    if (req.user.role === "super_admin") {
      ids = requested ? [requested] : null;
    } else {
      const [owned] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ?",
        [req.user.id],
      );
      const ownedIds = owned.map((r) => r.id);
      if (requested) {
        if (!ownedIds.includes(requested))
          return res
            .status(404)
            .json({ error: "Restaurant not found or not owned by you" });
        ids = [requested];
      } else {
        ids = ownedIds;
      }
    }
    if (ids && !ids.length)
      return res.status(404).json({ error: "QR code not found" });

    let sql =
      "SELECT id, restaurant_id, table_no, qr_url, qr_data_url, created_at FROM qr_codes WHERE table_no = ?";
    const params = [tableNo];
    if (ids) {
      sql += " AND restaurant_id IN (?)";
      params.push(ids);
    }
    const [rows] = await db.query(sql, params);
    if (!rows.length)
      return res.status(404).json({ error: "QR code not found" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE")
      return res.status(404).json({ error: "QR code not found" });
    console.error("Saved QR get error:", err.message);
    res.status(500).json({ error: "Failed to load QR code" });
  }
});

// DELETE /api/qr/codes/:tableNo?restaurant_id=X — owner deletes a saved QR.
// After deletion the table number is free again and can be generated anew.
router.delete("/qr/codes/:tableNo", auth, async (req, res) => {
  try {
    const tableNo = parseInt(req.params.tableNo);
    if (!tableNo || isNaN(tableNo))
      return res.status(400).json({ error: "Invalid table number" });

    const requested = parseInt(req.query.restaurant_id || 0);
    let ids;
    if (req.user.role === "super_admin") {
      ids = requested ? [requested] : null;
    } else {
      const [owned] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ?",
        [req.user.id],
      );
      const ownedIds = owned.map((r) => r.id);
      if (requested) {
        if (!ownedIds.includes(requested))
          return res
            .status(404)
            .json({ error: "Restaurant not found or not owned by you" });
        ids = [requested];
      } else {
        ids = ownedIds;
      }
    }
    if (ids && !ids.length)
      return res.status(404).json({ error: "QR code not found" });

    let sql = "DELETE FROM qr_codes WHERE table_no = ?";
    const params = [tableNo];
    if (ids) {
      sql += " AND restaurant_id IN (?)";
      params.push(ids);
    }
    const [result] = await db.query(sql, params);
    if (!result.affectedRows)
      return res.status(404).json({ error: "QR code not found" });
    res.json({ success: true, message: "QR code deleted" });
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE")
      return res.status(404).json({ error: "QR code not found" });
    console.error("Saved QR delete error:", err.message);
    res.status(500).json({ error: "Failed to delete QR code" });
  }
});

// GET /api/qr/decrypt - Decrypt restaurant token
router.get("/qr/decrypt", softAuth, (req, res) => {
  try {
    const token = req.query.rid || req.query.token;
    if (!token) {
      return res.status(400).json({ error: "Missing token" });
    }

    const decrypted = decryptRestaurantId(token);
    if (!decrypted) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    res.json({ restaurantId: decrypted });
  } catch (error) {
    res.status(500).json({ error: "Failed to decrypt token" });
  }
});

// GET /api/restaurants/share-link/:id - Generate shareable link with encrypted token
router.get("/restaurants/share-link/:id", softAuth, (req, res) => {
  try {
    const restaurantId = parseInt(req.params.id);
    if (isNaN(restaurantId)) {
      return res.status(400).json({ error: "Invalid restaurant ID" });
    }

    const encryptedToken = encryptRestaurantId(restaurantId);
    const frontendUrl =
      process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const shareLink = `${frontendUrl}/menu?rid=${encodeURIComponent(encryptedToken)}`;

    res.json({ shareLink, token: encryptedToken });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate share link" });
  }
});

module.exports = router;
