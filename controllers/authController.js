// backend/controllers/authController.js
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const imagekit = require("../config/imagekit");
const { sendMail } = require("../config/mailer");

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

// Helper: generate JWT token
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

// ─── REGISTER (Owner only) ──────────────────────────────────
exports.register = async (req, res) => {
  const { email, password, fullName, restaurantName } = req.body;
  let logoUrl = null;

  // Validation
  if (!email || !email.trim())
    return res.status(400).json({ error: "Email is required" });
  if (!password || password.length < 6)
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  if (!restaurantName || !restaurantName.trim())
    return res.status(400).json({ error: "Restaurant name is required" });

  // Handle logo file upload
  if (req.file) {
    try {
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
    const linkCode = await generateLinkCode();

    // Create user (owner) — active immediately, no email verification required
    const [userResult] = await db.query(
      `INSERT INTO users (email, password, full_name, role, status, email_verify_token)
       VALUES (?, ?, ?, 'owner', 'active', ?)`,
      [email.trim(), hashedPassword, fullName || "", verifyToken],
    );
    const userId = userResult.insertId;

    // Create restaurant
    const [restaurantResult] = await db.query(
      `INSERT INTO restaurants (owner_id, name, logo_url, telegram_link_code, default_language)
       VALUES (?, ?, ?, ?, 'km')`,
      [userId, restaurantName.trim(), logoUrl, linkCode],
    );
    const restaurantId = restaurantResult.insertId;

    // Create default category
    await db.query(
      "INSERT INTO categories (restaurant_id, name) VALUES (?, ?)",
      [restaurantId, "ម្ហូបទូទៅ"],
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

    const token = generateToken({
      id: userId,
      email: email.trim(),
      role: "owner",
    });

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: email.trim(),
        role: "owner",
        fullName: fullName || "",
      },
      restaurant: {
        id: restaurantId,
        name: restaurantName.trim(),
        logoUrl,
        telegramChatId: null,
        telegramLinkCode: linkCode,
        defaultLanguage: "km",
      },
      message: "Registration successful!",
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
};

// ─── LOGIN ──────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const [rows] = await db.query(
      `SELECT u.*, r.id AS restaurant_id, r.name AS restaurant_name,
              r.logo_url, r.telegram_chat_id, r.telegram_link_code, r.default_language
       FROM users u
       LEFT JOIN restaurants r ON r.owner_id = u.id
       WHERE u.email = ?`,
      [email],
    );
    if (!rows.length)
      return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    if (user.status === "suspended")
      return res
        .status(403)
        .json({ error: "Your account has been suspended. Contact support." });
    if (user.status === "inactive" && !user.email_verified_at) {
      return res
        .status(403)
        .json({ error: "Please verify your email before logging in." });
    }

    // Update last login
    await db.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [
      user.id,
    ]);

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        emailVerified: !!user.email_verified_at,
      },
      restaurant: user.restaurant_id
        ? {
            id: user.restaurant_id,
            name: user.restaurant_name,
            logoUrl: user.logo_url,
            telegramChatId: user.telegram_chat_id,
            telegramLinkCode: user.telegram_link_code,
            defaultLanguage: user.default_language,
          }
        : null,
    });
  } catch (err) {
    console.error("Login error:", err);
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
  if (password.length < 6)
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });

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
      `SELECT u.id, u.email, u.full_name, u.role, u.email_verified_at, u.status, u.created_at,
              r.id AS restaurant_id, r.name AS restaurant_name,
              r.logo_url, r.telegram_chat_id, r.telegram_link_code, r.default_language
       FROM users u
       LEFT JOIN restaurants r ON r.owner_id = u.id
       WHERE u.id = ?`,
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const user = rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        emailVerified: !!user.email_verified_at,
        status: user.status,
        createdAt: user.created_at,
      },
      restaurant: user.restaurant_id
        ? {
            id: user.restaurant_id,
            name: user.restaurant_name,
            logoUrl: user.logo_url,
            telegramChatId: user.telegram_chat_id,
            telegramLinkCode: user.telegram_link_code,
            defaultLanguage: user.default_language,
          }
        : null,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── TELEGRAM LINK CODE ────────────────────────────────────
exports.getLinkCode = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT telegram_link_code, telegram_chat_id FROM restaurants WHERE owner_id = ?",
      [req.user.id],
    );
    if (!rows.length)
      return res.status(404).json({ error: "Restaurant not found" });
    res.json({
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
    await db.query(
      "UPDATE restaurants SET telegram_chat_id = NULL WHERE owner_id = ?",
      [req.user.id],
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
    await db.query(
      "UPDATE restaurants SET name = ?, logo_url = COALESCE(?, logo_url) WHERE owner_id = ?",
      [name.trim(), logoUrl || null, req.user.id],
    );

    // Fetch updated restaurant
    const [rows] = await db.query(
      `SELECT id, name, logo_url, telegram_chat_id, telegram_link_code, default_language
       FROM restaurants WHERE owner_id = ?`,
      [req.user.id],
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Restaurant not found" });
    }

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
      },
    });
  } catch (err) {
    console.error("Update restaurant error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ─── UPDATE RESTAURANT LANGUAGE ────────────────────────────
exports.updateLanguage = async (req, res) => {
  const { language } = req.body;
  if (!["km", "en"].includes(language))
    return res.status(400).json({ error: "Invalid language" });
  try {
    await db.query(
      "UPDATE restaurants SET default_language = ? WHERE owner_id = ?",
      [language, req.user.id],
    );
    res.json({ success: true, language });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
