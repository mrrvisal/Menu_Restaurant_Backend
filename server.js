const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const apiRoutes = require("./routes");
const shareCardRoutes = require("./routes/shareCard");
const { getBot } = require("./services/telegramBot");

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(
  cors({
    exposedHeaders: ["Content-Disposition"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api", apiRoutes);
app.use("/s", shareCardRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.message === "Only images allowed") {
    return res.status(400).json({
      error: "Only image files are allowed (jpeg, jpg, png, webp, gif)",
    });
  }
  res.status(500).json({ error: "Something went wrong!" });
});

// Telegram bot lifecycle
const bot = getBot();

const stopBot = (signal) => {
  if (bot) {
    bot.stop(signal);
  }
};

process.once("SIGINT", () => stopBot("SIGINT"));
process.once("SIGTERM", () => stopBot("SIGTERM"));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  if (bot) {
    bot
      .launch()
      .then(() => {
        console.log("🤖 Telegram bot started (long polling)");
      })
      .catch((err) => {
        console.error("Failed to start Telegram bot:", err.message);
      });
  }
});
