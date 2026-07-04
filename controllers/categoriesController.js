// backend/controllers/categoriesController.js
const db = require("../config/db");

// Helper: get restaurant_id for public requests
async function getRestaurantId(req) {
  if (req.query.restaurant_id) return parseInt(req.query.restaurant_id);
  if (req.user) {
    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ?",
      [req.user.id],
    );
    if (rows.length) return rows[0].id;
  }
  return 1; // Default
}

// GET /api/categories?restaurant_id=X
exports.getAll = async (req, res) => {
  try {
    const restaurantId = await getRestaurantId(req);

    const [rows] = await db.query(
      "SELECT id, restaurant_id, name FROM categories WHERE restaurant_id = ? ORDER BY id ASC",
      [restaurantId],
    );

    const result = rows.map((cat) => ({
      id: cat.id,
      restaurant_id: cat.restaurant_id,
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

    if (!name)
      return res.status(400).json({ error: "Category name is required" });

    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ?",
      [req.user.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Restaurant not found" });

    const [result] = await db.query(
      "INSERT INTO categories (restaurant_id, name) VALUES (?, ?)",
      [rows[0].id, name],
    );

    const [newCat] = await db.query("SELECT * FROM categories WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json({
      id: newCat[0].id,
      restaurant_id: newCat[0].restaurant_id,
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
