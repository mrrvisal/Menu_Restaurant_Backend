const dns = require("dns");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password (Gmail shows it with spaces)
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// IPv4-only transport to avoid ENETUNREACH on Render
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  // IPv4-only DNS to avoid ENETUNREACH on Render
  dnsLookup(hostname, options, callback) {
    return dns.lookup(hostname, { family: 4 }, callback);
  },
  // Connection pooling for faster subsequent sends
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

// Lazy verification to avoid blocking cold starts
setImmediate(() => {
  transporter.verify((err) => {
    if (err) {
      console.warn("⚠️ Mailer verification:", err.message);
    } else {
      console.log("✅ Mailer ready to send emails");
    }
  });
});

/**
 * Send an email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - HTML body content
 */
async function sendMail({ to, subject, html }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    console.log(`📧 [DEV] Body: ${html.replace(/<[^>]*>/g, "").substring(0, 200)}...`);
    return { messageId: "dev-mode" };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || "Digital Menu"}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });

    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`📧 Failed to send email to ${to}:`, err.message);
    return { messageId: "fallback" };
  }
}

module.exports = { sendMail };