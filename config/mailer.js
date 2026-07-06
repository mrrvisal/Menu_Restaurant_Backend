const dns = require("dns");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Strip spaces from app password
const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// ============================================================
// FORCE IPv4 ONLY - Fix ENETUNREACH on Render
// ============================================================

// Create a custom DNS lookup function that ONLY uses IPv4
function ipv4Lookup(hostname, options, callback) {
  // Force family: 4 to only use IPv4
  dns.lookup(hostname, { family: 4 }, (err, address, family) => {
    if (err) {
      console.error(`DNS lookup failed for ${hostname}:`, err.message);
      return callback(err);
    }
    console.log(`DNS resolved ${hostname} -> ${address} (IPv4)`);
    callback(null, address, family);
  });
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: 587,
  secure: false, // STARTTLS
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
  // TLS configuration
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
  // Timeout settings
  connectionTimeout: 30000, // 30 seconds
  greetingTimeout: 30000,
  socketTimeout: 30000,
});

// Verify connection
let mailerReady = false;
let mailerError = null;

transporter.verify((err) => {
  if (err) {
    console.error("❌ Mailer verification FAILED:", err.message);
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
 * Send an email with retry logic
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);
  console.log(`   Using host: ${process.env.SMTP_HOST}, port: 587`);

  // Check if SMTP is configured
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

  // Try to send with retry
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`📧 Attempt ${attempt}/3 to send email to ${to}...`);

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

      // Don't retry on certain errors
      if (err.code === "EAUTH") {
        console.error("❌ Authentication failed - check SMTP password");
        break;
      }

      // Wait before retry (exponential backoff)
      if (attempt < 3) {
        const waitTime = attempt * 2000;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  console.error(`❌ All attempts failed for ${to}`);
  return { error: lastError?.message || "Unknown error", messageId: "failed" };
}

module.exports = { sendMail };
