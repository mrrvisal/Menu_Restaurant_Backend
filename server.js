const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const apiRoutes = require("./routes");
const shareCardRoutes = require("./modules/share/share.routes");
const { getBot } = require("./modules/telegram/telegramBot.service");
const {
  errorHandler,
  normalizeErrorResponses,
} = require("./common/middleware/errorResponse");

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(normalizeErrorResponses);
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

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});
app.use(errorHandler);

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
