// ═══════════════════════════════════════════════════════════════
//  SECRETS — fail-closed boot-time validator (audit fix C-3)
// ───────────────────────────────────────────────────────────────
// require("../config/secrets") FIRST (server.js line 1) — before any
// module that reads credentials. If a required secret is missing or
// malformed the process refuses to start, instead of silently running
// with an insecure literal like "secret".
//
// Local dev without Telegram/Brevo: provide dummy values that satisfy
// the rules (e.g. TELEGRAM_BOT_TOKEN=123456:DEV_ONLY, BREVO_API_KEY=xkeysib-dev).
// ═══════════════════════════════════════════════════════════════
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const RULES = {
  JWT_SECRET: { min: 32 },
  QR_SECRET: { min: 32 },
  DB_PASSWORD: { min: 8 },
  TELEGRAM_BOT_TOKEN: { pattern: /^\d+:[A-Za-z0-9_-]+$/ },
  BREVO_API_KEY: { pattern: /^xkeysib-/ },
  VAPID_PRIVATE_KEY: { min: 20 },
};

function validate(name, rule) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") {
    return `  • ${name} — missing`;
  }
  const v = String(value);
  if (rule.min !== undefined && v.length < rule.min) {
    return `  • ${name} — too short (min ${rule.min} chars)`;
  }
  if (rule.pattern !== undefined && !rule.pattern.test(v)) {
    return `  • ${name} — does not match required format ${rule.pattern}`;
  }
  return null;
}

const problems = Object.entries(RULES)
  .map(([name, rule]) => validate(name, rule))
  .filter(Boolean);

if (problems.length) {
  console.error(
    "\n❌ FATAL — insecure environment, refusing to start.\n" +
      "   Fix these environment variables (Render → Environment, or .env locally):\n\n" +
      problems.join("\n") +
      "\n\n   Generate strong values with:\n" +
      '     node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"   # JWT_SECRET / QR_SECRET\n' +
      "     npx web-push generate-vapid-keys                                           # VAPID_*\n\n",
  );
  process.exit(1);
}

// Frozen, validated accessors — import these instead of process.env.X || "literal"
const secrets = Object.freeze({
  JWT_SECRET: process.env.JWT_SECRET,
  QR_SECRET: process.env.QR_SECRET,
  DB_PASSWORD: process.env.DB_PASSWORD,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
});

module.exports = secrets;
module.exports.RULES = RULES;
