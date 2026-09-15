// backend/controllers/categoriesController.js
const db = require("../config/db");

// Helper: get restaurant_id for public requests
async function getRestaurantId(req) {
  if (req.query.restaurant_id) return parseInt(req.query.restaurant_id);
  if (req.user) {
    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
      [req.user.id],
    );
    if (rows.length) return rows[0].id;
  }
  return 1; // Default
}

// GET /api/categories?restaurant_id=X&menu_id=Y
exports.getAll = async (req, res) => {
  try {
    const restaurantId = await getRestaurantId(req);
    const { menu_id } = req.query;

    let sql =
      "SELECT id, restaurant_id, menu_id, name FROM categories WHERE restaurant_id = ?";
    const params = [restaurantId];
    if (menu_id) {
      sql += " AND menu_id = ?";
      params.push(menu_id);
    }
    sql += " ORDER BY id ASC";

    let [rows] = await db.query(sql, params);

    // Public menu pages fetch WITHOUT menu_id, so every category row across
    // the restaurant's menus comes back — and the same name may exist more
    // than once (created under different menus / by the older bug that wrote
    // new categories into the first restaurant). Collapse them into ONE entry
    // per unique name so the customer-facing tabs never show duplicates.
    // Rows arrive ordered by id ASC, so the first occurrence (lowest id) wins.
    if (!menu_id) {
      const seen = new Set();
      rows = rows.filter((cat) => {
        const key = String(cat.name || "").trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const result = rows.map((cat) => ({
      id: cat.id,
      restaurant_id: cat.restaurant_id,
      menu_id: cat.menu_id,
      label_km: cat.name,
      label: cat.name,
    }));

    res.json(result);
  } catch (err) {
    console.error("Categories error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// POST /api/categories
exports.create = async (req, res) => {
  try {
    const name = req.body.name || req.body.label_km;
    let menuId = req.body.menu_id || null;

    if (!name)
      return res.status(400).json({ error: "Category name is required" });

    // Scope the category to the restaurant selected in the dashboard. The
    // client sends `restaurant_id`; without it the backend would fall back to
    // the account's FIRST restaurant, so creating a category while another
    // restaurant was selected wrote it to the wrong one.
    let restaurantId = null;
    if (req.body.restaurant_id) {
      const [owned] = await db.query(
        "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
        [parseInt(req.body.restaurant_id), req.user.id],
      );
      if (!owned.length)
        return res
          .status(404)
          .json({ error: "Restaurant not found or not owned by you" });
      restaurantId = owned[0].id;
    } else {
      const [rows] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
        [req.user.id],
      );
      if (!rows.length)
        return res.status(404).json({ error: "Restaurant not found" });
      restaurantId = rows[0].id;
    }

    // If a menu_id is given, make sure it belongs to THIS restaurant (and
    // that the restaurant is owned by the caller) — otherwise the category
    // would be attached to a menu from a different restaurant.
    if (menuId) {
      const [menu] = await db.query(
        "SELECT m.id FROM menus m JOIN restaurants r ON r.id = m.restaurant_id WHERE m.id = ? AND m.restaurant_id = ? AND r.owner_id = ?",
        [menuId, restaurantId, req.user.id],
      );
      if (!menu.length)
        return res.status(404).json({ error: "Menu not found or not owned by you" });
    } else {
      // Default to the restaurant's first menu so the category is always scoped
      const [defMenu] = await db.query(
        "SELECT id FROM menus WHERE restaurant_id = ? ORDER BY id ASC LIMIT 1",
        [restaurantId],
      );
      menuId = defMenu.length ? defMenu[0].id : null;
    }

    // Block duplicate category names within the same restaurant + menu.
    // `<=>` is MySQL's NULL-safe equality (menu_id may be NULL). The table's
    // utf8mb4_unicode_ci collation makes this case/spacing-insensitive too.
    const [dup] = await db.query(
      "SELECT id FROM categories WHERE restaurant_id = ? AND name = ? AND menu_id <=> ? LIMIT 1",
      [restaurantId, String(name).trim(), menuId],
    );
    if (dup.length)
      return res.status(409).json({
        error: "You already have a category with this name",
        code: "DUPLICATE_CATEGORY",
      });

    const [result] = await db.query(
      "INSERT INTO categories (restaurant_id, menu_id, name) VALUES (?, ?, ?)",
      [restaurantId, menuId, name],
    );

    const [newCat] = await db.query("SELECT * FROM categories WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json({
      id: newCat[0].id,
      restaurant_id: newCat[0].restaurant_id,
      menu_id: newCat[0].menu_id,
      label_km: newCat[0].name,
      label: newCat[0].name,
      name: newCat[0].name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

// PATCH /api/categories/:id
exports.update = async (req, res) => {
  try {
    const name = req.body.name || req.body.label_km;

    const [rows] = await db.query(
      "SELECT c.* FROM categories c JOIN restaurants r ON r.id = c.restaurant_id WHERE c.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // Renaming to a name that already exists in the same restaurant + menu
    // would create a duplicate tab — block it (the row being renamed is
    // excluded, so keeping its own name is fine).
    if (name && String(name).trim()) {
      const [dup] = await db.query(
        "SELECT id FROM categories WHERE restaurant_id = ? AND name = ? AND menu_id <=> ? AND id != ? LIMIT 1",
        [rows[0].restaurant_id, String(name).trim(), rows[0].menu_id, req.params.id],
      );
      if (dup.length)
        return res.status(409).json({
          error: "You already have a category with this name",
          code: "DUPLICATE_CATEGORY",
        });
    }

    await db.query(
      "UPDATE categories SET name = COALESCE(?, name) WHERE id = ?",
      [name || null, req.params.id],
    );

    const [updated] = await db.query("SELECT * FROM categories WHERE id = ?", [
      req.params.id,
    ]);
    res.json({
      id: updated[0].id,
      restaurant_id: updated[0].restaurant_id,
      menu_id: updated[0].menu_id,
      label_km: updated[0].name,
      label: updated[0].name,
      name: updated[0].name,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/categories/:id
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT c.* FROM categories c JOIN restaurants r ON r.id = c.restaurant_id WHERE c.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    await db.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
