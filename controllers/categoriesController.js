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

    const [rows] = await db.query(sql, params);

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
    const menuId = req.body.menu_id || null;

    if (!name)
      return res.status(400).json({ error: "Category name is required" });

    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
      [req.user.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Restaurant not found" });
    const restaurantId = rows[0].id;

    // If a menu_id is given, make sure it belongs to one of this owner's restaurants
    if (menuId) {
      const [menu] = await db.query(
        "SELECT m.id FROM menus m JOIN restaurants r ON r.id = m.restaurant_id WHERE m.id = ? AND r.owner_id = ?",
        [menuId, req.user.id],
      );
      if (!menu.length)
        return res.status(404).json({ error: "Menu not found or not owned by you" });
    }

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
