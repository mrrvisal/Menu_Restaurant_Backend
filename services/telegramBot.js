// backend/services/telegramBot.js
// Enhanced Telegram bot using Telegraf with inline keyboards for order management

const { Telegraf, Markup } = require("telegraf");
const db = require("../config/db");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

function getBot() {
  if (bot) return bot;
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("TELEGRAM_BOT_TOKEN not configured");
    return null;
  }

  bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  // ─── COMMANDS ─────────────────────────────────────────────

  // /start - Welcome & instructions
  bot.start(async (ctx) => {
    const firstName = ctx.from?.first_name || "";
    await ctx.reply(
      `👋 សូមស្វាគមន៍មកកាន់ Digital Menu!\n\n` +
        `ដើម្បីភ្ជាប់គណនីភោជនីយដ្ឋានរបស់អ្នក សូមប្រើពាក្យបញ្ជា៖\n\n` +
        `/link លេខកូដភ្ជាប់\n\n` +
        `ឧទាហរណ៍: /link ABC123\n\n` +
        `លេខកូដភ្ជាប់អាចរកបានក្នុង Admin Panel → Telegram Settings`,
      Markup.keyboard([
        ["📋 កម្មង់ថ្មី", "📊 ស្ថិតិ"],
        ["❓ ជំនួយ"],
      ])
        .resize()
        .oneTime(),
    );
  });

  // /link <code> - Link account
  bot.command("link", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text.trim();
    const code = text.replace("/link", "").trim().toUpperCase();

    if (!code) {
      return ctx.reply("❌ សូមបញ្ចូលលេខកូដភ្ជាប់។ ឧ: /link ABC123");
    }

    try {
      const [restaurants] = await db.query(
        "SELECT id, name FROM restaurants WHERE telegram_link_code = ?",
        [code],
      );

      if (!restaurants.length) {
        return ctx.reply(
          "❌ លេខកូដនេះមិនត្រឹមត្រូវទេ។ សូមពិនិត្រ Admin Panel របស់អ្នក។",
        );
      }

      const restaurant = restaurants[0];

      // Check if this chat_id is already linked to another restaurant
      const [existing] = await db.query(
        "SELECT id, name FROM restaurants WHERE telegram_chat_id = ? AND id != ?",
        [chatId, restaurant.id],
      );
      if (existing.length) {
        return ctx.reply(
          `⚠️ Chat ID នេះត្រូវបានភ្ជាប់ជាមួយ "${existing[0].name}" រួចហើយ។`,
        );
      }

      // Link the chat_id to the restaurant
      await db.query(
        "UPDATE restaurants SET telegram_chat_id = ? WHERE id = ?",
        [chatId, restaurant.id],
      );

      await ctx.reply(
        `✅ ភ្ជាប់គណនីជោគជ័យ!\n\n` +
          `🏪 ភោជនីយដ្ឋាន: ${restaurant.name}\n` +
          `🆔 Chat ID: ${chatId}\n\n` +
          `ឥឡូវនេះ អ្នកនឹងទទួលបានការជូនដំណឹងរាល់ពេលមានការកម្មង់ថ្មី! 🎉`,
        Markup.keyboard([
          ["📋 កម្មង់ថ្មី", "📊 ស្ថិតិ"],
          ["❓ ជំនួយ"],
        ])
          .resize()
          .oneTime(),
      );
    } catch (err) {
      console.error("Link error:", err.message);
      ctx.reply("❌ មានបញ្ហាក្នុងការភ្ជាប់ សូមព្យាយាមម្តងទៀត។");
    }
  });

  // /orders - View recent orders
  bot.command("orders", async (ctx) => {
    await showRecentOrders(ctx);
  });

  // /stats - View revenue stats
  bot.command("stats", async (ctx) => {
    await showStats(ctx);
  });

  // /help - Show help
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `🤖 ពាក្យបញ្ជាដែលអាចប្រើបាន៖\n\n` +
        `/start - មើលការណែនាំ\n` +
        `/link លេខកូដ - ភ្ជាប់គណនីភោជនីយដ្ឋាន\n` +
        `/orders - មើលការកម្មង់ថ្មីៗ\n` +
        `/stats - មើលស្ថិតិប្រាក់ចំណូល\n` +
        `/help - ជំនួយ\n\n` +
        `ឬប្រើប៊ូតុងខាងក្រោម 👇`,
      Markup.keyboard([
        ["📋 កម្មង់ថ្មី", "📊 ស្ថិតិ"],
        ["❓ ជំនួយ"],
      ])
        .resize()
        .oneTime(),
    );
  });

  // ─── TEXT HANDLERS ────────────────────────────────────────

  bot.hears("📋 កម្មង់ថ្មី", async (ctx) => {
    await showRecentOrders(ctx);
  });

  bot.hears("📊 ស្ថិតិ", async (ctx) => {
    await showStats(ctx);
  });

  bot.hears("❓ ជំនួយ", async (ctx) => {
    await ctx.reply(
      `🤖 របៀបប្រើប្រាស់ Bot ៖\n\n` +
        `• ពេលមានការកម្មង់ថ្មី អ្នកនឹងទទួលបានសារជូនដំណឹង\n` +
        `• ចុចប៊ូតុងក្រោមសារដើម្បីប្តូរស្ថានភាពកម្មង់\n` +
        `• ប្រើ /orders ដើម្បីមើលកម្មង់ថ្មីៗ\n` +
        `• ប្រើ /stats ដើម្បីមើលស្ថិតិ`,
      Markup.keyboard([
        ["📋 កម្មង់ថ្មី", "📊 ស្ថិតិ"],
        ["❓ ជំនួយ"],
      ])
        .resize()
        .oneTime(),
    );
  });

  // ─── CALLBACK QUERIES (Inline keyboard actions) ──────────

  bot.action(/order_status:(.+):(.+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const newStatus = ctx.match[2];

    if (!orderId || !newStatus) {
      return ctx.answerCbQuery("❌ មិនអាចកំណត់ស្ថានភាពបានទេ");
    }

    try {
      // Verify this user owns the restaurant for this order
      const chatId = String(ctx.chat.id);
      const [orders] = await db.query(
        `SELECT o.id, o.status, r.name AS restaurant_name
         FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
         WHERE o.id = ? AND r.telegram_chat_id = ?`,
        [orderId, chatId],
      );

      if (!orders.length) {
        return ctx.answerCbQuery("❌ រកមិនឃើញកម្មង់នេះ");
      }

      const order = orders[0];
      if (order.status === newStatus) {
        return ctx.answerCbQuery(`⚠️ កម្មង់នេះស្ថានភាព "${getStatusLabel(newStatus)}" រួចហើយ`);
      }

      // Update status
      await db.query("UPDATE orders SET status = ? WHERE id = ?", [
        newStatus,
        orderId,
      ]);

      // Update the inline keyboard message
      const newKeyboard = buildOrderStatusKeyboard(orderId, newStatus);

      // Update the message text to reflect new status
      const statusLabels = {
        pending: "⏳ រង់ចាំ",
        preparing: "👨‍🍳 កំពុងរៀបចំ",
        ready: "🍽️ រួចរាល់",
        served: "✔️ បានបម្រើ",
        cancelled: "❌ បោះបង់",
      };

      const oldText = ctx.callbackQuery.message.text;
      const updatedText = oldText.replace(
        /ស្ថានភាព.*$/m,
        `ស្ថានភាព: ${statusLabels[newStatus] || newStatus}`,
      );

      try {
        await ctx.editMessageText(updatedText, {
          parse_mode: "HTML",
          ...newKeyboard,
        });
      } catch (editErr) {
        // If edit fails (e.g. message too old), just acknowledge
        console.log("Could not edit message:", editErr.message);
      }

      await ctx.answerCbQuery(`✅ ប្តូរស្ថានភាពទៅ "${getStatusLabel(newStatus)}" រួចរាល់!`);
    } catch (err) {
      console.error("Order status update error:", err.message);
      await ctx.answerCbQuery("❌ មានបញ្ហា សូមព្យាយាមម្តងទៀត");
    }
  });

  // ─── HELPERS ──────────────────────────────────────────────

  async function showRecentOrders(ctx) {
    const chatId = String(ctx.chat.id);

    try {
      // Find restaurant by chat_id
      const [restaurants] = await db.query(
        "SELECT id, name FROM restaurants WHERE telegram_chat_id = ?",
        [chatId],
      );

      if (!restaurants.length) {
        return ctx.reply(
          "⚠️ អ្នកមិនទាន់បានភ្ជាប់គណនីនៅឡើយទេ។ សូមប្រើ /link លេខកូដ ដើម្បីភ្ជាប់។",
        );
      }

      const restaurant = restaurants[0];

      const [rows] = await db.query(
        "SELECT id, table_no, customer_name, items, total, status, note, created_at FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 10",
        [restaurant.id],
      );

      if (!rows.length) {
        return ctx.reply("📭 មិនទាន់មានការកម្មង់ទេ។");
      }

      // Send first 5 orders in detail
      const showOrders = rows.slice(0, 5);
      for (const order of showOrders) {
        const items = parseItems(order.items);
        const lang = "km"; // Default to Khmer

        const statusLabels = {
          pending: "⏳ រង់ចាំ",
          preparing: "👨‍🍳 កំពុងរៀបចំ",
          ready: "🍽️ រួចរាល់",
          served: "✔️ បានបម្រើ",
          cancelled: "❌ បោះបង់",
        };

        let text =
          `🆔 កម្មង់ #${order.id}\n` +
          `🪑 តុ: ${order.table_no}\n` +
          `📅 ${formatDate(order.created_at)}\n` +
          `ស្ថានភាព: ${statusLabels[order.status] || order.status}\n`;

        if (order.customer_name) {
          text += `👤 ឈ្មោះ: ${order.customer_name}\n`;
        }

        text += `\n📋 ម្ហូប:\n`;
        items.forEach((item) => {
          text += `• ${item.name} x${item.qty} = ${(item.price * item.qty).toLocaleString()}៛\n`;
        });

        text += `\n💰 សរុប: ${Number(order.total).toLocaleString()}៛`;

        if (order.note) {
          text += `\n📝 កំណត់ចំណាំ: ${order.note}`;
        }

        await ctx.reply(text, buildOrderStatusKeyboard(order.id, order.status));
      }

      if (rows.length > 5) {
        await ctx.reply(`📊 បង្ហាញ 5 កម្មង់ចុងក្រោយក្នុងចំណោម ${rows.length} កម្មង់។`);
      }
    } catch (err) {
      console.error("Show orders error:", err.message);
      ctx.reply("❌ មានបញ្ហាក្នុងការទាញយកកម្មង់");
    }
  }

  async function showStats(ctx) {
    const chatId = String(ctx.chat.id);

    try {
      const [restaurants] = await db.query(
        "SELECT id, name FROM restaurants WHERE telegram_chat_id = ?",
        [chatId],
      );

      if (!restaurants.length) {
        return ctx.reply(
          "⚠️ អ្នកមិនទាន់បានភ្ជាប់គណនីនៅឡើយទេ។ សូមប្រើ /link លេខកូដ ដើម្បីភ្ជាប់។",
        );
      }

      const restaurantId = restaurants[0].id;

      // Today's stats
      const [[todayStats]] = await db.query(
        `SELECT
           COALESCE(SUM(total), 0) AS revenue,
           COUNT(*) AS orders
         FROM orders
         WHERE restaurant_id = ?
           AND DATE(created_at) = CURDATE()
           AND status != 'cancelled'`,
        [restaurantId],
      );

      // Weekly stats
      const [[weekStats]] = await db.query(
        `SELECT
           COALESCE(SUM(total), 0) AS revenue,
           COUNT(*) AS orders
         FROM orders
         WHERE restaurant_id = ?
           AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)
           AND status != 'cancelled'`,
        [restaurantId],
      );

      // Total stats
      const [[totalStats]] = await db.query(
        `SELECT
           COALESCE(SUM(total), 0) AS revenue,
           COUNT(*) AS orders
         FROM orders
         WHERE restaurant_id = ?
           AND status != 'cancelled'`,
        [restaurantId],
      );

      // Pending orders count
      const [[{ pending }]] = await db.query(
        "SELECT COUNT(*) AS pending FROM orders WHERE restaurant_id = ? AND status = 'pending'",
        [restaurantId],
      );

      const text = `📊 ស្ថិតិភោជនីយដ្ឋាន: ${restaurants[0].name}\n\n` +
        `📅 ថ្ងៃនេះ:\n` +
        `   💰 ចំណូល: ${Number(todayStats.revenue).toLocaleString()}៛\n` +
        `   📋 កម្មង់: ${todayStats.orders}\n\n` +
        `📆 សប្តាហ៍នេះ:\n` +
        `   💰 ចំណូល: ${Number(weekStats.revenue).toLocaleString()}៛\n` +
        `   📋 កម្មង់: ${weekStats.orders}\n\n` +
        `📊 សរុបទាំងអស់:\n` +
        `   💰 ចំណូល: ${Number(totalStats.revenue).toLocaleString()}៛\n` +
        `   📋 កម្មង់: ${totalStats.orders}\n\n` +
        `⏳ កម្មង់កំពុងរង់ចាំ: ${pending}`;

      await ctx.reply(text);
    } catch (err) {
      console.error("Show stats error:", err.message);
      ctx.reply("❌ មានបញ្ហាក្នុងការទាញយកស្ថិតិ");
    }
  }

  return bot;
}

