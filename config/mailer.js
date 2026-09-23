// ============================================================
// MAILER — one interface, two transports
//   • Gmail SMTP (nodemailer) → SMTP_USER + SMTP_PASS (Google app password)
//   • Brevo (SendinBlue) API  → BREVO_API_KEY (HTTPS/443, works on Render)
// ============================================================
// Transport selection (MAIL_TRANSPORT):
//   auto  (default) → Gmail SMTP when SMTP_USER + SMTP_PASS are set,
//                     otherwise Brevo when BREVO_API_KEY is set,
//                     otherwise emails are only logged (dev mode)
//   smtp            → Gmail/any SMTP always
//   brevo           → Brevo API always
//
// Why Gmail SMTP matters for branding: Gmail shows the sender's Google profile
// photo as the inbox avatar when the From address is a Google account, and it
// never rewrites the From domain — unlike Brevo, which rewrites an
// unauthenticated sender (e.g. @gmail.com) to <id>.brevosend.com.
// ============================================================

const brevo = require("@getbrevo/brevo");
const nodemailer = require("nodemailer");
require("dotenv").config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER;

const MAIL_TRANSPORT = (process.env.MAIL_TRANSPORT || "auto").toLowerCase();

// ─── Gmail / SMTP settings ──────────────────────────────────
const SMTP_USER = process.env.SMTP_USER;
// Google shows app passwords with spaces ("abcd efgh ijkl mnop") — strip them
const SMTP_PASS = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
const smtpConfigured = !!(SMTP_USER && SMTP_PASS);

if (MAIL_TRANSPORT === "smtp" && !smtpConfigured) {
  console.warn(
    "⚠️  MAIL_TRANSPORT=smtp but SMTP_USER/SMTP_PASS are missing — falling back.",
  );
}
const useSmtp =
  smtpConfigured && (MAIL_TRANSPORT === "smtp" || MAIL_TRANSPORT === "auto");
const useBrevo = !useSmtp && !!BREVO_API_KEY;

let brevoClient = null;
if (useBrevo) {
  brevoClient = new brevo.BrevoClient({ apiKey: BREVO_API_KEY });
  console.log("✅ Brevo configured");
}

let smtpTransport = null;
if (useSmtp) {
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log(
    `✅ SMTP configured (${process.env.SMTP_HOST || "smtp.gmail.com"}:` +
      `${process.env.SMTP_PORT || 587}, from: ` +
      `${process.env.SMTP_FROM_EMAIL || SMTP_USER})`,
  );
}

if (!useSmtp && !useBrevo) {
  console.log(
    "📧 No mail credentials (SMTP_USER/SMTP_PASS or BREVO_API_KEY) — " +
      "emails are only logged.",
  );
}

// ─── Gmail / SMTP transport ─────────────────────────────────
async function sendViaSmtp({ to, subject, html }) {
  try {
    const info = await smtpTransport.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || "Digital Menu"}" <${
        process.env.SMTP_FROM_EMAIL || SMTP_USER
      }>`,
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

// ─── Brevo API transport ────────────────────────────────────
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
        const errorBody = typeof err.body === "string" ? JSON.parse(err.body) : err.body;
        console.error("   Details:", errorBody.message || err.body);
      } catch {
        console.error("   Body:", String(err.body).slice(0, 300));
      }
    }
    if (isProd) {
      return { error: "Brevo failed", messageId: "failed" };
    }
    return { error: err.message, messageId: "failed" };
  }
}

/**
 * Send an email with whichever transport is configured (see top of file).
 * Never throws — returns { messageId } on success, { error, messageId:"failed" }
 * on failure, { messageId:"dev-mode" } when no credentials are configured.
 */
async function sendMail({ to, subject, html }) {
  console.log(`📧 Sending email to: ${to}`);

  if (useSmtp) return sendViaSmtp({ to, subject, html });
  if (useBrevo) return sendViaBrevo({ to, subject, html });

  console.log(`📧 [DEV] Email to ${to}: ${subject}`);
  return { messageId: "dev-mode" };
}

module.exports = { sendMail };