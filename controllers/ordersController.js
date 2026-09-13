// backend/controllers/ordersController.js
const db = require("../config/db");
const { sendOrderNotification } = require("../services/telegramBot");
const { broadcast } = require("../services/sse");
const { logActivity } = require("../helpers/audit");

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
    const isKhmer = restaurant.default_language === "km";

    // 🔔 Real-time SSE broadcast for new order alert
    broadcast(restId, "new-order", {
      orderId,
      tableNo: table_no.trim(),
      customerName: customer_name || null,
      items,
      total,
      note: note || null,
      createdAt: new Date(),
    });

    // Send interactive Telegram notification with inline keyboard
    if (restaurant.telegram_chat_id) {
      const sent = await sendOrderNotification(
        restaurant.telegram_chat_id,
        {
          orderId,
          restaurantName: restaurant.name,
          tableNo: table_no.trim(),
          customerName: customer_name || null,
          items,
          total,
          note: note || null,
          createdAt: new Date(),
          isKhmer,
        },
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

// GET /api/orders - Get orders for one of the owner's restaurants
exports.getAll = async (req, res) => {
  try {
    const requested = parseInt(req.query.restaurant_id || 0);
    let restaurantId = requested;
    if (!restaurantId) {
      const [first] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
        [req.user.id],
      );
      if (!first.length)
        return res.status(404).json({ error: "Restaurant not found" });
      restaurantId = first[0].id;
    } else {
      const [owned] = await db.query(
        "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
        [restaurantId, req.user.id],
      );
      if (!owned.length)
        return res
          .status(404)
          .json({ error: "Restaurant not found or not owned by you" });
    }

    const [rows] = await db.query(
      "SELECT * FROM orders WHERE restaurant_id = ? ORDER BY created_at DESC",
      [restaurantId],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/orders/stats - Get revenue and order analytics for owner's restaurant
exports.stats = async (req, res) => {
  try {
    const requested = parseInt(req.query.restaurant_id || 0);
    let restaurantId = requested;
    if (!restaurantId) {
      const [first] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
        [req.user.id],
      );
      if (!first.length)
        return res.status(404).json({ error: "Restaurant not found" });
      restaurantId = first[0].id;
    } else {
      const [owned] = await db.query(
        "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
        [restaurantId, req.user.id],
      );
      if (!owned.length)
        return res
          .status(404)
          .json({ error: "Restaurant not found or not owned by you" });
    }

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
      `SELECT id, name, logo_url AS logoUrl, default_language AS defaultLanguage,
              telegram_chat_id AS telegramChatId, telegram_link_code AS telegramLinkCode,
              theme_color AS themeColor
       FROM restaurants WHERE id = ? AND status = 'active'`,
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
    "preparing",
    "ready",
    "served",
    "cancelled",
  ];
  if (!allowedStatuses.includes(status))
    return res.status(400).json({ error: "Invalid status" });

  try {
    // Owners may only touch their own orders; super admins manage ANY order.
    if (req.user.role !== "super_admin") {
      const [order] = await db.query(
        "SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.id = ? AND r.owner_id = ?",
        [req.params.id, req.user.id],
      );
      if (!order.length)
        return res.status(404).json({ error: "Order not found" });
    }

    await db.query("UPDATE orders SET status = ? WHERE id = ?", [
      status,
      req.params.id,
    ]);

    // 🔔 Real-time SSE broadcast for order status change
    const [orderRows] = await db.query(
      "SELECT restaurant_id, table_no FROM orders WHERE id = ?",
      [req.params.id],
    );
    if (orderRows.length) {
      broadcast(orderRows[0].restaurant_id, "order-status", {
        orderId: parseInt(req.params.id),
        status,
        tableNo: orderRows[0].table_no,
      });
    }

    logActivity({
      userId: req.user.id,
      action: "order_status",
      description: `Order #${req.params.id} (table ${orderRows[0]?.table_no || "?"}) → ${status}`,
      ipAddress: req.ip,
      restaurantId: orderRows[0]?.restaurant_id,
    });

    res.json({ success: true, id: parseInt(req.params.id), status });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
