// backend/config/imagekit.js
const ImageKit = require("imagekit");
require("dotenv").config();

// Validate environment variables
if (
  !process.env.IMAGEKIT_PUBLIC_KEY ||
  !process.env.IMAGEKIT_PRIVATE_KEY ||
  !process.env.IMAGEKIT_URL_ENDPOINT
) {
  console.error("❌ Missing ImageKit environment variables!");
  console.error("Please check your .env file has:");
  console.error("  IMAGEKIT_PUBLIC_KEY");
  console.error("  IMAGEKIT_PRIVATE_KEY");
  console.error("  IMAGEKIT_URL_ENDPOINT");
  process.exit(1);
}

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// console.log("✅ ImageKit configured successfully");
// console.log("URL Endpoint:", process.env.IMAGEKIT_URL_ENDPOINT);

module.exports = imagekit;
