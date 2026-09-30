const brevo = require("@getbrevo/brevo");
require("dotenv").config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;

let brevoClient = null;
if (BREVO_API_KEY) {
  brevoClient = new brevo.BrevoClient({ apiKey: BREVO_API_KEY });
  console.log("✅ Brevo configured");
} else {
  console.log("📧 No mail credentials configured — emails will be skipped.");
}

async function sendViaBrevo({ to, subject, html }) {
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

    console.log("✅ Email sent via Brevo");
    return { messageId: response.body?.messageId || "sent" };
  } catch (err) {
    console.error("❌ Brevo failed:", err.message);
    if (err.body) {
      try {
        const errorBody =
          typeof err.body === "string" ? JSON.parse(err.body) : err.body;
        console.error("   Details:", errorBody.message || err.body);
      } catch {
        console.error("   Body:", String(err.body).slice(0, 300));
      }
    }
    return {
      error: isProd ? "Brevo failed" : err.message,
      messageId: "failed",
    };
  }
}

/**
 * Send an email with whichever transport is configured.
 * Never throws — returns { messageId } or { error, messageId: "failed" }.
 */
async function sendMail({ to, subject, html }) {
  if (brevoClient) return sendViaBrevo({ to, subject, html });

  console.log("📧 Email skipped: BREVO_API_KEY is not configured");
  return { messageId: "dev-mode" };
}

module.exports = { sendMail };
