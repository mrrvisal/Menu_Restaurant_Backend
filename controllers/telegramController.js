// backend/controllers/telegramController.js
const axios = require("axios");
const db = require("../config/db");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// POST /api/telegram/webhook - Handle incoming Telegram messages
exports.webhook = async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text || !message.chat) {
    return res.sendStatus(200);
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const firstName = message.from?.first_name || "";

  try {
    if (text === "/start") {
      // Show welcome message with instructions
      const welcomeMsg = `👋 សូមស្វាគមន៍ ${firstName}!\n\n` +
        `ដើម្បីភ្ជាប់គណនីភោជនីយដ្ឋានរបស់អ្នក សូមប្រើពាក្យបញ្ជា៖\n\n` +
        `/link លេខកូដភ្ជាប់\n\n` +
        `ឧទាហរណ៍: /link ABC123\n\n` +
        `លេខកូដភ្ជាប់អាចរកបានក្នុង Admin Panel → Telegram Settings`;

      await sendTelegramMessage(chatId, welcomeMsg);
    } else if (text.startsWith("/link ")) {
      const code = text.replace("/link ", "").trim().toUpperCase();

      if (!code) {
        await sendTelegramMessage(chatId, "❌ សូមបញ្ចូលលេខកូដភ្ជាប់។ ឧ: /link ABC123");
        return res.sendStatus(200);
      }

      // Find restaurant by link code
      const [restaurants] = await db.query(
        "SELECT id, name FROM restaurants WHERE telegram_link_code = ?",
        [code],
      );

      if (!restaurants.length) {
        await sendTelegramMessage(
          chatId,
          "❌ លេខកូដនេះមិនត្រឹមត្រូវទេ។ សូមពិនិត្រ Admin Panel របស់អ្នក។",
        );
        return res.sendStatus(200);
      }

      const restaurant = restaurants[0];

      // Check if this chat_id is already linked to another restaurant
      const [existing] = await db.query(
        "SELECT id, name FROM restaurants WHERE telegram_chat_id = ? AND id != ?",
        [chatId, restaurant.id],
      );
      if (existing.length) {
        await sendTelegramMessage(
          chatId,
          `⚠️ Chat ID នេះត្រូវបានភ្ជាប់ជាមួយ "${existing[0].name}" រួចហើយ។`,
        );
        return res.sendStatus(200);
      }

      // Link the chat_id to the restaurant
      await db.query(
        "UPDATE restaurants SET telegram_chat_id = ? WHERE id = ?",
        [chatId, restaurant.id],
      );

      const successMsg = `✅ ភ្ជាប់គណនីជោគជ័យ!\n\n` +
        `🏪 ភោជនីយដ្ឋាន: ${restaurant.name}\n` +
        `🆔 Chat ID: ${chatId}\n\n` +
        `ឥឡូវនេះ អ្នកនឹងទទួលបានការជូនដំណឹងរាល់ពេលមានការកុម្ម៉ង់ថ្មី! 🎉`;

      await sendTelegramMessage(chatId, successMsg);
    } else {
      // Unknown command
      const helpMsg = `🤖 ពាក្យបញ្ជាដែលអាចប្រើបាន៖\n\n` +
        `/start - មើលការណែនាំ\n` +
        `/link លេខកូដ - ភ្ជាប់គណនីភោជនីយដ្ឋាន`;

      await sendTelegramMessage(chatId, helpMsg);
    }
  } catch (err) {
    console.error("Telegram webhook error:", err.message);
  }

  res.sendStatus(200);
};

// Helper: send message via Telegram
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not configured");
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error("Telegram send error:", err.response?.data || err.message);
  }
}

// Helper: send order notification to a specific chat_id
async function sendOrderToChat(chatId, orderText) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: orderText,
      parse_mode: "HTML",
    });
    return true;
  } catch (err) {
    console.error("Telegram send error:", err.response?.data || err.message);
    return false;
  }
}

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

// Export for use in orders controller
exports.sendOrderToChat = sendOrderToChat;