// backend/helpers/salesReport.js
// ─────────────────────────────────────────────────────────────
// Pure helpers behind the Sales reports screen (dashboard tab):
//   • period buckets for daily / weekly / monthly revenue series
//   • top-selling dish aggregation from the orders.items JSON column
//   • CSV building (Excel-friendly: UTF-8 BOM, CRLF, quoted fields)
//
// Nothing here touches the database or Express, so every function can be
// unit-tested directly (see the checks documented in the README section).
// ─────────────────────────────────────────────────────────────

const BOM = "\uFEFF";
const MAX_BUCKETS = 400; // safety cap for very wide ranges (≈13 months of days)

function pad2(n) {
  return String(n).padStart(2, "0");
}

// ─── CSV ────────────────────────────────────────────────────
// A value that starts with one of these is treated as a FORMULA by Excel /
// Google Sheets, so it gets neutralised with a leading apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_START.test(s) && !NUMERIC.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// columns: [{ key, label }] — rows: [{ key: value }]
function buildCsv(columns, rows) {
  const head = columns.map((c) => csvEscape(c.label)).join(",");
  const body = (rows || [])
    .map((row) => columns.map((c) => csvEscape(row[c.key])).join(","))
    .join("\r\n");
  return BOM + head + "\r\n" + (body ? body + "\r\n" : "");
}

// Localised column headers / metric names for the exported CSV files.
const CSV_LABELS = {
  en: {
    period: "Period",
    orders: "Orders",
    revenue: "Revenue",
    rank: "Rank",
    item: "Dish",
    qty: "Qty sold",
    table: "Table",
    hour: "Hour",
    status: "Status",
    id: "Order #",
    date: "Date",
    customer: "Customer",
    note: "Note",
    items: "Items",
    total: "Total",
    metric: "Metric",
    value: "Value",
    restaurant: "Restaurant",
    range_start: "From",
    range_end: "To",
    net_revenue: "Revenue (excl. cancelled)",
    net_orders: "Orders (excl. cancelled)",
    items_sold: "Items sold",
    avg_order_value: "Average order value",
    cancelled_orders: "Cancelled orders",
    cancelled_revenue: "Cancelled amount",
    status_pending: "Pending",
    status_confirmed: "Confirmed",
    status_preparing: "Preparing",
    status_ready: "Ready",
    status_served: "Served",
    status_cancelled: "Cancelled",
  },
  km: {
    period: "រយៈពេល",
    orders: "ការកម្មង់",
    revenue: "ចំណូល",
    rank: "លំដាប់",
    item: "មុខម្ហូប",
    qty: "ចំនួនលក់",
    table: "តុ",
    hour: "ម៉ោង",
    status: "ស្ថានភាព",
    id: "លេខកម្មង់",
    date: "កាលបរិច្ឆេទ",
    customer: "អតិថិជន",
    note: "ចំណាំ",
    items: "មុខម្ហូប",
    total: "សរុប",
    metric: "ចំណុច",
    value: "តម្លៃ",
    restaurant: "ភោជនីយដ្ឋាន",
    range_start: "ចាប់ផ្តើម",
    range_end: "បញ្ចប់",
    net_revenue: "ចំណូលសុទ្ធ (មិនរាប់បោះបង់)",
    net_orders: "ការកម្មង់ (មិនរាប់បោះបង់)",
    items_sold: "ចំនួនមុខម្ហូបដែលលក់បាន",
    avg_order_value: "តម្លៃកម្មង់មធ្យម",
    cancelled_orders: "កម្មង់បោះបង់",
    cancelled_revenue: "ទឹកប្រាក់កម្មង់បោះបង់",
    status_pending: "រង់ចាំ",
    status_confirmed: "បានបញ្ជាក់",
    status_preparing: "កំពុងរៀបចំ",
    status_ready: "រួចរាល់",
    status_served: "បានបម្រើ",
    status_cancelled: "បោះបង់",
  },
};

// Column definition per export dataset. `lang` is "km" | "en".
function csvColumns(dataset, lang) {
  const L = CSV_LABELS[lang === "km" ? "km" : "en"];
  switch (dataset) {
    case "orders":
      return [
        { key: "id", label: L.id },
        { key: "date", label: L.date },
        { key: "table_no", label: L.table },
        { key: "status", label: L.status },
        { key: "customer_name", label: L.customer },
        { key: "note", label: L.note },
        { key: "items", label: L.items },
        { key: "total", label: L.total },
      ];
    case "items":
      return [
        { key: "rank", label: L.rank },
        { key: "name", label: L.item },
        { key: "qty", label: L.qty },
        { key: "revenue", label: L.revenue },
      ];
    case "tables":
      return [
        { key: "table_no", label: L.table },
        { key: "orders", label: L.orders },
        { key: "revenue", label: L.revenue },
      ];
    case "hours":
      return [
        { key: "hour", label: L.hour },
        { key: "orders", label: L.orders },
        { key: "revenue", label: L.revenue },
      ];
    case "status":
      return [
        { key: "status", label: L.status },
        { key: "orders", label: L.orders },
        { key: "revenue", label: L.revenue },
      ];
    case "summary":
      return [
        { key: "metric", label: L.metric },
        { key: "value", label: L.value },
      ];
    case "series":
    default:
      return [
        { key: "label", label: L.period },
        { key: "orders", label: L.orders },
        { key: "revenue", label: L.revenue },
      ];
  }
}

