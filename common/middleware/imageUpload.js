const multer = require("multer");
const path = require("path");

// #21 — multer's fileFilter can only see the CLIENT-DECLARED mimetype and
// filename, both trivially forged. After the upload lands in memory we also
// verify the actual magic bytes so a .png-named HTML/SVG polyglot never
// reaches ImageKit (stored-XSS vector on the CDN domain).
const MAGIC = {
  jpeg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) =>
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  gif: (b) =>
    b.length > 6 &&
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61,
  webp: (b) =>
    b.length > 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP",
};

function hasValidMagic(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return false;
  return Object.values(MAGIC).some((test) => test(buffer));
}

const upload = multer({
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

// API-compatible wrapper: routes keep calling upload.single("image"), but the
// composed middleware now re-validates the buffer's magic bytes afterwards.
function single(field) {
  const mw = upload.single(field);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (err) return next(err);
      if (req.file && !hasValidMagic(req.file.buffer)) {
        return res.status(400).json({ error: "Only images allowed" });
      }
      next();
    });
  };
}

module.exports = { single };
