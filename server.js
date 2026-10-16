// server.js
// ⚠️ secrets MUST be validated before anything else loads (audit fix C-3):
// every module below reads JWT_SECRET / QR_SECRET / DB_PASSWORD via
// common/config/secrets — a missing or weak value aborts the boot here.
require("./common/config/secrets");

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const {
  globalLimiter,
  loginLimiter,
  superAdminLoginLimiter,
  forgotPasswordLimiter,
  registerLimiter,
  refreshLimiter,
  guestWriteLimiter,
} = require("./common/middleware/rateLimit");

const apiRoutes = require("./routes");
const shareCardRoutes = require("./modules/share/share.routes");
const { getBot, configureWebhook } = require("./modules/telegram/telegramBot.service");
const {
  errorHandler,
  normalizeErrorResponses,
} = require("./common/middleware/errorResponse");

const app = express();
const PORT = process.env.PORT || 5001;

// Behind Render's proxy — trust the FIRST X-Forwarded-For entry so
// req.ip (audit logs, rate limiting) is the real client, not the proxy.
app.set("trust proxy", 1);

// ─── Security headers (audit fix #8) ───────────────────────────
// CSP note: the API itself serves only JSON plus the /s/menu crawler
// card (which needs an inline bounce script → 'unsafe-inline' here).
// The SPA is a separate static host and ships its own headers via
// Menu_Restaurant_Frontend/public/_headers.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" }, // kills ?token= Referer leaks (#26)
    frameguard: { action: "deny" },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  next();
});

// ─── CORS allowlist (audit fix #9 — was wide-open "*") ─────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.SHARE_ALLOWED_ORIGINS || "").split(",").filter(Boolean),
].filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      // Same-origin / server-to-server requests have no Origin header
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.includes(origin));
    },
    exposedHeaders: ["Content-Disposition"],
  }),
);

// ─── Rate limiting (audit fix #6) ──────────────────────────────
app.use("/api/auth/login/super-admin", superAdminLoginLimiter());
app.use("/api/auth/login", loginLimiter()); // mounted after /login/super-admin so it can't swallow it (prefix match)
app.use("/api/auth/forgot-password", forgotPasswordLimiter());
app.use("/api/auth/reset-password", forgotPasswordLimiter());
app.use("/api/auth/register", registerLimiter());
app.use("/api/auth/resend-verification", forgotPasswordLimiter());
app.use("/api/auth/refresh", refreshLimiter());
app.use("/api/orders", guestWriteLimiter()); // public POST /api/orders is on this prefix
app.use("/api/calls", guestWriteLimiter());
app.use(globalLimiter());

// Middlewares
app.use(normalizeErrorResponses);
app.use(express.json({ limit: "100kb" })); // audit fix #12 hardening — cap body size
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api", apiRoutes);
app.use("/s", shareCardRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});
app.use(errorHandler);


// Telegram bot lifecycle
const bot = getBot();

const stopBot = (signal) => {
  if (!bot) return;
  try {
    // In webhook mode launch() never ran — stop() is a no-op there, but must
    // never throw inside a signal handler (unhandled rejection on shutdown).
    bot.stop(signal);
  } catch (err) {
    console.warn(`Telegram bot stop (${signal}):`, err.message);
  }
};

// ────────────────────────────────────────────────────────────────
// TELEGRAM_UPDATES_MODE decides how the bot receives updates:
//   • "webhook" — Telegram pushes updates to POST /api/telegram/webhook
//     (production; needs a PUBLIC HTTPS API + TELEGRAM_WEBHOOK_URL +
//     TELEGRAM_WEBHOOK_SECRET). The webhook is (re)registered at every boot.
//   • "polling" (default) — bot.launch() pulls updates itself (localhost OK).
// Webhook mode falls back to LOUD polling when misconfigured so a missing
// env var can never silently mute the bot (Telegraf's launch() also clears
// any stale webhook before polling, so the fallback always works).
const TELEGRAM_MODE = (
  process.env.TELEGRAM_UPDATES_MODE || "polling"
).toLowerCase();

const startPolling = () => {
  bot
    .launch()
    .then(() => {
      console.log("Telegram bot started (long polling)");
    })
    .catch((err) => {
      console.error("Failed to start Telegram bot:", err.message);
    });
};

process.once("SIGINT", () => stopBot("SIGINT"));
process.once("SIGTERM", () => stopBot("SIGTERM"));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  if (!bot) return;
  if (TELEGRAM_MODE === "webhook") {
    configureWebhook()
      .then((url) => {
        console.log(`Telegram bot started (webhook → ${url})`);
      })
      .catch((err) => {
        console.error(`Telegram webhook registration FAILED: ${err.message}`);
        console.error(
          "Falling back to long polling so the bot keeps working — fix the env vars and restart.",
        );
        startPolling();
      });
  } else {
    startPolling();
  }
});
