// backend/controllers/ordersController.js
const axios = require("axios");

// POST /api/orders - Send order to Telegram only (no DB storage)
exports.create = async (req, res) => {
  const { table_no, note, items } = req.body;

  // Validation
  if (!table_no || !table_no.trim()) {
    return res.status(400).json({ error: "Table number is required" });
  }

  if (!items || !items.length) {
    return res.status(400).json({ error: "Order items are required" });
  }

  // Get Telegram config from environment variables
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Telegram credentials not configured");
    return res.status(500).json({ error: "Telegram not configured" });
  }

  // Build order message
  let orderText = `🛎️ **NEW ORDER** 🛎️\n\n`;
  orderText += `📅 ${new Date().toLocaleString("en-US", { hour12: false })}\n`;
  orderText += `🪑 **Table:** ${table_no.trim()}\n`;
  orderText += `━ ━ ━ ━ ━ ━ ━ ━ ━\n`;
  orderText += `📋 **Order Details:**\n`;

  let total = 0;
  items.forEach((item, idx) => {
    const subtotal = item.price * item.qty;
    total += subtotal;
    orderText += `${idx + 1}. ${item.name} × ${item.qty} = ${subtotal.toFixed(2)}៛\n`;
  });

  orderText += `━ ━ ━ ━ ━ ━ ━ ━ ━\n`;
  orderText += `💰 **Total:** ${total.toFixed(2)}៛\n`;

  if (note && note.trim()) {
    orderText += `\n📝 **Note:** ${note.trim()}\n`;
  }

  orderText += `\n✅ Please prepare this order.`;

  try {
    // Send to Telegram
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: orderText,
      parse_mode: "Markdown",
    });

    res.status(200).json({
      success: true,
      message: "Order sent to kitchen successfully!",
    });
  } catch (error) {
    console.error(
      "Telegram send error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      error: "Failed to send order to kitchen",
      message: error.response?.data?.description || "Please try again",
    });
  }
};
