// backend/controllers/authController.js
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const imagekit = require("../config/imagekit");
const { sendMail } = require("../config/mailer");
const { validatePassword } = require("../helpers/passwordPolicy");
const { logActivity } = require("../helpers/audit");
const {
  extractDeviceInfo,
  lookupIpLocation,
} = require("../helpers/deviceInfo");

const JWT_SECRET = process.env.JWT_SECRET || "secret";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Helper: generate unique 6-char link code
async function generateLinkCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  let exists = true;
  while (exists) {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE telegram_link_code = ?",
      [code],
    );
    exists = rows.length > 0;
  }
  return code;
}

// Helper: generate JWT token (sid = device session id, when tracking is on)
function generateToken(user, sid) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
  if (sid) payload.sid = sid;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

// Helper: create/update the device session for this login.
// Records WHO logged in from WHERE: device id, name, type, browser, OS,
// screen, timezone, language, platform, hardware, raw user-agent, IP
// (+ best-effort city/country/coordinates/ASN lookup).
// Also writes one audit row per login into device_login_history.
// Returns the new session id (sid) to embed in the JWT, or null if the
// device_sessions table isn't available (login still proceeds).
async function upsertDeviceSession(req, user, method = "email") {
  const info = extractDeviceInfo(req);
  const sid = crypto.randomBytes(16).toString("hex");
  try {
    await db.query(
      `INSERT INTO device_sessions
        (user_id, device_id, session_token, device_name, device_type,
         browser, browser_version, os, os_version, screen, timezone,
         language, platform, hardware, user_agent, ip_address,
         last_login_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         session_token    = VALUES(session_token),
         device_name      = VALUES(device_name),
         device_type      = VALUES(device_type),
         browser          = VALUES(browser),
         browser_version  = VALUES(browser_version),
         os               = VALUES(os),
         os_version       = VALUES(os_version),
         screen           = VALUES(screen),
         timezone         = VALUES(timezone),
         language         = VALUES(language),
         platform         = VALUES(platform),
         hardware         = VALUES(hardware),
         user_agent       = VALUES(user_agent),
         ip_address       = VALUES(ip_address),
         login_count      = login_count + 1,
         last_login_at    = NOW(),
         last_active_at   = NOW(),
         revoked          = 0,
         revoked_at       = NULL`,
      [
        user.id,
        info.deviceId,
        sid,
        info.deviceName,
        info.deviceType,
        info.browser,
        info.browserVersion,
        info.os,
        info.osVersion,
        info.screen,
        info.timezone,
        info.language,
        info.platform,
        info.hardware,
        info.userAgent,
        info.ip_address,
      ],
    );
  } catch (err) {
    console.error("Device session upsert failed:", err.message);
    return null;
  }
  // Audit trail: one row per login event (own try/catch — a missing
  // history table must never break the session/revocation machinery).
  try {
    await db.query(
      `INSERT INTO device_login_history
        (user_id, device_id, device_name, method, ip_address,
         browser, os, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        info.deviceId,
        info.deviceName,
        method,
        info.ip_address,
        `${info.browser}${info.browserVersion ? " " + info.browserVersion.split(".")[0] : ""}`,
        `${info.os}${info.osVersion ? " " + info.osVersion : ""}`,
        info.userAgent,
      ],
    );
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE")
      console.error("Login history insert failed:", err.message);
  }
  // Enrich with city/country/coordinates/ASN from the IP (never blocks,
  // never throws). Updates BOTH the session row and the newest audit row.
  lookupIpLocation(info.ip_address).then((loc) => {
    if (!loc) return;
    db.query(
      `UPDATE device_sessions
       SET city      = COALESCE(city, ?),
           region    = COALESCE(region, ?),
           country   = COALESCE(country, ?),
           isp       = COALESCE(isp, ?),
           latitude  = COALESCE(latitude, ?),
           longitude = COALESCE(longitude, ?),
           asn       = COALESCE(asn, ?),
           org       = COALESCE(org, ?),
           is_proxy  = ?,
           is_hosting = ?
       WHERE session_token = ?`,
      [
        loc.city,
        loc.region,
        loc.country,
        loc.isp,
        loc.latitude,
        loc.longitude,
        loc.asn,
        loc.org,
        loc.isProxy ? 1 : 0,
        loc.isHosting ? 1 : 0,
        sid,
      ],
    ).catch(() => {});
    db.query(
      `UPDATE device_login_history
       SET city = ?, region = ?, country = ?, asn = ?
       WHERE user_id = ? AND device_id = ?
       ORDER BY id DESC LIMIT 1`,
      [loc.city, loc.region, loc.country, loc.asn, user.id, info.deviceId],
    ).catch(() => {});
  });
  return sid;
}

// Cache of the users-table columns. Some deployed databases were created
// from an older schema (e.g. without full_name) — inspecting once and
// building queries dynamically keeps Google sign-in working everywhere.
let usersColumnsCache = null;
async function getUsersColumns() {
  if (!usersColumnsCache) {
    const [cols] = await db.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
    );
    usersColumnsCache = new Set(cols.map((c) => c.name));
  }
  return usersColumnsCache;
}

// ─── REGISTER (Owner only) ──────────────────────────────────
exports.register = async (req, res) => {
  const { email, password, fullName } = req.body;

  // Validation — only email + password are needed to create the account.
  // The owner adds their restaurant(s) after login.
  if (!email || !email.trim())
    return res.status(400).json({ error: "Email is required" });

  // Strong password policy (see helpers/passwordPolicy.js)
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid)
    return res.status(400).json({
      error: "Password must contain: " + pwCheck.errors.join(", "),
    });

  try {
    // Check email uniqueness
    const [emailCheck] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email.trim()],
    );
    if (emailCheck.length)
      return res.status(409).json({ error: "Email already registered" });

    // Generate email verify token
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (owner) — inactive until email is verified.
    // NOTE: no restaurant is auto-created here; the owner adds one
    // after logging in (one account → many restaurants).
    await db.query(
      `INSERT INTO users (email, password, role, status, email_verify_token)
       VALUES (?, ?, 'owner', 'inactive', ?)`,
      [email.trim(), hashedPassword || "", verifyToken],
    );

    // Send verification email (non-blocking - don't await)
    const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
    sendMail({
      to: email.trim(),
      subject: "Verify your email - Digital Menu",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="width: 48px; height: 48px; background: #166534; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
          </div>
          <h2 style="color: #14532d; text-align: center; margin-bottom: 16px;">Welcome to Digital Menu!</h2>
          <p style="color: #4a6650; line-height: 1.6; margin-bottom: 20px;">
            Thank you for registering. Please verify your email address to activate your account and start using Digital Menu.
          </p>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #166534, #22c55e); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            Or copy this link into your browser:<br/>
            <a href="${verifyUrl}" style="color: #22c55e; word-break: break-all;">${verifyUrl}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 11px; text-align: center;">
            This link expires in 24 hours. If you didn't create this account, please ignore this email.
          </p>
        </div>
      `,
    }).catch(err => console.error("Background email send failed:", err.message));

    // Don't return a token — user must verify email first
    logActivity({
      userId,
      action: "register",
      description: `New ${role} account registered: ${email.trim()}`,
      ipAddress: req.ip,
    });
    res.status(201).json({
      token: null,
      user: null,
      restaurant: null,
      restaurants: [],
      message: "Registration successful! Please check your email to verify your account.",
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
};

// ─── LOGIN ──────────────────────────────────────────────────
// Shared credential check for BOTH login entries:
//   • POST /api/auth/login               → owners only
//   • POST /api/auth/login/super-admin   → super admins only
// The role gate guarantees a super admin can ONLY obtain a session through the
// dedicated Super Admin portal endpoint (returned as `code` so the frontend can
// render a helpful redirect instead of a generic "Invalid credentials").
async function attemptLogin(
  req,
  email,
  password,
  { requireSuperAdmin = false } = {},
) {
  if (!email || !password)
    return { status: 400, error: "Email and password required" };

  const [rows] = await db.query(
    `SELECT u.* FROM users u WHERE u.email = ?`,
    [email],
  );
  if (!rows.length) return { status: 401, error: "Invalid credentials" };

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) return { status: 401, error: "Invalid credentials" };

  // ── Role gating — super admins can ONLY sign in via the dedicated route ──
  if (requireSuperAdmin && user.role !== "super_admin") {
    return {
      status: 403,
      error: "This account is not a super admin.",
      code: "not_super_admin",
    };
  }
  if (!requireSuperAdmin && user.role === "super_admin") {
    return {
      status: 401,
      error:
        "Super admin accounts must sign in via the dedicated Super Admin portal (/login/super-admin).",
      code: "super_admin_use_dedicated_route",
    };
  }

  if (user.status === "suspended") {
    return {
      status: 403,
      error: "Your account has been suspended. Contact support.",
    };
  }
  if (user.status === "inactive" && !user.email_verified_at) {
    return {
      status: 403,
      error: "Please verify your email before logging in.",
    };
  }

  // Update last login
  await db.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [
    user.id,
  ]);

  // Fetch ALL restaurants owned by this account
  const [restaurants] = await db.query(
    `SELECT id, name, logo_url AS logoUrl, telegram_chat_id AS telegramChatId,
            telegram_link_code AS telegramLinkCode, default_language AS defaultLanguage,
            theme_color AS themeColor,
            sidebar_position AS sidebarPosition,
            currency, exchange_rate AS exchangeRate,
            status
     FROM restaurants WHERE owner_id = ? ORDER BY id ASC`,
    [user.id],
  );

  const method = requireSuperAdmin ? "super_admin_login" : "email";
  const sid = await upsertDeviceSession(req, user, method);
  const token = generateToken(user, sid);

  logActivity({
    userId: user.id,
    action: "login",
    description: `${requireSuperAdmin ? "Super admin" : "Owner"} logged in (${method}): ${user.email}`,
    ipAddress: req.ip,
  });

  return {
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: !!user.email_verified_at,
      },
      restaurants,
    },
  };
}

