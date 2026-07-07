// ============================================================
// MAILER - Gmail SMTP via nodemailer
// ============================================================
// Works locally and on Render (Render blocks SMTP ports 587/465,
// but for production on Render, use Brevo API instead).
// ============================================================

const nodemailer = require("nodemailer");
require("dotenv").config();

const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
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
 * Send email using nodemailer (Gmail SMTP)
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  // Skip if no credentials configured
  if (!process.env.SMTP_USER || !smtpPass) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    return { messageId: "dev-mode" };
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`📧 nodemailer attempt ${attempt}/2...`);
      const info = await transporter.sendMail({
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

  console.error(`❌ Failed to send email to ${to}`);
  return { error: "All methods failed", messageId: "failed" };
}

module.exports = { sendMail };