const dns = require("dns");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// ============================================================
// FORCE IPv4 ONLY - Fix ENETUNREACH on Render
// ============================================================

// Custom DNS lookup - IPv4 only
function ipv4Lookup(hostname, options, callback) {
  console.log(`🔍 DNS lookup ${hostname} (IPv4 only)...`);
  dns.lookup(hostname, { family: 4 }, (err, address, family) => {
    if (err) {
      console.error(`❌ DNS lookup failed:`, err.message);
      return callback(err);
    }
    console.log(`✅ ${hostname} -> ${address} (IPv4)`);
    callback(null, address, family);
  });
}

// Create transporter with IPv4 only
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  // Force IPv4 only
  dnsLookup: ipv4Lookup,
  // Connection settings
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  // TLS settings
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
  // Disable IPv6
  family: 4,
});

// Verify connection
let mailerReady = false;
let mailerError = null;

transporter.verify((err) => {
  if (err) {
    console.error("❌ Mailer verification FAILED:", err.message);
    if (err.code) console.error(`   Code: ${err.code}`);
    mailerError = err;
    mailerReady = false;
  } else {
    console.log("✅ Mailer ready to send emails");
    mailerReady = true;
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`📧 Attempt ${attempt}/3...`);

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
      if (err.code) console.error(`   Code: ${err.code}`);

      // Don't retry on auth errors
      if (err.code === "EAUTH") {
        console.error("❌ Authentication failed - check credentials");
        break;
      }

      if (attempt < 3) {
        const waitTime = attempt * 3000;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  console.error(`❌ All attempts failed for ${to}`);
  return { error: lastError?.message || "Unknown error", messageId: "failed" };
}

module.exports = { sendMail };
