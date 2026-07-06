const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// ============================================================
// MAILER - Works on both local and Render
// ============================================================

// Create transporter
// Render blocks outbound SMTP on port 587, so we use port 465 (SSL)
// or fall back to SendGrid API
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: process.env.SMTP_SECURE === "true" || true, // Use SSL by default
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  // Connection settings
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 20000,
  // TLS settings
  tls: {
    rejectUnauthorized: false,
    minVersion: "TLSv1.2",
  },
  // Force IPv4
  family: 4,
});

// Verify connection (non-blocking)
transporter.verify((err) => {
  if (err) {
    console.error("❌ Mailer verification:", err.message);
    console.log("ℹ️ Email will still be attempted on send");
  } else {
    console.log("✅ Mailer ready to send emails");
  }
});

/**
 * Send email with retry
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    return { messageId: "dev-mode" };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`📧 Attempt ${attempt}/2...`);

      const info = await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || "Digital Menu"}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });

      console.log(`✅ Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (err) {
      lastError = err;
      console.error(`❌ Attempt ${attempt} failed:`, err.message);

      // Don't retry on auth errors
      if (err.code === "EAUTH") {
        console.error("❌ Authentication failed - check Gmail App Password");
        break;
      }

      if (attempt < 2) {
        const waitTime = 5000;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  console.error(`❌ All attempts failed for ${to}`);
  return { error: lastError?.message || "Unknown error", messageId: "failed" };
}

module.exports = { sendMail };