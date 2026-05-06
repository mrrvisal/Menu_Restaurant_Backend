// backend/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5001; // ✅ FIXED: was process.env.DB_PORT (= 4000, the TiDB port!)

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (uploads)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
const apiRoutes = require("./routes");
app.use("/api", apiRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.message === "Only images allowed") {
    return res.status(400).json({
      error: "Only image files are allowed (jpeg, jpg, png, webp, gif)",
    });
  }
  res.status(500).json({ error: "Something went wrong!" });
});
// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 API URL: http://localhost:${PORT}/api`);
  
});
