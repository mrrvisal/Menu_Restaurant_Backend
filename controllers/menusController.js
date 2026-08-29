// backend/controllers/menusController.js
const db = require("../config/db");

// Helper: fetch owner's restaurants so an owner can act on any of them.
async function getOwnerRestaurant(req, restaurantId) {
  if (!restaurantId) return null;
  const [rows] = await db.query(
    "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
    [parseInt(restaurantId), req.user.id]
  );
  return rows.length ? rows[0].id : null;
}

// GET /api/menus?restaurant_id=X
// Public read of a restaurant's menus (used by the guest menu page).
exports.getAll = async (req, res) => {
  try {
    const restaurantId = parseInt(req.query.restaurant_id || 0);
    if (!restaurantId)
      return res.status(400).json({ error: "restaurant_id is required" });

    const [rows] = await db.query(
      "SELECT id, restaurant_id, name, sort_order, status FROM menus WHERE restaurant_id = ? AND status = 'active' ORDER BY sort_order ASC, id ASC",
      [restaurantId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get menus error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// POST /api/menus  (owner)  body: { restaurant_id, name }
exports.create = async (req, res) => {
  try {
    const { restaurant_id, name } = req.body;
    if (!restaurant_id)
      return res.status(400).json({ error: "restaurant_id is required" });
    if (!name || !name.trim())
      return res.status(400).json({ error: "Menu name is required" });

    const restId = await getOwnerRestaurant(req, restaurant_id);
    if (!restId)
      return res
        .status(404)
        .json({ error: "Restaurant not found or not owned by you" });

    const [result] = await db.query(
      "INSERT INTO menus (restaurant_id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM (SELECT sort_order FROM menus WHERE restaurant_id = ?) m))",
      [restId, name.trim(), restId]
    );
    const [row] = await db.query("SELECT * FROM menus WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json(row[0]);
  } catch (err) {
    console.error("Create menu error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// PATCH /api/menus/:id  (owner)  body: { name }
exports.update = async (req, res) => {
  try {
    const { name } = req.body;
    const [rows] = await db.query(
      "SELECT m.id FROM menus m JOIN restaurants r ON r.id = m.restaurant_id WHERE m.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    await db.query("UPDATE menus SET name = COALESCE(?, name) WHERE id = ?", [
      name || null,
      req.params.id,
    ]);
    const [updated] = await db.query("SELECT * FROM menus WHERE id = ?", [
      req.params.id,
    ]);
    res.json(updated[0]);
  } catch (err) {
    console.error("Update menu error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/menus/:id  (owner)
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT m.id FROM menus m JOIN restaurants r ON r.id = m.restaurant_id WHERE m.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    await db.query("DELETE FROM menus WHERE id = ?", [req.params.id]);
    res.json({ message: "Menu deleted" });
  } catch (err) {
    console.error("Delete menu error:", err);
    res.status(500).json({ error: "Server error" });
  }
};