const {
  getBot,
  configureWebhook,
  handleWebhookUpdate,
} = require("./telegramBot.service");

// POST /api/telegram/webhook — Telegram pushes updates here (webhook mode).
// Hardened (audit fix #5): requests must carry X-Telegram-Bot-Api-Secret-Token
// matching TELEGRAM_WEBHOOK_SECRET (Telegram sends it because the webhook is
// registered with `secret_token`). The endpoint is public, so without a
// server-side secret configured we fail CLOSED — never accept unauthenticated
// updates. A 403 is not retried by Telegram; forged requests just die here.
exports.webhook = async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.get("x-telegram-bot-api-secret-token") !== secret) {
    return res.sendStatus(403);
  }
  if (!req.body || typeof req.body !== "object") {
    return res.sendStatus(400); // not a Telegram update — no retry
  }
  try {
    await handleWebhookUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    // 5xx → Telegram re-delivers later. Handlers do DB work + sendMessage;
    // a transient failure (DB blip, network) must not drop an order alert.
    console.error("Telegram webhook update error:", err.message);
    res.sendStatus(500);
  }
};

// GET /api/telegram/set-webhook (super-admin only — see telegram.routes.js)
exports.setWebhook = async (req, res) => {
  // #5 (High): the URL is NEVER derived from the Host header any more —
  // Host-header injection used to re-point the bot's webhook at an
  // attacker's server (they would receive every update, incl. link codes).
  // configureWebhook() reads TELEGRAM_WEBHOOK_URL, requires https:// plus
  // TELEGRAM_WEBHOOK_SECRET, and registers allowed_updates + secret_token.
  try {
    const webhookUrl = await configureWebhook();
    res.json({ success: true, webhookUrl });
  } catch (err) {
    console.error("Set webhook error:", err.message);
    if (err.code === "ECONFIG") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Failed to set webhook" });
  }
};

// GET /api/telegram/delete-webhook (super-admin only)
exports.deleteWebhook = async (req, res) => {
  const bot = getBot();
  if (!bot) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
  }

  try {
    const result = await bot.telegram.deleteWebhook();
    res.json({ success: true, telegramResponse: result });
  } catch (err) {
    console.error("Delete webhook error:", err.message);
    res.status(500).json({ error: "Failed to delete webhook" });
  }
};
