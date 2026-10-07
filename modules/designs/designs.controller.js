const db = require("../../config/db");
const QRCode = require("qrcode");

// ─── Menu Studio: saved designs ──────────────────────────────
// The dashboard "generate menu" page stores its whole editor state as JSON.
// These endpoints let an owner keep several named designs per restaurant and
// reopen them later. A missing table (the migration was not run yet) is
// answered gracefully so the frontend can fall back to local storage.

const MAX_DESIGN_BYTES = 60000; // generous: a full design is a few KB
const MAX_NAME_LEN = 120;

// Resolve the target restaurant and make sure the caller owns it — an owner
// may manage several restaurants, so `restaurant_id` is explicit in the body
// and falls back to the account's first restaurant (same rule as the
// categories controller).
async function resolveRestaurantId(req, raw) {
  if (raw) {
    const id = parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0)
      return { error: "Invalid restaurant ID" };
    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
      [id, req.user.id],
    );
    if (!rows.length)
      return { error: "Restaurant not found or not owned by you" };
    return { id: rows[0].id };
  }

  const [rows] = await db.query(
    "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
    [req.user.id],
  );
  if (!rows.length) return { error: "No restaurant found for this account" };
  return { id: rows[0].id };
}

// Design payload → compact JSON string (or a validation error)
function parseDesign(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "Menu design is required" };
  let json;
  try {
    json = JSON.stringify(raw);
  } catch {
    return { error: "Menu design is not valid JSON" };
  }
  if (json.length > MAX_DESIGN_BYTES)
    return { error: "Menu design is too large" };
  return { json };
}

