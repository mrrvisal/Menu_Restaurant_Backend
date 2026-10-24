const jwt = require("jsonwebtoken");
const db = require("../../config/db");
// C-3: validated at boot — no `|| "secret"` fallback anywhere
const { JWT_SECRET } = require("../config/secrets");
const THROTTLE_TTL = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// In-memory throttle for device last-active updates (persisted at most once per minute)
const activityThrottle = new Map();
let inactivityCleanupRunning = false;

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of activityThrottle) {
    if (now - ts > THROTTLE_TTL) {
      activityThrottle.delete(key);
    }
  }
}, CLEANUP_INTERVAL).unref();

setInterval(async () => {
  if (inactivityCleanupRunning) return;
  inactivityCleanupRunning = true;
  try {
    await db.query(
      `UPDATE device_sessions ds
       JOIN users u ON u.id = ds.user_id
       SET ds.revoked = 1, ds.revoked_at = NOW()
       WHERE ds.revoked = 0
         AND COALESCE(ds.last_active_at, ds.last_login_at, ds.created_at)
             < DATE_SUB(NOW(), INTERVAL u.inactive_session_days DAY)`,
    );
  } catch (err) {
    console.error("Inactive device-session cleanup failed:", err.message);
  } finally {
    inactivityCleanupRunning = false;
  }
}, CLEANUP_INTERVAL).unref();

// Verify JWT token, attach user, and enforce active device session
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      sid: decoded.sid || null,
    };

    // Device session enforcement
    if (decoded.sid) {
      let rows = [];
      try {
        [rows] = await db.query(
          "SELECT id, revoked FROM device_sessions WHERE session_token = ? LIMIT 1",
          [decoded.sid],
        );
      } catch (_) {
        rows = [];
      }

      if (rows.length && rows[0].revoked) {
        return res.status(401).json({
          error: "This device has been signed out by the account owner",
          code: "device_revoked",
        });
      }

      // Throttled heartbeat (fire-and-forget)
      const now = Date.now();
      const last = activityThrottle.get(decoded.sid) || 0;
      if (now - last > 60 * 1000) {
        activityThrottle.set(decoded.sid, now);
        db.query(
          "UPDATE device_sessions SET last_active_at = NOW() WHERE session_token = ?",
          [decoded.sid],
        ).catch(() => {});
      }
    }

    next();
  } catch (err) {
    if (err && err.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Session expired",
        code: "token_expired",
      });
    }

    return res.status(401).json({
      error: "Invalid or expired token",
      code: "token_invalid",
    });
  }
}

// Optional auth: attach user if token exists, continue if not
function softAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.split(" ")[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        sid: decoded.sid || null,
      };
    } catch (_) {
      // Ignore invalid token in soft auth
    }
  }
  next();
}

// Role-based authorization
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "You do not have permission to perform this action" });
    }
    next();
  };
}

const requireSuperAdmin = requireRole("super_admin");
const requireOwner = requireRole("owner");
const requireOwnerOrAdmin = requireRole("owner", "super_admin");

module.exports = {
  auth,
  softAuth,
  requireRole,
  requireSuperAdmin,
  requireOwner,
  requireOwnerOrAdmin,
};
