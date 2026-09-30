const multer = require("multer");
const path = require("path");

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const validExtension = allowed.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const validType = allowed.test(file.mimetype);
    if (validExtension && validType) return cb(null, true);
    cb(new Error("Only images allowed"));
  },
});