// ─── EXPORTED HELPERS (used by ordersController) ──────────────

function buildOrderStatusKeyboard(orderId, currentStatus) {
  const statusFlow = [
    { status: "preparing", label: "👨‍🍳 រៀបចំ", emoji: "👨‍🍳" },
    { status: "ready", label: "🍽️ រួចរាល់", emoji: "🍽️" },
    { status: "served", label: "✔️ បម្រើ", emoji: "✔️" },
  ];

  // Show only allowed next statuses
  const allowedNext = getAllowedNextStatuses(currentStatus);
  const buttons = [];

  for (const action of statusFlow) {
    if (allowedNext.includes(action.status)) {
      buttons.push(
        Markup.button.callback(
          action.label,
          `order_status:${orderId}:${action.status}`,
        ),
      );
    }
  }

  // Add cancel button if pending
  if (currentStatus === "pending") {
    buttons.push(
      Markup.button.callback(
        "❌ បោះបង់",
        `order_status:${orderId}:cancelled`,
      ),
    );
  }

  return Markup.inlineKeyboard(buttons, { columns: 2 });
}

function getAllowedNextStatuses(currentStatus) {
  const flow = {
    pending: ["preparing", "cancelled"],
    preparing: ["ready"],
    ready: ["served"],
    served: [],
    cancelled: [],
  };
  return flow[currentStatus] || [];
}