// mysql2 already parses JSON columns, but a plain TEXT/string is tolerated too
function designOf(row) {
  if (!row) return null;
  const value = row.design;
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function shape(row) {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    template: row.template,
    size_key: row.size_key,
    design: designOf(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/menu-designs?restaurant_id=X
exports.getAll = async (req, res) => {
  try {
    const target = await resolveRestaurantId(req, req.query.restaurant_id);
    if (target.error) return res.status(400).json({ error: target.error });

    const [rows] = await db.query(
      "SELECT * FROM menu_designs WHERE restaurant_id = ? ORDER BY updated_at DESC, id DESC",
      [target.id],
    );
    res.json(rows.map(shape));
  } catch (err) {
    console.error("Get menu designs error:", err.message);
    // Migration not run yet → an empty list is a valid answer for the UI
    if (err.code === "ER_NO_SUCH_TABLE") return res.json([]);
    res.status(500).json({ error: "Failed to load designs" });
  }
};

// POST /api/menu-designs  { restaurant_id?, name, template?, size_key?, design }
exports.create = async (req, res) => {
  try {
    const target = await resolveRestaurantId(req, req.body.restaurant_id);
    if (target.error) return res.status(400).json({ error: target.error });

    const name = String(req.body.name || "").trim().slice(0, MAX_NAME_LEN);
    if (!name) return res.status(400).json({ error: "Design name is required" });

    const parsed = parseDesign(req.body.design);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const template = String(req.body.template || "classic").slice(0, 40);
    const sizeKey = String(req.body.size_key || "a4-portrait").slice(0, 40);

    // Same name already saved → overwrite it instead of failing, so the
    // "Save" button behaves like "Save (replace)" without an extra dialog.
    const [existing] = await db.query(
      "SELECT id FROM menu_designs WHERE restaurant_id = ? AND name = ? LIMIT 1",
      [target.id, name],
    );

    if (existing.length) {
      await db.query(
        "UPDATE menu_designs SET name = ?, template = ?, size_key = ?, design = ? WHERE id = ?",
        [name, template, sizeKey, parsed.json, existing[0].id],
      );
      const [updated] = await db.query(
        "SELECT * FROM menu_designs WHERE id = ?",
        [existing[0].id],
      );
      return res.json({ ...shape(updated[0]), replaced: true });
    }

    const [result] = await db.query(
      "INSERT INTO menu_designs (restaurant_id, name, template, size_key, design) VALUES (?,?,?,?,?)",
      [target.id, name, template, sizeKey, parsed.json],
    );
    const [created] = await db.query(
      "SELECT * FROM menu_designs WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ ...shape(created[0]), replaced: false });
  } catch (err) {
    console.error("Create menu design error:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE")
      return res.status(503).json({
        error: "Menu designs are not set up on this server yet",
        code: "DESIGNS_UNAVAILABLE",
      });
    res.status(500).json({ error: "Failed to save design" });
  }
};


// PATCH /api/menu-designs/:id  { name?, template?, size_key?, design? }
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT d.id, d.name, d.template, d.size_key FROM menu_designs d JOIN restaurants r ON r.id = d.restaurant_id WHERE d.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Design not found" });

    let json = null;
    if (req.body.design !== undefined) {
      const parsed = parseDesign(req.body.design);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      json = parsed.json;
    }

    const name =
      req.body.name === undefined
        ? rows[0].name
        : String(req.body.name || "").trim().slice(0, MAX_NAME_LEN);
    if (!name) return res.status(400).json({ error: "Design name is required" });

    const template =
      req.body.template === undefined
        ? rows[0].template
        : String(req.body.template || "").slice(0, 40) || rows[0].template;
    const sizeKey =
      req.body.size_key === undefined
        ? rows[0].size_key
        : String(req.body.size_key || "").slice(0, 40) || rows[0].size_key;

    await db.query(
      `UPDATE menu_designs SET
         name = ?, template = ?, size_key = ?,
         design = COALESCE(?, design)
       WHERE id = ?`,
      [name, template, sizeKey, json, req.params.id],
    );

    const [updated] = await db.query(
      "SELECT * FROM menu_designs WHERE id = ?",
      [req.params.id],
    );
    res.json(shape(updated[0]));
  } catch (err) {
    console.error("Update menu design error:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE")
      return res.status(503).json({
        error: "Menu designs are not set up on this server yet",
        code: "DESIGNS_UNAVAILABLE",
      });
    res.status(500).json({ error: "Failed to save design" });
  }
};

// DELETE /api/menu-designs/:id
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT d.id FROM menu_designs d JOIN restaurants r ON r.id = d.restaurant_id WHERE d.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Design not found" });

    await db.query("DELETE FROM menu_designs WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Design deleted" });
  } catch (err) {
    console.error("Delete menu design error:", err.message);
    if (err.code === "ER_NO_SUCH_TABLE")
      return res.status(503).json({
        error: "Menu designs are not set up on this server yet",
        code: "DESIGNS_UNAVAILABLE",
      });
    res.status(500).json({ error: "Failed to delete design" });
  }
};

// POST /api/menu-designs/qr  { url, dark?, light? }
// A small QR image (data URL) that the generated menu prints in its footer:
// "scan to open the live menu". Reuses the table-QR helper so the restaurant
// logo sits in the middle, exactly like the table cards.
exports.qr = async (req, res) => {
  try {
    const url = String(req.body.url || req.query.url || "").trim();
    if (!/^https?:\/\//i.test(url) || url.length > 2000)
      return res.status(400).json({ error: "A valid url is required" });

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
    const darkColor = hex.test(req.body.dark || "") ? req.body.dark : "#1f2937";
    const lightColor = hex.test(req.body.light || "")
      ? req.body.light
      : "#ffffff";

    const target = await resolveRestaurantId(req, req.query.restaurant_id);
    if (target.error) return res.status(403).json({ error: target.error });

    const buffer = await QRCode.toBuffer(url, {
      type: "png",
      width: 360,
      margin: 2,
      color: { dark: darkColor, light: lightColor },
      errorCorrectionLevel: "M",
    });

    res.json({ qrCode: `data:image/png;base64,${buffer.toString("base64")}` });
  } catch (err) {
    console.error("Menu design QR error:", err.message);
    res.status(500).json({ error: "Could not build the QR code" });
  }
};