// Human label for an order status (used in the exported detail rows).
function statusLabel(status, lang) {
  const key = `status_${String(status || "").toLowerCase()}`;
  const table = CSV_LABELS[lang === "km" ? "km" : "en"];
  return table[key] || status || "";
}

function csvFilename(dataset, startDate, endDate) {
  const safe = (s) => String(s || "all").replace(/[^0-9A-Za-z_-]/g, "");
  return `sales-${dataset}-${safe(startDate)}_${safe(endDate)}.csv`;
}

// ─── Order items JSON ───────────────────────────────────────
// mysql2 usually hands back the JSON column already parsed, but a raw string
// (or an object wrapper) is possible depending on the driver/gateway — accept
// all of them so a report never breaks on odd data.
function parseItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === "object") return Array.isArray(raw.items) ? raw.items : [];
  return [];
}

// "2× Fried Rice, 1× Soup" — one line for the exported order rows.
function itemsSummary(raw) {
  return parseItems(raw)
    .map((it) => {
      const name = String(it?.name ?? it?.food_name ?? "").trim();
      const qty = Number(it?.qty ?? it?.quantity ?? 0) || 0;
      return `${qty}× ${name}`;
    })
    .join(", ");
}

// Aggregate the `items` JSON of every order into per-dish totals.
// Returns { itemsSold, top: [{ name, qty, revenue }] } sorted by qty desc.
function aggregateTopItems(orderRows, limit = 10) {
  const map = new Map();
  let itemsSold = 0;

  for (const row of orderRows || []) {
    for (const it of parseItems(row.items)) {
      const name = String(it?.name ?? it?.food_name ?? "").trim() || "—";
      const qty = Number(it?.qty ?? it?.quantity ?? 0) || 0;
      const price = Number(it?.price ?? 0) || 0;
      if (qty <= 0) continue;

      itemsSold += qty;
      const entry = map.get(name) || { name, qty: 0, revenue: 0 };
      entry.qty += qty;
      entry.revenue += price * qty;
      map.set(name, entry);
    }
  }

  const top = [...map.values()]
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, Math.max(1, limit));

  return { itemsSold, top };
}

// ─── Period buckets (daily / weekly / monthly series) ───────
function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function ymd(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

// ISO-8601 year-week as year*100 + week — the exact value MySQL's
// YEARWEEK(date, 3) returns, so JS-generated (zero-filled) buckets join
// perfectly with the SQL-grouped rows.
function isoYearWeek(date) {
  const t = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = t.getUTCDay() || 7; // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // → Thursday of that ISO week
  const isoYear = t.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return isoYear * 100 + week;
}

// Monday 00:00 UTC of the ISO week containing `date`
function isoWeekStart(date) {
  const t = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (dayNum - 1));
  return t;
}

function weekLabel(key) {
  return `${Math.floor(key / 100)}-W${pad2(key % 100)}`;
}

// Every bucket between two YYYY-MM-DD dates (inclusive) for a group.
// Bucket keys match what the SQL GROUP BY expressions produce.
function buildBuckets(group, startDate, endDate) {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (!start || !end || start > end) return [];

  const buckets = [];
  const cur =
    group === "week"
      ? isoWeekStart(start)
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  if (group === "day") cur.setUTCDate(start.getUTCDate());

  while (cur <= end && buckets.length < MAX_BUCKETS) {
    if (group === "day") {
      const key = ymd(cur);
      buckets.push({ key, label: key });
      cur.setUTCDate(cur.getUTCDate() + 1);
    } else if (group === "week") {
      const key = String(isoYearWeek(cur));
      buckets.push({ key, label: weekLabel(Number(key)) });
      cur.setUTCDate(cur.getUTCDate() + 7);
    } else {
      const key = `${cur.getUTCFullYear()}-${pad2(cur.getUTCMonth() + 1)}`;
      buckets.push({ key, label: key });
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }
  return buckets;
}

// Merge SQL rows ({ bucket, orders, revenue }) onto the bucket list so the
// chart/CSV shows a continuous axis with real zeros for quiet periods.
function zeroFillSeries(rows, buckets) {
  const byKey = new Map();
  for (const r of rows || []) {
    byKey.set(String(r.bucket ?? r.key), r);
  }
  return (buckets || []).map((b) => {
    const hit = byKey.get(String(b.key));
    return {
      key: b.key,
      label: b.label,
      orders: hit ? Number(hit.orders) || 0 : 0,
      revenue: hit ? Number(hit.revenue) || 0 : 0,
    };
  });
}

module.exports = {
  BOM,
  MAX_BUCKETS,
  csvEscape,
  buildCsv,
  csvColumns,
  csvFilename,
  statusLabel,
  CSV_LABELS,
  pad2,
  parseItems,
  itemsSummary,
  aggregateTopItems,
  parseYmd,
  ymd,
  isoYearWeek,
  isoWeekStart,
  buildBuckets,
  zeroFillSeries,
};