// Owner / regular account login (super admins are rejected here on purpose —
// they must use /api/auth/login/super-admin via the /login/super-admin page).
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await attemptLogin(req, email, password);
    if (result.error)
      return res.status(result.status).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
    res.json(result.data);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// Dedicated Super Admin login — ONLY accounts with role = super_admin pass.
exports.superAdminLogin = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await attemptLogin(req, email, password, {
      requireSuperAdmin: true,
    });
    if (result.error)
      return res.status(result.status).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
    res.json(result.data);
  } catch (err) {
    console.error("Super admin login error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── VERIFY EMAIL ──────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token)
    return res.status(400).json({ error: "Verification token required" });

  try {
    const [rows] = await db.query(
      "SELECT id FROM users WHERE email_verify_token = ? AND email_verified_at IS NULL",
      [token],
    );
    if (!rows.length)
      return res.status(400).json({ error: "Invalid or expired token" });

    await db.query(
      "UPDATE users SET email_verified_at = NOW(), email_verify_token = NULL, status = 'active' WHERE id = ?",
      [rows[0].id],
    );

    res.json({ message: "Email verified successfully! You can now log in." });
  } catch (err) {
    console.error("Verify email error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── RESEND VERIFICATION EMAIL ─────────────────────────────
exports.resendVerification = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const [rows] = await db.query(
      "SELECT id, email, email_verified_at FROM users WHERE email = ? AND role = 'owner'",
      [email.trim()],
    );
    if (!rows.length)
      return res.status(404).json({ error: "No account found with this email" });
    if (rows[0].email_verified_at)
      return res.status(400).json({ error: "Email already verified" });

    const verifyToken = crypto.randomBytes(32).toString("hex");
    await db.query(
      "UPDATE users SET email_verify_token = ? WHERE id = ?",
      [verifyToken, rows[0].id],
    );

    const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
    sendMail({
      to: email.trim(),
      subject: "Verify your email - Digital Menu",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="width: 48px; height: 48px; background: #166534; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
          </div>
          <h2 style="color: #14532d; text-align: center; margin-bottom: 16px;">Verify your email address</h2>
          <p style="color: #4a6650; line-height: 1.6; margin-bottom: 20px;">
            Click the button below to verify your email address and activate your Digital Menu account.
          </p>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #166534, #22c55e); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            Or copy this link into your browser:<br/>
            <a href="${verifyUrl}" style="color: #22c55e; word-break: break-all;">${verifyUrl}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 11px; text-align: center;">
            This link expires in 24 hours. If you didn't request this, please ignore this email.
          </p>
        </div>
      `,
    }).catch(err => console.error("Background email send failed:", err.message));

    res.json({ message: "Verification email has been sent. Please check your inbox." });
  } catch (err) {
    console.error("Resend verification error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── FORGOT PASSWORD ───────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const [rows] = await db.query(
      "SELECT id, email FROM users WHERE email = ? AND role = 'owner'",
      [email],
    );
    if (!rows.length)
      return res
        .status(404)
        .json({ error: "No account found with this email" });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)",
      [rows[0].id, token, expiresAt],
    );

    // Send password reset email (non-blocking - don't await)
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
    const html = `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08); border: 1px solid #e5f0e8;">
        <div style="background: linear-gradient(135deg, #0f766e 0%, #22c55e 100%); padding: 32px 24px; text-align: center; padding-top: 50px;">
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0;">Digital Menu</h1>
          <p style="color: rgba(255, 255, 255, 0.85); font-size: 13px; margin-top: 6px;">Reset your password</p>
        </div>
        <div style="padding: 32px 28px;">
          <p style="color: #374151; font-size: 15px; line-height: 1.7; margin-top: 0;">
            Hello,
          </p>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.7;">
            You requested a password reset for your Digital Menu account. Click the button below to set a new password.
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #22c55e); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 14px rgba(234, 88, 12, 0.3);">
              Reset Password
            </a>
          </div>
          <p style="color: #6b7280; font-size: 12px; line-height: 1.6; text-align: center;">
            This link expires in <strong>1 hour</strong>.<br/>
            If the button above doesn't work, copy and paste this link into your browser:
          </p>
          <div style="background: #f8faf7; border: 1px dashed #d1d5db; border-radius: 8px; padding: 10px 14px; margin-top: 10px; word-break: break-all;">
            <a href="${resetUrl}" style="color: #22c55e; font-size: 12px; text-decoration: none;">${resetUrl}</a>
          </div>
        </div>
        <div style="background: #f9fafb; border-top: 1px solid #e5f0e8; padding: 18px 28px; text-align: center;">
          <p style="color: #9ca3af; font-size: 11px; margin: 0;">
            If you didn't request a password reset, please ignore this email.<br/>
            © ${new Date().getFullYear()} Digital Menu. All rights reserved.
          </p>
        </div>
      </div>
    `;
    sendMail({
      to: email.trim(),
      subject: "Reset your password - Digital Menu",
      html,
    }).catch(err => console.error("Background email send failed:", err.message));

    res.json({ message: "Password reset link has been sent to your email." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── RESET PASSWORD ────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: "Token and password required" });

  // Same strong password policy as registration
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid)
    return res.status(400).json({
      error: "Password must contain: " + pwCheck.errors.join(", "),
    });

  try {
    const [rows] = await db.query(
      "SELECT id, user_id FROM password_resets WHERE token = ? AND expires_at > NOW() AND used_at IS NULL",
      [token],
    );
    if (!rows.length)
      return res.status(400).json({ error: "Invalid or expired token" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [
      hashedPassword,
      rows[0].user_id,
    ]);
    await db.query("UPDATE password_resets SET used_at = NOW() WHERE id = ?", [
      rows[0].id,
    ]);

    res.json({ message: "Password reset successfully! You can now log in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── GET CURRENT USER ──────────────────────────────────────
exports.me = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.role, u.email_verified_at, u.status, u.created_at
       FROM users u WHERE u.id = ?`,
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const user = rows[0];

    // Fetch ALL restaurants owned by this account
    const [restaurants] = await db.query(
      `SELECT id, name, logo_url AS logoUrl, telegram_chat_id AS telegramChatId,
              telegram_link_code AS telegramLinkCode, default_language AS defaultLanguage,
              theme_color AS themeColor,
              sidebar_position AS sidebarPosition,
              currency, exchange_rate AS exchangeRate,
              status
       FROM restaurants WHERE owner_id = ? ORDER BY id ASC`,
      [req.user.id],
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: !!user.email_verified_at,
        status: user.status,
        createdAt: user.created_at,
      },
      restaurants,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE ACCOUNT (email / password) ──────────────────────
// Lets a logged-in user change their OWN email address and/or password.
//   • Email change  → a fresh verification token is issued, the address is
//     marked unverified and the account returns to `inactive` until the NEW
//     email is verified (protects against typo'd addresses locking the owner
//     out of their account).
//   • Password change → re-hashed with bcrypt (same policy as registration).
//   • Both changes require the CURRENT password, except for accounts that have
//     no password set (Google-only signups) — their session is the proof.
// A fresh JWT is returned because the old one carries the stale email.
exports.updateAccount = async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  try {
    const [rows] = await db.query(
      "SELECT id, email, password, email_verified_at, status FROM users WHERE id = ?",
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const user = rows[0];

    const newEmail = email && typeof email === "string" ? email.trim().toLowerCase() : "";
    const wantsEmail = newEmail && newEmail !== user.email.toLowerCase();
    const wantsPassword = !!(newPassword && String(newPassword).trim().length > 0);

    if (!wantsEmail && !wantsPassword)
      return res.status(400).json({ error: "No changes requested" });

    // ── Verify the current password (skip only if account has none) ──
    if (user.password) {
      if (!currentPassword)
        return res.status(400).json({ error: "Current password is required" });
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match)
        return res.status(401).json({ error: "Current password is incorrect" });
    }

    // ── Email change ──
    let verifyToken = null;
    if (wantsEmail) {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!EMAIL_RE.test(newEmail))
        return res.status(400).json({ error: "Please enter a valid email address" });

      const [dupes] = await db.query(
        "SELECT id FROM users WHERE email = ? AND id <> ?",
        [newEmail, user.id],
      );
      if (dupes.length)
        return res.status(400).json({ error: "This email is already in use" });

      verifyToken = crypto.randomBytes(32).toString("hex");
      await db.query(
        "UPDATE users SET email = ?, email_verify_token = ?, email_verified_at = NULL, status = 'inactive' WHERE id = ?",
        [newEmail, verifyToken, user.id],
      );

      const verifyUrl = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
      const html = [
        '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden;">',
        '<div style="background: linear-gradient(135deg, #166534, #14532d); padding: 22px 0; text-align: center;">',
        '<h2 style="color: #fff; margin: 0; font-size: 18px;">Verify your NEW email address</h2>',
        "</div>",
        '<div style="padding: 28px;">',
        '<p style="color: #4a6650; line-height: 1.6; margin-bottom: 20px;">',
        `Your account email was recently changed to <strong>${newEmail}</strong>.`,
        "Please verify this new address to keep your account active.",
        "</p>",
        '<div style="text-align: center; margin-bottom: 24px;">',
        `<a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #166534, #22c55e); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px;">`,
        "Verify Email Address",
        "</a>",
        "</div>",
        '<p style="color: #6b7280; font-size: 12px; text-align: center;">',
        "Or copy this link into your browser:<br/>",
        `<a href="${verifyUrl}" style="color: #22c55e; word-break: break-all;">${verifyUrl}</a>`,
        "</p>",
        '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />',
        '<p style="color: #9ca3af; font-size: 11px; text-align: center;">',
        "This link expires in 24 hours. If you didn't make this change, please contact support.",
        "</p>",
        "</div>",
        "</div>",
      ].join("");
      sendMail({
        to: newEmail,
        subject: "Verify your new email - Digital Menu",
        html,
      }).catch((err) => console.error("Background email send failed:", err.message));
    }

    // ── Password change ──
    if (wantsPassword) {
      const pwCheck = validatePassword(String(newPassword));
      if (!pwCheck.valid)
        return res.status(400).json({
          error: "Password must contain: " + pwCheck.errors.join(", "),
        });
      const hashedPassword = await bcrypt.hash(String(newPassword), 10);
      await db.query("UPDATE users SET password = ? WHERE id = ?", [
        hashedPassword,
        user.id,
      ]);
    }

    // ── Refresh session with a token that carries the current email ──
    const [freshRows] = await db.query(
      "SELECT id, email, role, email_verified_at, status, created_at FROM users WHERE id = ?",
      [req.user.id],
    );
    const fresh = freshRows[0];
    // Keep the same device session (sid) so this device stays signed in and
    // remains revocable from the Devices panel.
    const token = generateToken(fresh, req.user.sid);

    logActivity({
      userId: user.id,
      action: "update_account",
      description: `Account email/password updated for: ${fresh.email}`,
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: {
        id: fresh.id,
        email: fresh.email,
        role: fresh.role,
        emailVerified: !!fresh.email_verified_at,
        status: fresh.status,
        createdAt: fresh.created_at,
      },
      message:
        wantsEmail && wantsPassword
          ? "Email and password updated. Please verify your new email address."
          : wantsEmail
            ? "Email updated. A verification link was sent to your new address."
            : "Password updated successfully.",
    });
  } catch (err) {
    console.error("Update account error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── CREATE RESTAURANT (owner adds another restaurant) ─────
exports.createRestaurant = async (req, res) => {
  const { name } = req.body;
  let logoUrl = null;

  if (!name || !name.trim())
    return res.status(400).json({ error: "Restaurant name is required" });

  // Handle optional logo upload
  if (req.file) {
    try {
      const imagekit = require("../config/imagekit");
      const base64 = req.file.buffer.toString("base64");
      const dataUri = `data:${req.file.mimetype};base64,${base64}`;
      const uploadResult = await imagekit.upload({
        file: dataUri,
        fileName: `logo_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")}`,
        folder: "/restaurant_logos",
        useUniqueFileName: true,
      });
      logoUrl = uploadResult.url;
    } catch (uploadErr) {
      console.error("Logo upload error:", uploadErr.message);
    }
  }

  try {
    // ─── Duplicate guard: one account cannot own two restaurants with the
    // same name (case-insensitive — utf8mb4_unicode_ci compares "My Cafe"
    // and "my cafe" as equal, matching the UNIQUE(owner_id, name) index).
    const [dupRows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? AND name = ? LIMIT 1",
      [req.user.id, name.trim()],
    );
    if (dupRows.length) {
      return res.status(409).json({
        error: `You already have a restaurant named "${name.trim()}"`,
        code: "DUPLICATE_RESTAURANT",
      });
    }

    const linkCode = await generateLinkCode();

    const [restaurantResult] = await db.query(
      `INSERT INTO restaurants (owner_id, name, logo_url, telegram_link_code, default_language)
       VALUES (?, ?, ?, ?, 'km')`,
      [req.user.id, name.trim(), logoUrl, linkCode],
    );
    const restaurantId = restaurantResult.insertId;

    // Create a default menu + default category so the restaurant is immediately usable
    const [menuResult] = await db.query(
      "INSERT INTO menus (restaurant_id, name, sort_order) VALUES (?, 'Default Menu', 0)",
      [restaurantId],
    );
    await db.query(
      "INSERT INTO categories (restaurant_id, menu_id, name) VALUES (?, ?, 'ម្ហូបទូទៅ')",
      [restaurantId, menuResult.insertId],
    );

    const [row] = await db.query(
      `SELECT id, name, logo_url AS logoUrl, telegram_chat_id AS telegramChatId,
              telegram_link_code AS telegramLinkCode, default_language AS defaultLanguage,
              theme_color AS themeColor,
              sidebar_position AS sidebarPosition,
              currency, exchange_rate AS exchangeRate,
              status
       FROM restaurants WHERE id = ?`,
      [restaurantId],
    );
    res.status(201).json({ restaurant: row[0] });
  } catch (err) {
    // Race safety: the UNIQUE(owner_id, name) index is the final authority.
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: `You already have a restaurant named "${name.trim()}"`,
        code: "DUPLICATE_RESTAURANT",
      });
    }
    console.error("Create restaurant error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
};

// Helper: resolve a restaurant owned by the current user; falls back to the
// first owned restaurant when no restaurant_id is supplied (legacy behavior).
async function resolveOwnerRestaurant(req) {
  const requested = parseInt(req.body.restaurant_id || req.query.restaurant_id || 0);
  if (requested) {
    const [rows] = await db.query(
      "SELECT id FROM restaurants WHERE id = ? AND owner_id = ?",
      [requested, req.user.id]
    );
    if (rows.length) return rows[0].id;
    return null;
  }
  const [rows] = await db.query(
    "SELECT id FROM restaurants WHERE owner_id = ? ORDER BY id ASC LIMIT 1",
    [req.user.id]
  );
  return rows.length ? rows[0].id : null;
}

// ─── TELEGRAM LINK CODE ────────────────────────────────────
exports.getLinkCode = async (req, res) => {
  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    const [rows] = await db.query(
      "SELECT telegram_link_code, telegram_chat_id FROM restaurants WHERE id = ?",
      [restaurantId],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Restaurant not found" });
    res.json({
      restaurantId,
      linkCode: rows[0].telegram_link_code,
      telegramChatId: rows[0].telegram_chat_id,
      isLinked: !!rows[0].telegram_chat_id,
    });
  } catch (err) {
    console.error("Get link code error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UNLINK TELEGRAM ───────────────────────────────────────
exports.unlinkTelegram = async (req, res) => {
  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    await db.query(
      "UPDATE restaurants SET telegram_chat_id = NULL WHERE id = ?",
      [restaurantId],
    );
    res.json({ success: true, message: "Telegram unlinked" });
  } catch (err) {
    console.error("Unlink Telegram error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE RESTAURANT PROFILE ─────────────────────────────
exports.updateRestaurant = async (req, res) => {
  const { name } = req.body;
  let logoUrl = req.body.logoUrl;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Restaurant name is required" });
  }

  // Handle logo upload if provided
  if (req.file) {
    try {
      const imagekit = require("../config/imagekit");
      const base64 = req.file.buffer.toString("base64");
      const dataUri = `data:${req.file.mimetype};base64,${base64}`;
      const uploadResult = await imagekit.upload({
        file: dataUri,
        fileName: `logo_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")}`,
        folder: "/restaurant_logos",
        useUniqueFileName: true,
      });
      logoUrl = uploadResult.url;
    } catch (uploadErr) {
      console.error("Logo upload error:", uploadErr.message);
    }
  }

  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    // ─── Duplicate guard: renaming must not collide with another restaurant
    // owned by the same account (case-insensitive, matching the DB index).
    const [dupRows] = await db.query(
      "SELECT id FROM restaurants WHERE owner_id = ? AND name = ? AND id != ? LIMIT 1",
      [req.user.id, name.trim(), restaurantId],
    );
    if (dupRows.length) {
      return res.status(409).json({
        error: `You already have a restaurant named "${name.trim()}"`,
        code: "DUPLICATE_RESTAURANT",
      });
    }

    await db.query(
      "UPDATE restaurants SET name = ?, logo_url = COALESCE(?, logo_url) WHERE id = ?",
      [name.trim(), logoUrl || null, restaurantId],
    );

    // Fetch updated restaurant
    const [rows] = await db.query(
      `SELECT id, name, logo_url, telegram_chat_id, telegram_link_code, default_language, theme_color, sidebar_position
       FROM restaurants WHERE id = ?`,
      [restaurantId],
    );

    const r = rows[0];
    res.json({
      success: true,
      restaurant: {
        id: r.id,
        name: r.name,
        logoUrl: r.logo_url,
        telegramChatId: r.telegram_chat_id,
        telegramLinkCode: r.telegram_link_code,
        defaultLanguage: r.default_language,
        themeColor: r.theme_color,
        sidebarPosition: r.sidebar_position,
      },
    });
  } catch (err) {
    console.error("Update restaurant error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE RESTAURANT THEME COLOR ─────────────────────────
// Saves the owner's chosen dynamic theme color to their (current)
// restaurant so the public customer menu / preview applies it too.
exports.updateTheme = async (req, res) => {
  const { themeColor } = req.body;
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  if (!themeColor || typeof themeColor !== "string" || !HEX_RE.test(themeColor.trim())) {
    return res.status(400).json({ error: "Invalid theme color" });
  }

  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    await db.query("UPDATE restaurants SET theme_color = ? WHERE id = ?", [
      themeColor.trim(),
      restaurantId,
    ]);
    res.json({ success: true, themeColor: themeColor.trim() });
  } catch (err) {
    console.error("Update theme error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE RESTAURANT CURRENCY ────────────────────────────
// Prices are stored in riel; this picks how money is DISPLAYED
// (៛ KHR or $ USD) and the exchange rate used for the conversion.
// Mirrors updateTheme/updateSidebar: owner-scoped, validated, simple.
exports.updateCurrency = async (req, res) => {
  const cur = String(req.body.currency || "").toUpperCase();
  if (!["KHR", "USD"].includes(cur))
    return res.status(400).json({ error: "Invalid currency" });

  const rate = Number(req.body.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0)
    return res.status(400).json({ error: "Invalid exchange rate" });

  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    await db.query(
      "UPDATE restaurants SET currency = ?, exchange_rate = ? WHERE id = ?",
      [cur, rate, restaurantId],
    );
    res.json({ success: true, currency: cur, exchangeRate: rate });
  } catch (err) {
    console.error("Update currency error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE RESTAURANT SIDEBAR POSITION ────────────────────
// Lets the owner choose where their admin sidebar sits: left / right / top / bottom.
exports.updateSidebar = async (req, res) => {
  const { sidebarPosition } = req.body;
  const allowed = ["left", "right", "top", "bottom"];
  if (!allowed.includes(sidebarPosition))
    return res.status(400).json({ error: "Invalid sidebar position" });

  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    await db.query("UPDATE restaurants SET sidebar_position = ? WHERE id = ?", [
      sidebarPosition,
      restaurantId,
    ]);
    res.json({ success: true, sidebarPosition });
  } catch (err) {
    console.error("Update sidebar error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE RESTAURANT LANGUAGE ────────────────────────────
exports.updateLanguage = async (req, res) => {
  const { language } = req.body;
  if (!["km", "en"].includes(language))
    return res.status(400).json({ error: "Invalid language" });
  try {
    const restaurantId = await resolveOwnerRestaurant(req);
    if (!restaurantId)
      return res.status(404).json({ error: "Restaurant not found" });

    await db.query(
      "UPDATE restaurants SET default_language = ? WHERE id = ?",
      [language, restaurantId],
    );
    res.json({ success: true, language });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ─── GOOGLE SIGN-IN ─────────────────────────────────────────
// Receives a Google ID token (credential) from Google Identity Services on
// the frontend, verifies it, links/creates the local account and issues the
// same JWT used by email/password login.
exports.googleLogin = async (req, res) => {
  const { credential } = req.body;
  if (!credential)
    return res.status(400).json({ error: "Google credential is required" });

  // Accept one or more client IDs (comma-separated) so dev/prod can share the route
  const googleClientIds = (process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!googleClientIds.length)
    return res
      .status(500)
      .json({ error: "Google Sign-In is not configured on the server" });

  // 1) Verify the ID token with Google (checks signature, audience & expiry)
  let payload;
  try {
    const { OAuth2Client } = require("google-auth-library");
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: googleClientIds,
    });
    payload = ticket.getPayload();
  } catch (verifyErr) {
    console.error("Google token verification failed:", verifyErr.message);
    return res.status(401).json({ error: "Invalid Google token" });
  }

  const googleId = payload.sub;
  const email = payload.email;
  const fullName = payload.name || "";
  if (!googleId || !email)
    return res.status(401).json({ error: "Invalid Google token" });
  if (payload.email_verified === false)
    return res
      .status(401)
      .json({ error: "Your Google email is not verified" });

  try {
    // 2) Find by google_id (returning Google users) …
    let [rows] = await db.query("SELECT * FROM users WHERE google_id = ?", [
      googleId,
    ]);
    let user = rows[0] || null;

    // … else link the Google account to an existing email account
    if (!user) {
      [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
      if (rows.length) {
        user = rows[0];
        await db.query("UPDATE users SET google_id = ? WHERE id = ?", [
          googleId,
          user.id,
        ]);
        user.google_id = googleId;
      }
    }

    // … else create a brand-new owner account (email already verified by Google)
    if (!user) {
      // The password column is NOT NULL — store an unusable random hash so
      // this account can only be signed into via Google.
      const unusablePassword = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        10,
      );
      // Build the INSERT from the columns that actually exist in this
      // database (older schemas may lack full_name). email_verified_at is
      // always set to NOW() server-side, so it stays out of the placeholders.
      const cols = await getUsersColumns();
      const insertCols = ["email", "password", "role", "status"];
      const insertVals = [email, unusablePassword, "owner", "active"];
      if (cols.has("full_name")) {
        insertCols.splice(2, 0, "full_name");
        insertVals.splice(2, 0, fullName);
      }
      const placeholders = insertCols.map(() => "?").join(", ");
      const [result] = await db.query(
        `INSERT INTO users (${insertCols.join(", ")}, email_verified_at)
         VALUES (${placeholders}, NOW())`,
        insertVals,
      );
      [rows] = await db.query("SELECT * FROM users WHERE id = ?", [
        result.insertId,
      ]);
      user = rows[0];
    } else if (!user.email_verified_at || user.status === "inactive") {
      // Google already verified this email — activate the account
      await db.query(
        "UPDATE users SET email_verified_at = NOW(), email_verify_token = NULL, status = 'active' WHERE id = ?",
        [user.id],
      );
      user.email_verified_at = user.email_verified_at || new Date();
      user.status = "active";
    }

    if (user.status === "suspended")
      return res
        .status(403)
        .json({ error: "Your account has been suspended. Contact support." });

    // ── Role gating (same rule as email/password login) ──
    // The regular login pages can't create a session for a super admin, and the
    // dedicated Super Admin portal can't create one for a non-super-admin.
    const superAdminOnly =
      req.body.superAdminOnly === true || req.body.superAdminOnly === "true";
    if (superAdminOnly && user.role !== "super_admin") {
      return res.status(403).json({
        error: "This account is not a super admin.",
        code: "not_super_admin",
      });
    }
    if (!superAdminOnly && user.role === "super_admin") {
      return res.status(401).json({
        error:
          "Super admin accounts must sign in via the dedicated Super Admin portal (/login/super-admin).",
        code: "super_admin_use_dedicated_route",
      });
    }

    // Update last login
    await db.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [
      user.id,
    ]);

    // Fetch ALL restaurants owned by this account (same shape as /auth/login)
    const [restaurants] = await db.query(
      `SELECT id, name, logo_url AS logoUrl, telegram_chat_id AS telegramChatId,
              telegram_link_code AS telegramLinkCode, default_language AS defaultLanguage,
              theme_color AS themeColor,
              sidebar_position AS sidebarPosition,
              currency, exchange_rate AS exchangeRate,
              status
       FROM restaurants WHERE owner_id = ? ORDER BY id ASC`,
      [user.id],
    );

    const sid = await upsertDeviceSession(req, user, "google");
    const token = generateToken(user, sid);

    logActivity({
      userId: user.id,
      action: "google_login",
      description: `User signed in with Google: ${user.email}`,
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: true,
      },
      restaurants,
    });
  } catch (err) {
    console.error("Google login error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── DEVICE SESSIONS (owner security) ──────────────────────
// The owner can see EVERY device that has accessed the account and
// revoke any of them. Revoking flips `revoked = 1`; the auth middleware
// then rejects that device's token with code "device_revoked".

// GET /api/auth/devices — list all devices for the logged-in account
exports.listDevices = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, device_id AS deviceId, device_name AS deviceName,
              device_type AS deviceType, browser, browser_version AS browserVersion,
              os, os_version AS osVersion, screen, timezone, language,
              platform, hardware,
              user_agent AS userAgent,
              ip_address AS ipAddress, city, region, country, isp,
              latitude, longitude, asn, org,
              is_proxy AS isProxy, is_hosting AS isHosting,
              login_count AS loginCount, last_active_at AS lastActiveAt,
              last_login_at AS lastLoginAt, created_at AS firstSeenAt,
              (session_token IS NOT NULL AND session_token = ?) AS isCurrent,
              revoked, revoked_at AS revokedAt
       FROM device_sessions
       WHERE user_id = ?
       ORDER BY revoked ASC, last_active_at DESC`,
      [req.user.sid || "", req.user.id],
    );
    res.json(rows);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); // not migrated yet
    console.error("List devices error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// GET /api/auth/devices/history — audit trail of login events
// (one row per login: when, which device, method, IP, location).
exports.listLoginHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, device_id AS deviceId, device_name AS deviceName,
              method, ip_address AS ipAddress, city, region, country,
              asn, browser, os, created_at AS at
       FROM device_login_history
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 50`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return res.json([]); // not migrated yet
    console.error("List login history error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/auth/devices/:id — remove (revoke) one device
exports.revokeDevice = async (req, res) => {
  try {
    const [result] = await db.query(
      "UPDATE device_sessions SET revoked = 1, revoked_at = NOW() WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "Device not found" });
    res.json({ message: "Device removed successfully" });
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE")
      return res.status(404).json({ error: "Device not found" });
    console.error("Revoke device error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// DELETE /api/auth/devices — sign out every other device (keep current one)
exports.revokeAllOtherDevices = async (req, res) => {
  try {
    const [result] = await db.query(
      `UPDATE device_sessions
       SET revoked = 1, revoked_at = NOW()
       WHERE user_id = ? AND revoked = 0
         AND (session_token IS NULL OR session_token <> ?)`,
      [req.user.id, req.user.sid || ""],
    );
    res.json({
      message: "All other devices signed out",
      count: result.affectedRows,
    });
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return res.json({ count: 0 });
    console.error("Revoke all devices error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
