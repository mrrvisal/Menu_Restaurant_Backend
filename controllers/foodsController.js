// backend/controllers/foodsController.js
const db = require("../config/db");
const imagekit = require("../config/imagekit");
const path = require("path");

// ✅ FIXED: Delete by fileId stored in DB, not by parsing the URL
// ImageKit URLs look like: https://ik.imagekit.io/xxx/menu_foods/food_123.jpg
// But deleteFile() needs the actual fileId from ImageKit's API (e.g. "65abc123def456")
// We store it separately in the `img_file_id` column.
async function deleteFromImageKit(fileId) {
  if (!fileId) return;
  try {
    await imagekit.deleteFile(fileId);
    console.log(`✅ Deleted from ImageKit: ${fileId}`);
  } catch (err) {
    // Don't crash if delete fails (file may already be gone)
    console.error("⚠️ Failed to delete from ImageKit:", err.message);
  }
}

// GET /api/foods
exports.getAll = async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = "SELECT * FROM foods WHERE 1=1";
    const params = [];
    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }
    if (search) {
      sql += " AND name LIKE ?";
      params.push(`%${search}%`);
    }
    sql += " ORDER BY id ASC";
    const [rows] = await db.query(sql, params);
    res.json(rows);
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

// POST /api/foods (admin)
exports.create = async (req, res) => {
  try {
    const { name, price, category, status } = req.body;
    if (!name || !price || !category) {
      return res.status(400).json({ error: "name, price, category required" });
    }

    let img = null;
    let imgFileId = null; // ✅ Store ImageKit fileId for later deletion

    if (req.file) {
      try {
        console.log("Starting ImageKit upload...", {
          name: req.file.originalname,
          size: req.file.size,
          type: req.file.mimetype,
        });

        // ✅ req.file.buffer works because we use memoryStorage in routes/index.js
        const base64 = req.file.buffer.toString("base64");
        const dataUri = `data:${req.file.mimetype};base64,${base64}`;

        const uploadResult = await imagekit.upload({
          file: dataUri,
          fileName: `food_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")}`,
          folder: "/menu_foods",
          useUniqueFileName: true,
        });

        img = uploadResult.url; // ✅ Full CDN URL for displaying in frontend
        imgFileId = uploadResult.fileId; // ✅ ImageKit fileId for deleting later
        console.log("✅ Upload successful:", img);
      } catch (uploadErr) {
        console.error("❌ ImageKit upload error:", uploadErr.message);
        return res
          .status(500)
          .json({ error: `Image upload failed: ${uploadErr.message}` });
      }
    }

    // ✅ Save both img (URL) and img_file_id (for deletion)
    const [result] = await db.query(
      "INSERT INTO foods (name, price, category, img, img_file_id, status) VALUES (?,?,?,?,?,?)",
      [
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
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
};

// PATCH /api/foods/:id (admin)
exports.update = async (req, res) => {
  try {
    const { name, price, category, status } = req.body;
    const [exists] = await db.query("SELECT * FROM foods WHERE id = ?", [
      req.params.id,
    ]);
    if (!exists.length) return res.status(404).json({ error: "Not found" });

    let img = exists[0].img;
    let imgFileId = exists[0].img_file_id;

    if (req.file) {
      // Delete old image from ImageKit using stored fileId
      if (imgFileId) {
        await deleteFromImageKit(imgFileId);
      }

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
        imgFileId = uploadResult.fileId; // ✅ Update fileId too
        console.log("✅ Updated image:", img);
      } catch (uploadErr) {
        console.error("ImageKit upload error:", uploadErr);
        return res.status(500).json({ error: "Failed to upload image" });
      }
    }

    await db.query(
      `UPDATE foods SET
        name         = COALESCE(?, name),
        price        = COALESCE(?, price),
        category     = COALESCE(?, category),
        img          = ?,
        img_file_id  = ?,
        status       = COALESCE(?, status)
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
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

// PATCH /api/foods/:id/status (admin)
exports.toggleStatus = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT status FROM foods WHERE id = ?", [
      req.params.id,
    ]);
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

// DELETE /api/foods/:id (admin)
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT img, img_file_id FROM foods WHERE id = ?",
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // ✅ Delete image from ImageKit using stored fileId
    if (rows[0].img_file_id) {
      await deleteFromImageKit(rows[0].img_file_id);
    }

    await db.query("DELETE FROM foods WHERE id = ?", [req.params.id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};
