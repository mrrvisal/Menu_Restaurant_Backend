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

  // FIX 1: Define helper functions for date/time formatting
  const now = new Date();
  const fmtDate = (d) =>
    d.toLocaleDateString("km-KH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const fmtTime = (d) =>
    d.toLocaleTimeString("km-KH", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

  // FIX 2: Calculate total before building the message
  let total = 0;
  items.forEach((item) => {
    total += item.price * item.qty;
  });

  // Build order message
  // FIX 3: Renamed variable consistently to `orderText`
  let orderText = "";
  orderText +=    `🛎️ ការបញ្ជាទិញថ្មី 🛎️ \n`;
  orderText +=    `═══════════════\n`;
  orderText += `📅 ${fmtDate(now)}  ${fmtTime(now)}\n`;
  orderText += `🪑 តុលេខ: ${table_no.trim()}\n\n`;
  orderText += `📋 បញ្ជីម្ហូប:\n`;
  orderText += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
  items.forEach((item, n) => {
    const sub = item.price * item.qty;
    orderText += `=> ${item.name}\n`;
    orderText += `   ${item.qty} × ${item.price.toLocaleString()} = ${sub.toLocaleString()}៛\n`;
  });
  orderText += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
  orderText += `💰 សរុបទឹកប្រាក់: ${total.toLocaleString()}៛\n`;
  if (note?.trim()) orderText += `\n📝 កំណត់ចំណាំ: ${note.trim()}\n`;
  orderText += `\n✅ សូមរៀបចំម្ហូបនេះផង!`;

  try {
    // Send to Telegram
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(telegramUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: orderText,
      // FIX 4: Use MarkdownV2 or plain HTML — plain "Markdown" causes issues
      // with special chars like `.` `(` `)` in Khmer text. Switch to HTML:
      parse_mode: "HTML",
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
