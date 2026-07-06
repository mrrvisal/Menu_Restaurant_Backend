// ============================================================
// MAILER - SendGrid API (works on Render) + nodemailer fallback (local)
// ============================================================
// Render blocks outbound SMTP ports (587, 465).
// SendGrid sends via HTTPS API on port 443 which Render allows.
// Free tier: 100 emails/day.
// ============================================================

const sgMail = require("@sendgrid/mail");
const nodemailer = require("nodemailer");
require("dotenv").config();

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;

// Configure SendGrid if API key is available
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log("✅ SendGrid configured");
}

// Configure nodemailer as fallback (for local dev)
const nodemailerTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  tls: {
    rejectUnauthorized: false,
    minVersion: "TLSv1.2",
  },
  family: 4,
});

/**
 * Send email using SendGrid (preferred) or nodemailer (fallback)
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  // Skip if no credentials configured
  if (!SENDGRID_API_KEY && (!process.env.SMTP_USER || !smtpPass)) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    return { messageId: "dev-mode" };
  }

  // Try SendGrid first (works on Render via HTTPS)
  if (SENDGRID_API_KEY) {
    try {
      console.log("📧 Using SendGrid API...");
      const msg = {
        to,
        from: {
          email: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "noreply@digitalmenu.com",
          name: process.env.SMTP_FROM_NAME || "Digital Menu",
        },
        subject,
        html,
      };
      const result = await sgMail.send(msg);
      console.log(`✅ Email sent via SendGrid to ${to}`);
      return { messageId: result[0]?.headers?.["x-message-id"] || "sent" };
    } catch (err) {
      console.error("❌ SendGrid failed:", err.message);
      if (err.response) {
        console.error("   Status:", err.response.statusCode);
        console.error("   Body:", err.response.body?.errors?.[0]?.message || JSON.stringify(err.response.body).slice(0, 200));
      }
      // Don't fallback to nodemailer in production - SendGrid is the only option
      if (isProd) {
        return { error: "SendGrid failed", messageId: "failed" };
      }
      console.log("⏳ Falling back to nodemailer...");
    }
  }

  // Fallback: nodemailer (works locally)
  if (!isProd) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`📧 nodemailer attempt ${attempt}/2...`);
        const info = await nodemailerTransporter.sendMail({
          from: `"${process.env.SMTP_FROM_NAME || "Digital Menu"}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
          to,
          subject,
          html,
        });
        console.log(`✅ Email sent via nodemailer: ${info.messageId}`);
        return info;
      } catch (err) {
        console.error(`❌ nodemailer attempt ${attempt} failed:`, err.message);
        if (err.code === "EAUTH") {
          console.error("❌ Authentication failed - check Gmail App Password");
          break;
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }
  }

  console.error(`❌ Failed to send email to ${to}`);
  return { error: "All methods failed", messageId: "failed" };
}

module.exports = { sendMail };