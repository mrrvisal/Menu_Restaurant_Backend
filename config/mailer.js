const dns = require("dns");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// ============================================================
// FORCE IPv4 ONLY - Custom DNS lookup
// ============================================================

// Custom DNS lookup that only uses IPv4
function ipv4Lookup(hostname, options, callback) {
  console.log(`🔍 DNS lookup for ${hostname} (IPv4 only)...`);
  dns.lookup(hostname, { family: 4 }, (err, address, family) => {
    if (err) {
      console.error(`❌ DNS lookup failed for ${hostname}:`, err.message);
      return callback(err);
    }
    console.log(`✅ DNS resolved ${hostname} -> ${address} (IPv4)`);
    callback(null, address, family);
  });
}

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true" || false,
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  // Force IPv4 only
  dnsLookup: ipv4Lookup,
  // Connection pooling
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  // Timeout settings
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  // TLS configuration
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
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

  // Check if SMTP is configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    console.log(
      `📧 [DEV] Body: ${html.replace(/<[^>]*>/g, "").substring(0, 200)}...`,
    );
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
      if (err.response) console.error(`   Response: ${err.response}`);

      // Don't retry on authentication errors
      if (err.code === "EAUTH") {
        console.error("❌ Authentication failed - check SMTP credentials");
        break;
      }

      // Wait before retry (exponential backoff)
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
