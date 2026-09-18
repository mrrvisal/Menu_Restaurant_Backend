// backend/controllers/ordersController.js
const db = require("../config/db");
const { sendOrderNotification } = require("../services/telegramBot");
const crypto = require("crypto");
const { broadcast, addOrderClient, emitOrder } = require("../services/sse");
const webpushSvc = require("../services/webpush");
const { logActivity } = require("../helpers/audit");
const salesReport = require("../helpers/salesReport");

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

    // A one-time token lets THIS guest follow their order on /track.
    // Self-healing: if migration v16 hasn't been applied yet (no
    // track_token column), fall back to the legacy insert so ordering
    // NEVER breaks — the order is just placed without a tracking link.
    let trackToken = crypto.randomBytes(16).toString("hex");
    let orderResult;
    try {
      [orderResult] = await db.query(
        "INSERT INTO orders (restaurant_id, table_no, note, items, total, status, customer_name, track_token) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        [
          restId,
          table_no.trim(),
          note || null,
          JSON.stringify(items),
          total,
          customer_name || null,
          trackToken,
        ],
      );
    } catch (insertErr) {
      if (insertErr?.code === "ER_BAD_FIELD_ERROR") {
        // Unknown column 'track_token' → legacy schema, no tracking link
        trackToken = null;
        [orderResult] = await db.query(
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
      } else {
        throw insertErr;
      }
    }
    const orderId = orderResult.insertId;
    const isKhmer = restaurant.default_language === "km";

    // 🔔 Real-time SSE broadcast for new order alert
    // (guarded — a broadcast failure must never fail a placed order)
    try {
      broadcast(restId, "new-order", {
        orderId,
        restaurantId: restId,
        restaurantName: restaurant.name || null,
        tableNo: table_no.trim(),
        customerName: customer_name || null,
        items,
        total,
        note: note || null,
        createdAt: new Date(),
      });
    } catch (sseErr) {
      console.error("SSE broadcast error:", sseErr?.message || sseErr);
    }

    // 📲 Web Push to the owner's devices (works even when the dashboard
    // tab is closed). Fire-and-forget — never block or fail the order.
    webpushSvc
      .sendToRestaurantOwner(restId, {
        title: `🔔 ${restaurant.name || "Digital Menu"} — New order`,
        body: `Table ${table_no.trim()}${
          customer_name ? ` · ${customer_name}` : ""
        } · ${Number(total).toLocaleString()}៛`,
        tag: `order-${orderId}`,
        url: "/dashboard",
      })
      .catch((err) => console.error("Web push error:", err.message));

    // Send interactive Telegram notification with inline keyboard
    // (guarded — if the bot is unreachable the order must still succeed)
    if (restaurant.telegram_chat_id) {
      try {
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
          await db.query(
            "UPDATE orders SET telegram_sent = TRUE WHERE id = ?",
            [orderId],
          );
        }
      } catch (tgErr) {
        console.error(
          "Telegram notify error:",
          tgErr?.message || tgErr,
        );
      }
    }

    res
      .status(200)
      .json({
        success: true,
        orderId,
        trackToken,
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

// ══════════════════════════════════════════════════════════════
//  SALES REPORTS  (dashboard metrics + Reports tab + CSV export)
//  ───────────────────────────────────────────────────────────
//  One shared builder feeds GET /orders/stats (JSON) and
//  GET /orders/export (CSV) so the screen and the downloaded file can
//  never disagree on the numbers.
// ═════════════════════════════════════════════════════════════

// Resolve which restaurant a report belongs to: the requested one when the
// caller owns it, otherwise the account's FIRST restaurant (multi-restaurant
// owners). Replies 404 itself and returns null when nothing matches.
async function resolveReportRestaurant(req, res) {
  const requested = parseInt(req.query.restaurant_id || 0);
  if (!requested) {
    const [first] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
      [req.user.id],
    );
    if (!first.length) {
      res.status(404).json({ error: "Restaurant not found" });
      return null;
    }
    return first[0].id;
  }

  const [owned] = await db.query(
    "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
    [requested, req.user.id],
  );
  if (!owned.length) {
    res.status(404).json({ error: "Restaurant not found or not owned by you" });
    return null;
  }
  return requested;
}

// Optional inclusive start_date / end_date filter (YYYY-MM-DD).
function buildOrderFilter(req, restaurantId) {
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
  return { whereClause, filters };
}

const REPORT_GROUPS = ["day", "week", "month"];
const REPORT_TYPES = [
  "summary",
  "orders",
  "series",
  "items",
  "tables",
  "hours",
  "status",
];
// Status order used by the breakdown table / CSV (matches the dashboard UI).
const STATUS_ORDER = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "served",
  "cancelled",
];
// SQL expression that buckets an order into the active period. The JS bucket
// keys from helpers/salesReport.buildBuckets mirror these exactly, so the
// zero-filled axis always lines up with the grouped rows.
const GROUP_EXPR = {
  day: "DATE_FORMAT(created_at, '%Y-%m-%d')",
  week: "YEARWEEK(created_at, 3)", // ISO-8601 year-week (e.g. 202638)
  month: "DATE_FORMAT(created_at, '%Y-%m')",
};

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Everything the Reports tab and the CSV export need for one restaurant and
// one date range.
async function buildReportData(req, restaurantId) {
  const group = REPORT_GROUPS.includes(String(req.query.group))
    ? String(req.query.group)
    : "day";
  const topLimit = Math.min(Math.max(parseInt(req.query.top_limit) || 10, 1), 50);

  const { whereClause, filters } = buildOrderFilter(req, restaurantId);
  // A sale is anything that was not cancelled — cancelled orders stay visible
  // in the status breakdown / cancelled totals, but never inflate revenue,
  // "top dishes", or the per-hour / per-table numbers.
  const salesWhere = `${whereClause} AND status <> 'cancelled'`;

  // Headline numbers in a single pass. The legacy all-status fields keep
  // their original meaning for existing callers; the net* fields exclude
  // cancelled orders.
  const [[summary]] = await db.query(
    `SELECT
       COALESCE(SUM(total), 0) AS totalRevenue,
       COUNT(*) AS totalOrders,
       COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0) AS netRevenue,
       COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN 1 ELSE 0 END), 0) AS netOrders,
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelledOrders,
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total ELSE 0 END), 0) AS cancelledRevenue
     FROM orders
     WHERE ${whereClause}`,
    filters,
  );

  // Legacy per-day series (all statuses, newest first) — same shape as before
  // so the dashboard metrics keep working untouched.
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

  // Chart / report series: NET sales grouped by day | week | month, then
  // zero-filled so quiet days still appear on the axis.
  const [seriesRows] = await db.query(
    `SELECT
       ${GROUP_EXPR[group]} AS bucket,
       COUNT(*) AS orders,
       COALESCE(SUM(total), 0) AS revenue
     FROM orders
     WHERE ${salesWhere}
     GROUP BY bucket
     ORDER BY bucket ASC`,
    filters,
  );
  const buckets = salesReport.buildBuckets(
    group,
    req.query.start_date,
    req.query.end_date,
  );
  const series = buckets.length
    ? salesReport.zeroFillSeries(seriesRows, buckets)
    : seriesRows.map((row) => ({
        key: String(row.bucket),
        label: String(row.bucket),
        orders: toNum(row.orders),
        revenue: toNum(row.revenue),
      }));
  // Status breakdown (all statuses — cancelled work stays visible)
  const [statusRows] = await db.query(
    `SELECT status, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
     FROM orders
     WHERE ${whereClause}
     GROUP BY status`,
    filters,
  );
  const byStatus = statusRows
    .map((row) => ({
      status: row.status,
      orders: toNum(row.orders),
      revenue: toNum(row.revenue),
    }))
    .sort(
      (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
    );

  // Which tables order most (net sales)
  const [tableRows] = await db.query(
    `SELECT table_no, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
     FROM orders
     WHERE ${salesWhere}
     GROUP BY table_no
     ORDER BY revenue DESC, orders DESC
     LIMIT 200`,
    filters,
  );

  // Busiest hours (net sales) — the dashboard plots these on an hour axis
  const [hourRows] = await db.query(
    `SELECT HOUR(created_at) AS hour, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
     FROM orders
     WHERE ${salesWhere}
     GROUP BY hour
     ORDER BY hour ASC`,
    filters,
  );

  // Top-selling dishes. The line items live in a JSON column, so they are
  // aggregated in JS instead of JSON_TABLE — portable across MySQL, MariaDB
  // and TiDB, and only the `items` column is pulled over the wire.
  const [itemRows] = await db.query(
    `SELECT items FROM orders WHERE ${salesWhere}`,
    filters,
  );
  const { itemsSold, top } = salesReport.aggregateTopItems(itemRows, topLimit);

  const netOrders = toNum(summary.netOrders);
  const netRevenue = toNum(summary.netRevenue);
  const bestPeriod = series.reduce(
    (acc, row) => (acc && acc.revenue >= row.revenue ? acc : row),
    null,
  );

  return {
    // ── legacy fields (unchanged meaning) ──
    totalRevenue: summary.totalRevenue,
    totalOrders: summary.totalOrders,
    daily: daily.map((row) => ({
      day: row.day,
      orders: row.orders,
      revenue: row.revenue,
    })),
    // ── report fields ──
    group,
    range: {
      startDate: req.query.start_date || null,
      endDate: req.query.end_date || null,
    },
    summary: {
      revenue: netRevenue,
      orders: netOrders,
      itemsSold,
      avgOrderValue: netOrders
        ? Math.round((netRevenue / netOrders) * 100) / 100
        : 0,
      cancelledOrders: toNum(summary.cancelledOrders),
      cancelledRevenue: toNum(summary.cancelledRevenue),
      bestPeriod: bestPeriod && bestPeriod.orders ? bestPeriod : null,
    },
    series,
    topItems: top,
    byTable: tableRows.map((row) => ({
      table_no: row.table_no,
      orders: toNum(row.orders),
      revenue: toNum(row.revenue),
    })),
    byHour: hourRows.map((row) => ({
      hour: toNum(row.hour),
      orders: toNum(row.orders),
      revenue: toNum(row.revenue),
    })),
    byStatus,
  };
}

// GET /api/orders/stats - revenue and order analytics for owner's restaurant
exports.stats = async (req, res) => {
  try {
    const restaurantId = await resolveReportRestaurant(req, res);
    if (!restaurantId) return; // 404 already sent
    res.json(await buildReportData(req, restaurantId));
  } catch (err) {
    console.error("Order stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/orders/export - download the sales report as CSV
// ?type=summary|orders|series|items|tables|hours|status  &lang=km|en
exports.exportCsv = async (req, res) => {
  try {
    const restaurantId = await resolveReportRestaurant(req, res);
    if (!restaurantId) return; // 404 already sent

    const lang = req.query.lang === "km" ? "km" : "en";
    const requested = String(req.query.type || "series").toLowerCase();
    const dataset = REPORT_TYPES.includes(requested) ? requested : "series";
    const data = await buildReportData(req, restaurantId);
    const L = salesReport.CSV_LABELS[lang];

    let rows;
    switch (dataset) {
      case "orders": {
        // Every order in the range, oldest first (kitchen / receipt order)
        const { whereClause, filters } = buildOrderFilter(req, restaurantId);
        const [orderRows] = await db.query(
          `SELECT id, table_no, status, customer_name, note, items, total,
                  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS created_at_text
           FROM orders
           WHERE ${whereClause}
           ORDER BY created_at ASC`,
          filters,
        );
        rows = orderRows.map((o) => ({
          id: o.id,
          date: o.created_at_text,
          table_no: o.table_no,
          status: salesReport.statusLabel(o.status, lang),
          customer_name: o.customer_name || "",
          note: o.note || "",
          items: salesReport.itemsSummary(o.items),
          total: toNum(o.total),
        }));
        break;
      }
      case "items":
        rows = data.topItems.map((item, i) => ({ rank: i + 1, ...item }));
        break;
      case "tables":
        rows = data.byTable;
        break;
      case "hours":
        rows = data.byHour;
        break;
      case "status":
        rows = data.byStatus.map((row) => ({
          ...row,
          status: salesReport.statusLabel(row.status, lang),
        }));
        break;
      case "summary": {
        const s = data.summary;
        rows = [
          { metric: L.net_revenue, value: s.revenue },
          { metric: L.net_orders, value: s.orders },
          { metric: L.items_sold, value: s.itemsSold },
          { metric: L.avg_order_value, value: s.avgOrderValue },
          { metric: L.cancelled_orders, value: s.cancelledOrders },
          { metric: L.cancelled_revenue, value: s.cancelledRevenue },
          { metric: L.range_start, value: data.range.startDate || "" },
          { metric: L.range_end, value: data.range.endDate || "" },
        ];
        break;
      }
      default:
        rows = data.series;
    }

    const csv = salesReport.buildCsv(
      salesReport.csvColumns(dataset, lang),
      rows,
    );
    const filename = salesReport.csvFilename(
      dataset,
      data.range.startDate,
      data.range.endDate,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("Sales export error:", err);
    res.status(500).json({ error: "Server error" });
  }
};


// GET /api/restaurants/:id - Public restaurant detail
exports.getRestaurant = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, logo_url AS logoUrl, default_language AS defaultLanguage,
              telegram_chat_id AS telegramChatId, telegram_link_code AS telegramLinkCode,
              theme_color AS themeColor,
              currency, exchange_rate AS exchangeRate
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
      `SELECT o.restaurant_id, o.table_no, r.name AS restaurant_name
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = ?`,
      [req.params.id],
    );
    if (orderRows.length) {
      broadcast(orderRows[0].restaurant_id, "order-status", {
        orderId: parseInt(req.params.id),
        restaurantId: orderRows[0].restaurant_id,
        restaurantName: orderRows[0].restaurant_name || null,
        status,
        tableNo: orderRows[0].table_no,
      });
    }

    // 🛰️ Guest tracker — live update on the per-order channel
    emitOrder(req.params.id, "status", {
      orderId: parseInt(req.params.id),
      status,
      tableNo: orderRows[0]?.table_no ?? null,
    });

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

// GET /api/orders/track?order_id=X&token=Y — PUBLIC guest order tracker (SSE)
// The guest receives a one-time track_token when the order is placed; this
// endpoint validates it, then streams live status updates for that single
// order. Token matching prevents order-id enumeration by strangers.
exports.track = async (req, res) => {
  const orderId = parseInt(req.query.order_id || 0);
  const token = String(req.query.token || "");
  if (!orderId || !token)
    return res.status(400).json({ error: "order_id and token are required" });

  try {
    const [rows] = await db.query(
      `SELECT o.id, o.status, o.table_no, o.items, o.total, o.note, o.created_at,
              r.name AS restaurant_name, r.theme_color, r.logo_url,
              r.currency, r.exchange_rate AS exchangeRate
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = ? AND o.track_token = ?`,
      [orderId, token],
    );
    if (!rows.length) return res.status(404).json({ error: "Order not found" });
    const order = rows[0];

    // SSE headers — sent before any data so EventSource can connect
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (res.flushHeaders) res.flushHeaders();

    // Initial snapshot (also acts as the first "status" event)
    const snapshot = {
      orderId: order.id,
      status: order.status,
      tableNo: order.table_no,
      items: order.items,
      total: order.total,
      note: order.note,
      createdAt: order.created_at,
      restaurantName: order.restaurant_name || null,
      themeColor: order.theme_color || null,
      logoUrl: order.logo_url || null,
      currency: order.currency || "KHR",
      exchangeRate: Number(order.exchangeRate) || 4100,
    };
    res.write(`event: status\ndata: ${JSON.stringify(snapshot)}\n\n`);

    // Live updates: ordersController.updateStatus → emitOrder()
    addOrderClient(order.id, res);

    // Heartbeat keeps idle proxies (Render/nginx) from dropping the stream
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* connection already gone */
      }
    }, 25000);
    res.on("close", () => clearInterval(heartbeat));
  } catch (err) {
    console.error("Order track error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Server error" });
  }
};
