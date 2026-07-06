// backend/controllers/telegramController.js
// Legacy webhook handler - Bot now uses long polling via services/telegramBot.js
// These endpoints are kept for webhook management (set/delete)

const axios = require("axios");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// POST /api/telegram/webhook - Legacy webhook handler (kept for compatibility)
// The bot now uses long polling via Telegraf in services/telegramBot.js
exports.webhook = async (req, res) => {
  // Just acknowledge - the bot handles messages via long polling
  res.sendStatus(200);
};

// GET /api/telegram/set-webhook - Set the webhook URL (admin)
exports.setWebhook = async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
  }
  try {
    const host = req.get("host");
    const protocol = req.protocol;
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`;
    const response = await axios.post(url, { url: webhookUrl });

    res.json({
      success: true,
      webhookUrl,
      telegramResponse: response.data,
    });
  } catch (err) {
    console.error("Set webhook error:", err.message);
    res.status(500).json({ error: "Failed to set webhook" });
  }
};

// GET /api/telegram/delete-webhook - Delete the webhook (admin)
exports.deleteWebhook = async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`;
    const response = await axios.post(url);
    res.json({ success: true, telegramResponse: response.data });
  } catch (err) {
    console.error("Delete webhook error:", err.message);
    res.status(500).json({ error: "Failed to delete webhook" });
  }
};