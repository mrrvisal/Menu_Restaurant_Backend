// ═══════════════════════════════════════════════════════════════
//  RATE LIMITING (audit fix #6 — no brute force, no spam)
// ───────────────────────────────────────────────────────────────
// Requires app.set("trust proxy", 1) so limits key on the REAL client
// IP (Render terminates TLS / proxies — see server.js).
// All limiters are exported as factory functions so each mounting
// point gets its own counter store.
// ═══════════════════════════════════════════════════════════════
const { rateLimit } = require("express-rate-limit");

const jsonMessage = { error: "Too many requests, please try again later." };

// Generic safety net for the whole API
const globalLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: jsonMessage,
    // Never throttle Telegram's webhook delivery: it is authenticated by
    // X-Telegram-Bot-Api-Secret-Token, and a 429 here would make Telegram
    // back off and re-send updates (duplicate/late order alerts).
    skip: (req) =>
      req.method === "POST" && req.path === "/api/telegram/webhook",
  });

// Credential endpoints — strict per-IP
const loginLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
  });

const superAdminLoginLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
  });

// Email-sending endpoints — prevents bombing / enumeration sweeping
const forgotPasswordLimiter = () =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: jsonMessage,
  });

const registerLimiter = () =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: jsonMessage,
  });

const refreshLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: jsonMessage,
  });

// Guest write endpoints — order/call spam protection (per-IP, POST only
// so owner dashboards polling GET /orders are never throttled)
const guestWriteLimiter = () =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.method !== "POST",
    message: { error: "Too many requests. Please slow down." },
  });

module.exports = {
  globalLimiter,
  loginLimiter,
  superAdminLoginLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  refreshLimiter,
  guestWriteLimiter,
};
