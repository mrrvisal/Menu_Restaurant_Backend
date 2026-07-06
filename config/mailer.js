const dns = require("dns");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password (Gmail shows it with spaces)
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// ============================================================
// OPTION 1: Use port 587 with STARTTLS (Recommended for Gmail)
// ============================================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: 587, // Use 587 instead of 465
  secure: false, // false for port 587 (STARTTLS)
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
  // Additional TLS options for Gmail
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
});

// ============================================================
// OPTION 2: Use port 465 with SSL (Alternative)
// Uncomment this block if you want to use 465
// ============================================================
/*
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  dnsLookup(hostname, options, callback) {
    return dns.lookup(hostname, { family: 4 }, callback);
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  tls: {
    rejectUnauthorized: false,  // Sometimes needed on Render
  },
});
*/

// ============================================================
// OPTION 3: Use port 25 (Not recommended for Gmail)
// ============================================================

// Verify connection
let mailerReady = false;
let mailerError = null;

// Verify connection
transporter.verify((err) => {
  if (err) {
    console.error("❌ Mailer verification FAILED:", err.message);
    // Log more details
    if (err.code) console.error(`   Code: ${err.code}`);
    if (err.stack) console.error(`   Stack: ${err.stack}`);
    mailerError = err;
    mailerReady = false;
  } else {
    console.log("✅ Mailer ready to send emails");
    mailerReady = true;
  }
});

/**
 * Send an email
 */
async function sendMail({ to, subject, html }) {
  // Log configuration for debugging
  console.log(`📧 Sending email to: ${to}`);
  console.log(`   Using host: ${process.env.SMTP_HOST}, port: 587`);

  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    console.log(
      `📧 [DEV] Body: ${html.replace(/<[^>]*>/g, "").substring(0, 200)}...`,
    );
    return { messageId: "dev-mode" };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || "Digital Menu"}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });

    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    if (err.code) console.error(`   Code: ${err.code}`);
    if (err.response) console.error(`   Response: ${err.response}`);
    // Don't throw, just return error object
    return { error: err.message, messageId: "failed" };
  }
}

module.exports = { sendMail };
