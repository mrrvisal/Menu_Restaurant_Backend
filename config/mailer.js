const brevo = require("@getbrevo/brevo");
const nodemailer = require("nodemailer");
require("dotenv").config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;
const MAIL_TRANSPORT = (process.env.MAIL_TRANSPORT || "auto").toLowerCase();

// SMTP configuration
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
const smtpConfigured = Boolean(SMTP_USER && SMTP_PASS);

if (MAIL_TRANSPORT === "smtp" && !smtpConfigured) {
  console.warn(
    "⚠️ MAIL_TRANSPORT=smtp but SMTP_USER/SMTP_PASS are missing — falling back.",
  );
}

const useSmtp =
  smtpConfigured && (MAIL_TRANSPORT === "smtp" || MAIL_TRANSPORT === "auto");
const useBrevo = !useSmtp && Boolean(BREVO_API_KEY);

// Setup Brevo API client
let brevoClient = null;
if (useBrevo) {
  brevoClient = new brevo.BrevoClient({ apiKey: BREVO_API_KEY });
  console.log("✅ Brevo configured");
}

// Setup SMTP transporter
let smtpTransport = null;
if (useSmtp) {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

  smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  console.log(
    `✅ SMTP configured (${host}:${port}, from: ${process.env.SMTP_FROM_EMAIL || SMTP_USER})`,
  );
}

if (!useSmtp && !useBrevo) {
  console.log(
    "📧 No mail credentials configured — emails will be logged only.",
  );
}

// Send via SMTP (Gmail or custom host)
async function sendViaSmtp({ to, subject, html }) {
  try {
    const fromName = process.env.SMTP_FROM_NAME || "Digital Menu";
    const fromEmail = process.env.SMTP_FROM_EMAIL || SMTP_USER;

    const info = await smtpTransport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
    });

    console.log(`✅ Email sent via SMTP to ${to}`);
    return { messageId: info.messageId || "sent" };
  } catch (err) {
    console.error("❌ SMTP failed:", err.message);
    return { error: err.message, messageId: "failed" };
  }
}

// Send via Brevo API (HTTPS port 443)
async function sendViaBrevo({ to, subject, html }) {
  try {
    console.log("📧 Using Brevo API...");
    const response = await brevoClient.transactionalEmails.sendTransacEmail({
      subject,
      htmlContent: html,
      sender: {
        name: process.env.BREVO_FROM_NAME || "Digital Menu",
        email: process.env.BREVO_FROM_EMAIL || "noreply@digitalmenu.com",
      },
      to: [{ email: to }],
    });

    console.log(`✅ Email sent via Brevo to ${to}`);
    return { messageId: response.body?.messageId || "sent" };
  } catch (err) {
    console.error("❌ Brevo failed:", err.message);
    if (err.body) {
      try {
        const errorBody =
          typeof err.body === "string" ? JSON.parse(err.body) : err.body;
        console.error("   Details:", errorBody.message || err.body);
      } catch {
        console.error("   Body:", String(err.body).slice(0, 300));
      }
    }
    return {
      error: isProd ? "Brevo failed" : err.message,
      messageId: "failed",
    };
  }
}

/**
 * Send an email with whichever transport is configured.
 * Never throws — returns { messageId } or { error, messageId: "failed" }.
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  if (useSmtp) return sendViaSmtp({ to, subject, html });
  if (useBrevo) return sendViaBrevo({ to, subject, html });

  console.log(`📧 [DEV] Email to ${to}: ${subject}`);
  return { messageId: "dev-mode" };
}

module.exports = { sendMail };
