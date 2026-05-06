// backend/controllers/categoriesController.js
const db = require('../config/db');

// GET /api/categories
exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM categories ORDER BY sort_order ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
