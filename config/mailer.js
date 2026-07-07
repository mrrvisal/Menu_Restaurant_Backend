// ============================================================
// MAILER - Brevo (SendinBlue) API (works on Render + local)
// ============================================================
// Brevo sends via HTTPS API on port 443 which Render allows.
// Free tier: 300 emails/day.
// Sign up: https://app.brevo.com
// ============================================================

const brevo = require("@getbrevo/brevo");
require("dotenv").config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;

// Initialize Brevo API client
let brevoClient = null;
if (BREVO_API_KEY) {
  brevoClient = new brevo.BrevoClient({ apiKey: BREVO_API_KEY });
  console.log("✅ Brevo configured");
}

/**
 * Send email using Brevo API
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  // Skip if no API key configured
  if (!BREVO_API_KEY) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    return { messageId: "dev-mode" };
  }

  try {
    console.log("📧 Using Brevo API...");
    const response = await brevoClient.transactionalEmails.sendTransacEmail({
      subject,
      htmlContent: html,
      sender: {
        name: process.env.BREVO_FROM_NAME || "Digital Menu",
        email: process.env.BREVO_FROM_EMAIL || "noreply@digitalmenu.com",
      },
      to: [{ email: to }],
    });

    console.log(`✅ Email sent via Brevo to ${to}`);
    return { messageId: response.body?.messageId || "sent" };
  } catch (err) {
    console.error("❌ Brevo failed:", err.message);
    if (err.body) {
      try {
        const errorBody = typeof err.body === "string" ? JSON.parse(err.body) : err.body;
        console.error("   Details:", errorBody.message || err.body);
      } catch {
        console.error("   Body:", String(err.body).slice(0, 300));
      }
    }
    if (isProd) {
      return { error: "Brevo failed", messageId: "failed" };
    }
    return { error: err.message, messageId: "failed" };
  }
}

module.exports = { sendMail };