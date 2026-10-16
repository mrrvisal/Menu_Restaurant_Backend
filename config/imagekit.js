const ImageKit = require("imagekit");
require("dotenv").config();

const { IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT } =
  process.env;

// Validate required environment variables
if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) {
  console.error(
    "❌ Missing ImageKit environment variables (IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT).",
  );
  process.exit(1);
}

// Guard against SDK/version mismatches: config passes the v4+ option names
// ({publicKey, privateKey, urlEndpoint}). If node_modules ever contains an
// incompatible imagekit major (this actually happened after
// `npm audit fix --force` downgraded imagekit to 1.5.0), fail with an
// actionable message instead of the SDK's cryptic constructor throw.
let imagekit;
try {
  imagekit = new ImageKit({
    publicKey: IMAGEKIT_PUBLIC_KEY,
    privateKey: IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: IMAGEKIT_URL_ENDPOINT,
  });
} catch (err) {
  let installed = "?";
  try {
    installed = require("imagekit/package.json").version;
  } catch (_) {
    /* package layout changed — keep "?" */
  }
  console.error(
    `❌ ImageKit client failed to initialize (installed imagekit@${installed}): ${err.message}`,
  );
  console.error(
    "   This config requires imagekit ^6.0.0 (option names: publicKey/privateKey/urlEndpoint).\n" +
      "   If this broke after an audit/dependency fix, run:  npm install imagekit@^6.0.0",
  );
  process.exit(1);
}

module.exports = imagekit;

