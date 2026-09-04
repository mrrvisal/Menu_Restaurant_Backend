// backend/middleware/auth.js
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const JWT_SECRET = process.env.JWT_SECRET || "secret";

// In-memory throttle so we don't hammer the DB with last-active updates:
// each session's activity is persisted at most once per minute.
const activityThrottle = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of activityThrottle) {
    if (now - ts > 10 * 60 * 1000) activityThrottle.delete(key);
  }
}, 5 * 60 * 1000).unref();

// Verify JWT token, attach user to request, and enforce device sessions:
// - a token carrying `sid` is rejected if its device session was revoked
//   (owner removed the device from the account)
// - the session's last_active_at is updated (throttled) so the owner can
//   see where/when each device was last used.
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

    // ── Device session enforcement (only for tokens issued with a sid) ──
    if (decoded.sid) {
      let rows = [];
      try {
        [rows] = await db.query(
          "SELECT id, revoked FROM device_sessions WHERE session_token = ? LIMIT 1",
          [decoded.sid],
        );
      } catch (e) {
        // Table not migrated yet — don't break logins, just skip checks
        rows = [];
      }
      if (rows.length && rows[0].revoked) {
        return res.status(401).json({
          error: "This device has been signed out by the account owner",
          code: "device_revoked",
        });
      }
      // Throttled "last active" heartbeat (fire-and-forget)
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
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Optional auth: attach user if token present, but don't reject if missing
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
    } catch (err) {
      // Token invalid — just continue without user
    }
  }
  next();
}


// Role-based access: require specific role(s)
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

// Super admin only
const requireSuperAdmin = requireRole("super_admin");

// Owner only
const requireOwner = requireRole("owner");

// Owner or super admin
const requireOwnerOrAdmin = requireRole("owner", "super_admin");

module.exports = {
  auth,
  softAuth,
  requireRole,
  requireSuperAdmin,
  requireOwner,
  requireOwnerOrAdmin,
};
