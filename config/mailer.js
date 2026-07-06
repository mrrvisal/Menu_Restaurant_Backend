const dns = require("dns");

// Prefer IPv6 DNS results
if (typeof dns.setDefaultResultOrder === "function") {
  try {
    dns.setDefaultResultOrder("ipv6first");
  } catch (e) {
    // ignore if not supported on this Node version
  }
}
// backend/config/mailer.js
const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password (Gmail shows it with spaces)
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

function createTransporter(family) {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass,
    },
    tls: { family },
    dnsLookup(hostname, options, callback) {
      return dns.lookup(hostname, { family, all: false }, callback);
    },
    connectionTimeout: 20000,
    greetingTimeout: 10000,
  });
}

const ipv6Transporter = createTransporter(6);
const ipv4Transporter = createTransporter(4);

// Verify IPv6 connectivity on startup
ipv6Transporter.verify((err) => {
  if (err) {
    console.warn("⚠️ IPv6 mailer verification failed:", err.message);
  } else {
    console.log("✅ Mailer ready via IPv6");
  }
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

  let activeTransporter = ipv6Transporter;

  const mailOptions = {
    from: `"${process.env.SMTP_FROM_NAME || "Digital Menu"}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  };

  try {
    const info = await activeTransporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    // If IPv6 fails, fallback to IPv4 for this send
    if (activeTransporter === ipv6Transporter && /ENETUNREACH|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH/.test(err.message)) {
      console.warn(`⚠️ IPv6 failed for ${to}, retrying via IPv4:`, err.message);
      activeTransporter = ipv4Transporter;
      try {
        const info = await ipv4Transporter.sendMail(mailOptions);
        console.log(`📧 Email sent to ${to} (IPv4 fallback): ${info.messageId}`);
        return info;
      } catch (err2) {
        console.error(`📧 Failed to send email to ${to}:`, err2.message);
        return { messageId: "fallback" };
      }
    }
    console.error(`📧 Failed to send email to ${to}:`, err.message);
    return { messageId: "fallback" };
  }
}

module.exports = { sendMail };