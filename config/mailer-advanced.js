const net = require("net");
const dns = require("dns");
const nodemailer = require("nodemailer");
require("dotenv").config();

const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

// ============================================================
// EXTREME IPv4 FORCE - Override net.createConnection
// ============================================================

// Store original function
const originalCreateConnection = net.createConnection;

// Override to force IPv4
net.createConnection = function (options, callback) {
  // If it's a string (host), convert to object
  if (typeof options === "string") {
    options = { host: options };
  }

  // If it's a port and host
  if (typeof options === "number") {
    options = { port: options };
  }

  // Check if we need to resolve host
  if (options.host && options.port) {
    // Force IPv4 lookup
    const host = options.host;
    const port = options.port;

    // Return a promise-based socket
    return new Promise((resolve, reject) => {
      dns.lookup(host, { family: 4 }, (err, address) => {
        if (err) {
          console.error(`❌ DNS lookup failed for ${host}:`, err.message);
          reject(err);
          return;
        }

        console.log(`✅ Creating socket to ${address}:${port} (IPv4)`);

        // Create socket with IPv4 address
        const socket = originalCreateConnection(
          {
            ...options,
            host: address,
            family: 4,
          },
          callback,
        );

        resolve(socket);
      });
    });
  }

  return originalCreateConnection(options, callback);
};

// Create transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: smtpPass,
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  tls: {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
});

// Verify connection
let mailerReady = false;

transporter.verify((err) => {
  if (err) {
    console.error("❌ Mailer verification FAILED:", err.message);
    mailerReady = false;
  } else {
    console.log("✅ Mailer ready to send emails");
    mailerReady = true;
  }
});

async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
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
    return { error: err.message, messageId: "failed" };
  }
}

module.exports = { sendMail };
