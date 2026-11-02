const db = require("../../config/db");
const imagekit = require("../../config/imagekit");

// Helper: resolve restaurant ID for public or authenticated requests
async function getRestaurantId(req) {
  if (req.query.restaurant_id) {
    const id = parseInt(req.query.restaurant_id, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  if (req.user) {
    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
      [req.user.id],
    );
    if (rows.length) return rows[0].id;
  }
  return null;
}

async function deleteFromImageKit(fileId) {
  if (!fileId) return;
  try {
    await imagekit.deleteFile(fileId);
  } catch (err) {
    console.error("Failed to delete from ImageKit:", err.message);
  }
}

// GET /api/foods?restaurant_id=X&menu_id=Y&category=Z&search=xxx
exports.getAll = async (req, res) => {
  try {
    const restaurantId = await getRestaurantId(req);
    if (!restaurantId) {
      return res
        .status(400)
        .json({ error: "No restaurant found — specify ?restaurant_id" });
    }

    const { category, search, menu_id } = req.query;

    let sql = `SELECT f.*, c.name AS category_name
               FROM foods f
               LEFT JOIN categories c ON f.category = c.id
               WHERE f.restaurant_id = ?`;
    const params = [restaurantId];

    if (menu_id) {
      sql += " AND f.menu_id = ?";
      params.push(menu_id);
    }
    if (category) {
      sql += " AND f.category = ?";
      params.push(category);
    }
    if (search) {
      sql += " AND f.name LIKE ?";
      params.push(`%${search}%`);
    }
    sql += " ORDER BY f.id ASC";

    const [rows] = await db.query(sql, params);
    const result = rows.map((f) => ({
      id: f.id,
      restaurant_id: f.restaurant_id,
      name: f.name,
      price: f.price,
      category: f.category,
      category_name: f.category_name,
      img: f.img,
      img_url: f.img,
      img_file_id: f.img_file_id,
      status: f.status,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/foods/:id
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM foods WHERE id = ?", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// POST /api/foods
exports.create = async (req, res) => {
  try {
    const { name, price, category, status } = req.body;
    if (!name || !price || !category)
      return res.status(400).json({ error: "name, price, category required" });

    const [restaurant] = await db.query(
      "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
      [req.body.restaurant_id || 0, req.user.id],
    );
    // fallback to first owned restaurant if not specified
    if (!restaurant.length) {
      const [fallback] = await db.query(
        "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
        [req.user.id],
      );
      if (!fallback.length)
        return res.status(404).json({ error: "Restaurant not found" });
      restaurant.push(fallback[0]);
    }
    const restaurantId = restaurant[0].id;

    // Resolve + validate menu if provided
    let menuId = req.body.menu_id || null;
    if (menuId) {
      const [menu] = await db.query(
        "SELECT m.id FROM menus m JOIN restaurants r ON r.id = m.restaurant_id WHERE m.id = ? AND r.id = ? AND r.owner_id = ?",
        [menuId, restaurantId, req.user.id],
      );
      if (!menu.length)
        return res
          .status(404)
          .json({ error: "Menu not found or not owned by you" });
    } else {
      // Default to the restaurant's first menu so the food is always scoped
      const [defMenu] = await db.query(
        "SELECT id FROM menus WHERE restaurant_id = ? ORDER BY id ASC LIMIT 1",
        [restaurantId],
      );
      menuId = defMenu.length ? defMenu[0].id : null;
    }

    let img = null,
      imgFileId = null;
    if (req.file) {
      try {
        const base64 = req.file.buffer.toString("base64");
        const dataUri = `data:${req.file.mimetype};base64,${base64}`;
        const uploadResult = await imagekit.upload({
          file: dataUri,
          fileName: `food_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")}`,
          folder: "/menu_foods",
          useUniqueFileName: true,
        });
        img = uploadResult.url;
        imgFileId = uploadResult.fileId;
      } catch (uploadErr) {
        console.error("Food image upload failed:", uploadErr.message); // detail stays server-side (#12)
        return res
          .status(500)
          .json({ error: "Image upload failed" }); // #12 — no upload internals
      }
    }

    const [result] = await db.query(
      "INSERT INTO foods (restaurant_id, menu_id, name, price, category, img, img_file_id, status) VALUES (?,?,?,?,?,?,?,?)",
      [
        restaurantId,
        menuId,
        name,
        parseFloat(price),
        category,
        img,
        imgFileId,
        status || "available",
      ],
    );

    const [newRow] = await db.query("SELECT * FROM foods WHERE id = ?", [
      result.insertId,
    ]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" }); // #12 — no internals to clients
  }
};

// PATCH /api/foods/:id
exports.update = async (req, res) => {
  try {
    const { name, price, category, status } = req.body;
    const [exists] = await db.query(
      "SELECT f.* FROM foods f JOIN restaurants r ON r.id = f.restaurant_id WHERE f.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!exists.length) return res.status(404).json({ error: "Not found" });

    let img = exists[0].img,
      imgFileId = exists[0].img_file_id;
    if (req.file) {
      if (imgFileId) await deleteFromImageKit(imgFileId);
      try {
        const base64 = req.file.buffer.toString("base64");
        const dataUri = `data:${req.file.mimetype};base64,${base64}`;
        const uploadResult = await imagekit.upload({
          file: dataUri,
          fileName: `food_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")}`,
          folder: "/menu_foods",
          useUniqueFileName: true,
        });
        img = uploadResult.url;
        imgFileId = uploadResult.fileId;
      } catch (uploadErr) {
        return res.status(500).json({ error: "Failed to upload image" });
      }
    }

    await db.query(
      `UPDATE foods SET
        name = COALESCE(?, name), price = COALESCE(?, price),
        category = COALESCE(?, category), img = ?, img_file_id = ?,
        status = COALESCE(?, status)
       WHERE id = ?`,
      [
        name || null,
        price ? parseFloat(price) : null,
        category || null,
        img,
        imgFileId,
        status || null,
        req.params.id,
      ],
    );

    const [updated] = await db.query("SELECT * FROM foods WHERE id = ?", [
      req.params.id,
    ]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// PATCH /api/foods/:id/status
exports.toggleStatus = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT f.status FROM foods f JOIN restaurants r ON r.id = f.restaurant_id WHERE f.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const newStatus =
      rows[0].status === "available" ? "unavailable" : "available";
    await db.query("UPDATE foods SET status = ? WHERE id = ?", [
      newStatus,
      req.params.id,
    ]);
    res.json({ id: parseInt(req.params.id), status: newStatus });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/foods/:id
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT f.img_file_id FROM foods f JOIN restaurants r ON r.id = f.restaurant_id WHERE f.id = ? AND r.owner_id = ?",
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    await db.query("DELETE FROM foods WHERE id = ?", [req.params.id]);
    if (rows[0].img_file_id) {
      const [references] = await db.query("SELECT id FROM foods WHERE img_file_id = ? LIMIT 1", [rows[0].img_file_id]);
      if (!references.length) await deleteFromImageKit(rows[0].img_file_id);
    }
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// DELETE several foods in one request. Images are deleted only once even if
// two selected rows happen to share the same ImageKit file.
exports.bulkRemove = async (req, res) => {
  try {
    const ids = [...new Set((req.body.ids || []).map(Number).filter(Number.isInteger))];
    if (!ids.length) return res.status(400).json({ error: "Food ids are required" });

    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await db.query(
      `SELECT f.id, f.img_file_id FROM foods f
       JOIN restaurants r ON r.id = f.restaurant_id
       WHERE f.id IN (${placeholders}) AND r.owner_id = ?`,
      [...ids, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "No selected foods found" });

    await db.query(`DELETE FROM foods WHERE id IN (${rows.map(() => "?").join(",")})`, rows.map((row) => row.id));
    for (const fileId of new Set(rows.map((row) => row.img_file_id).filter(Boolean))) {
      const [references] = await db.query("SELECT id FROM foods WHERE img_file_id = ? LIMIT 1", [fileId]);
      if (!references.length) await deleteFromImageKit(fileId);
    }
    res.json({ deleted: rows.length });
  } catch (err) {
    console.error("Bulk food delete failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// Copy or move selected foods between restaurants. Category names are matched
// in the destination menu, so moving keeps the same category when it exists.
exports.bulkTransfer = async (req, res) => {
  try {
    const ids = [...new Set((req.body.ids || []).map(Number).filter(Number.isInteger))];
    const action = req.body.action;
    const targetRestaurantId = Number(req.body.restaurant_id);
    if (!ids.length || !["copy", "move"].includes(action) || !targetRestaurantId) {
      return res.status(400).json({ error: "ids, action, and restaurant_id are required" });
    }

    const [destRestaurants] = await db.query(
      "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
      [targetRestaurantId, req.user.id],
    );
    if (!destRestaurants.length) return res.status(404).json({ error: "Destination restaurant not found" });

    const foodPlaceholders = ids.map(() => "?").join(",");
    const [sourceFoods] = await db.query(
      `SELECT f.*, c.name AS category_name
       FROM foods f
       JOIN restaurants r ON r.id = f.restaurant_id
       LEFT JOIN categories c ON c.id = f.category
       WHERE f.id IN (${foodPlaceholders}) AND r.owner_id = ?`,
      [...ids, req.user.id],
    );
    if (!sourceFoods.length) return res.status(404).json({ error: "No selected foods found" });

    let targetMenuId = Number(req.body.menu_id) || null;
    if (targetMenuId) {
      const [menus] = await db.query(
        "SELECT id FROM menus WHERE id = ? AND restaurant_id = ?",
        [targetMenuId, targetRestaurantId],
      );
      if (!menus.length) return res.status(404).json({ error: "Destination menu not found" });
    } else {
      const [defaultMenu] = await db.query(
        "SELECT id FROM menus WHERE restaurant_id = ? ORDER BY id ASC LIMIT 1",
        [targetRestaurantId],
      );
      targetMenuId = defaultMenu.length ? defaultMenu[0].id : null;
    }

    async function destinationCategory(categoryName) {
      if (!categoryName) return null;
      const [existing] = await db.query(
        "SELECT id FROM categories WHERE restaurant_id = ? AND menu_id <=> ? AND LOWER(name) = LOWER(?) ORDER BY id ASC LIMIT 1",
        [targetRestaurantId, targetMenuId, categoryName],
      );
      if (existing.length) return existing[0].id;
      const [created] = await db.query(
        "INSERT INTO categories (restaurant_id, menu_id, name) VALUES (?, ?, ?)",
        [targetRestaurantId, targetMenuId, categoryName],
      );
      return created.insertId;
    }

    const copied = [];
    for (const food of sourceFoods) {
      const categoryId = await destinationCategory(food.category_name);
      if (action === "copy") {
        const [result] = await db.query(
          "INSERT INTO foods (restaurant_id, menu_id, name, price, category, img, img_file_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [targetRestaurantId, targetMenuId, food.name, food.price, categoryId, food.img, food.img_file_id, food.status || "available"],
        );
        copied.push(result.insertId);
      } else {
        await db.query(
          "UPDATE foods SET restaurant_id = ?, menu_id = ?, category = ? WHERE id = ?",
          [targetRestaurantId, targetMenuId, categoryId, food.id],
        );
      }
    }

    res.json({ action, transferred: sourceFoods.length, ids: copied });
  } catch (err) {
    console.error("Bulk food transfer failed:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
