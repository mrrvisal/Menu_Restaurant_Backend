// backend/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
// `exposedHeaders` lets the dashboard read the filename of a CSV download
// (Content-Disposition is not readable by browser JS unless it is exposed).
app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
  }),
);
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
  console.log(`Server running on port ${PORT}`);

  // Launch Telegram bot with long polling
  const { getBot } = require("./services/telegramBot");
  const bot = getBot();
  if (bot) {
    bot.launch().then(() => {
      console.log("🤖 Telegram bot started (long polling)");
    }).catch((err) => {
      console.error("Failed to start Telegram bot:", err.message);
    });
  }
});

// Graceful stop for the bot
process.once("SIGINT", () => {
  const { getBot } = require("./services/telegramBot");
  const bot = getBot();
  if (bot) bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  const { getBot } = require("./services/telegramBot");
  const bot = getBot();
  if (bot) bot.stop("SIGTERM");
});
