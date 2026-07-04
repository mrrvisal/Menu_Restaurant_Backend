// backend/controllers/ordersController.js
const db = require("../config/db");
const { sendOrderToChat } = require("./telegramController");

// POST /api/orders - Place order (guest)
exports.create = async (req, res) => {
  const { table_no, note, items, restaurant_id, customer_name } = req.body;

  if (!table_no || !table_no.trim())
    return res.status(400).json({ error: "Table number is required" });
  if (!items || !items.length)
    return res.status(400).json({ error: "Order items are required" });

  // Determine restaurant_id
  let restId = null;
  if (restaurant_id) restId = parseInt(restaurant_id);
  else restId = 1;

  let total = 0;
  items.forEach((item) => {
    total += item.price * item.qty;
  });

  try {
    const [restaurants] = await db.query(
      "SELECT id, name, telegram_chat_id, default_language FROM restaurants WHERE id = ?",
      [restId],
    );
    if (!restaurants.length)
      return res.status(404).json({ error: "Restaurant not found" });
    const restaurant = restaurants[0];

    const [orderResult] = await db.query(
      "INSERT INTO orders (restaurant_id, table_no, note, items, total, status, customer_name) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [
        restId,
        table_no.trim(),
        note || null,
        JSON.stringify(items),
        total,
        customer_name || null,
      ],
    );
    const orderId = orderResult.insertId;

    // Build Telegram message
    const now = new Date();
    const isKhmer = restaurant.default_language === "km";
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

    let orderText = isKhmer
      ? `🛎️ ការបញ្ជាទិញថ្មី 🛎️\n═══════════════\n🏪 ${restaurant.name}\n📅 ${fmtDate(now)} ${fmtTime(now)}\n🪑 តុលេខ: ${table_no.trim()}\n🆔 លេខកុម្មង់: #${orderId}\n`
      : `🛎️ New Order 🛎️\n═══════════════\n🏪 ${restaurant.name}\n📅 ${fmtDate(now)} ${fmtTime(now)}\n🪑 Table: ${table_no.trim()}\n🆔 Order #${orderId}\n`;

    if (customer_name)
      orderText += isKhmer
        ? `👤 ឈ្មោះ: ${customer_name}\n`
        : `👤 Customer: ${customer_name}\n`;

    orderText += `\n📋 ${isKhmer ? "បញ្ជីម្ហូប" : "Items"}:\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
    items.forEach((item) => {
      const sub = item.price * item.qty;
      orderText += `=> ${item.name}\n   ${item.qty} × ${Number(item.price).toLocaleString()} = ${sub.toLocaleString()}៛\n`;
    });
    orderText += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n💰 ${isKhmer ? "សរុបទឹកប្រាក់" : "Total"}: ${total.toLocaleString()}៛\n`;
    if (note?.trim())
      orderText += `\n📝 ${isKhmer ? "កំណត់ចំណាំ" : "Note"}: ${note.trim()}\n`;
    orderText += `\n✅ ${isKhmer ? "សូមរៀបចំម្ហូបនេះផង!" : "Please prepare this order!"}`;

    // Send to Telegram
    if (restaurant.telegram_chat_id) {
      const sent = await sendOrderToChat(
        restaurant.telegram_chat_id,
        orderText,
      );
      if (sent) {
        await db.query("UPDATE orders SET telegram_sent = TRUE WHERE id = ?", [
          orderId,
        ]);
      }
    }

    res
      .status(200)
      .json({
        success: true,
        orderId,
        message: isKhmer
          ? "ការបញ្ជាទិញបានជោគជ័យ!"
          : "Order placed successfully!",
      });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Failed to place order" });
  }
};

// GET /api/orders - Get orders for owner's restaurant
exports.getAll = async (req, res) => {
  try {
    const [restaurant] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ?",
      [req.user.id],
    );
    if (!restaurant.length)
      return res.status(404).json({ error: "Restaurant not found" });

    const [rows] = await db.query(
      "SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC",
      [restaurant[0].id],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/orders/stats - Get revenue and order analytics for owner's restaurant
exports.stats = async (req, res) => {
  try {
    const [restaurant] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ?",
      [req.user.id],
    );
    if (!restaurant.length)
      return res.status(404).json({ error: "Restaurant not found" });
    const restaurantId = restaurant[0].id;

    const filters = [restaurantId];
    let whereClause = "restaurant_id = ?";

    if (req.query.start_date) {
      whereClause += " AND created_at >= ?";
      filters.push(`${req.query.start_date} 00:00:00`);
    }
    if (req.query.end_date) {
      whereClause += " AND created_at <= ?";
      filters.push(`${req.query.end_date} 23:59:59`);
    }

    const [[summary]] = await db.query(
      `SELECT
         COALESCE(SUM(total), 0) AS totalRevenue,
         COUNT(*) AS totalOrders
       FROM orders
       WHERE ${whereClause}`,
      filters,
    );

    const [daily] = await db.query(
      `SELECT
         DATE(created_at) AS day,
         COUNT(*) AS orders,
         COALESCE(SUM(total), 0) AS revenue
       FROM orders
       WHERE ${whereClause}
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) DESC`,
      filters,
    );

    res.json({
      totalRevenue: summary.totalRevenue,
      totalOrders: summary.totalOrders,
      daily: daily.map((row) => ({
        day: row.day,
        orders: row.orders,
        revenue: row.revenue,
      })),
    });
  } catch (err) {
    console.error("Order stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/restaurants/:id - Public restaurant detail
exports.getRestaurant = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, logo_url, default_language FROM restaurants WHERE id = ? AND status = 'active'",
      [req.params.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Restaurant not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Get restaurant error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// PATCH /api/orders/:id/status
exports.updateStatus = async (req, res) => {
  const { status } = req.body;
  const allowedStatuses = [
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "served",
    "cancelled",
  ];
  if (!allowedStatuses.includes(status))
    return res.status(400).json({ error: "Invalid status" });

  try {
    const [order] = await db.query(
      "SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!order.length)
      return res.status(404).json({ error: "Order not found" });

    await db.query("UPDATE orders SET status = ? WHERE id = ?", [
      status,
      req.params.id,
    ]);
    res.json({ success: true, id: parseInt(req.params.id), status });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