function getStatusLabel(status) {
  const labels = {
    pending: "⏳ រង់ចាំ",
    preparing: "👨‍🍳 កំពុងរៀបចំ",
    ready: "🍽️ រួចរាល់",
    served: "✔️ បានបម្រើ",
    cancelled: "❌ បោះបង់",
  };
  return labels[status] || status;
}

function parseItems(items) {
  try {
    return typeof items === "string" ? JSON.parse(items) : items;
  } catch {
    return [];
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString("km-KH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── SEND INTERACTIVE ORDER NOTIFICATION ────────────────────

async function sendOrderNotification(chatId, orderData) {
  const bot = getBot();
  if (!bot || !chatId) return false;

  try {
    const {
      orderId,
      restaurantName,
      tableNo,
      customerName,
      items,
      total,
      note,
      createdAt,
      isKhmer,
    } = orderData;

    const statusLabels = {
      pending: "⏳ រង់ចាំ",
    };

    const fmtDate = (d) =>
      d.toLocaleDateString(isKhmer ? "km-KH" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    const fmtTime = (d) =>
      d.toLocaleTimeString(isKhmer ? "km-KH" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

    let text = isKhmer
      ? `🛎️ ការបញ្ជាទិញថ្មី! 🛎️\n═══════════════\n🏪ភោជនីយដ្ឋាន: ${restaurantName}\n📅 ${fmtDate(createdAt)} ${fmtTime(createdAt)}\n🪑 តុលេខ: ${tableNo}\n🆔 លេខកុម្មង់: #${orderId}\n`
      : `🛎️ New Order! 🛎️\n═══════════════\n🏪 ${restaurantName}\n📅 ${fmtDate(createdAt)} ${fmtTime(createdAt)}\n🪑 Table: ${tableNo}\n🆔 Order #${orderId}\n`;

    if (customerName) {
      text += isKhmer
        ? `👤 ឈ្មោះ: ${customerName}\n`
        : `👤 Customer: ${customerName}\n`;
    }

    text += `\n📋 ${isKhmer ? "បញ្ជីម្ហូប" : "Items"}:\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
    items.forEach((item) => {
      const sub = item.price * item.qty;
      text += `• ${item.name}\n   ${item.qty} × ${Number(item.price).toLocaleString()} = ${sub.toLocaleString()}៛\n`;
    });
    text += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n💰 ${isKhmer ? "សរុបទឹកប្រាក់" : "Total"}: ${total.toLocaleString()}៛\n`;
    text += `ស្ថានភាព: ⏳ រង់ចាំ\n`;
    if (note?.trim())
      text += `\n📝 ${isKhmer ? "កំណត់ចំណាំ" : "Note"}: ${note.trim()}\n`;

    await bot.telegram.sendMessage(
      chatId,
      text,
      buildOrderStatusKeyboard(orderId, "pending"),
    );

    return true;
  } catch (err) {
    console.error("Send order notification error:", err.message);
    return false;
  }
}

module.exports = {
  getBot,
  sendOrderNotification,
  buildOrderStatusKeyboard,
  getBotInstance: getBot,
};