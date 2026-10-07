const messages = {
  AUTH_INVALID_CREDENTIALS: {
    en: "Invalid email or password.",
    km: "អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។",
  },
  AUTH_REQUIRED: {
    en: "Authentication is required.",
    km: "តម្រូវឱ្យមានការផ្ទៀងផ្ទាត់អត្តសញ្ញាណ។",
  },
  AUTH_SESSION_EXPIRED: {
    en: "Your session has expired.",
    km: "សម័យចូលប្រើរបស់អ្នកបានផុតកំណត់ហើយ។",
  },
  AUTH_INVALID_TOKEN: {
    en: "The token is invalid or has expired.",
    km: "ថូខិនមិនត្រឹមត្រូវ ឬបានផុតកំណត់។",
  },
  AUTH_DEVICE_REVOKED: {
    en: "This device has been signed out by the account owner.",
    km: "ម្ចាស់គណនីបានចាកចេញពីឧបករណ៍នេះ។",
  },
  AUTH_EMAIL_UNVERIFIED: {
    en: "Please verify your email before logging in.",
    km: "សូមផ្ទៀងផ្ទាត់អ៊ីមែលរបស់អ្នក មុនពេលចូលប្រើ។",
  },
  AUTH_FORBIDDEN: {
    en: "You do not have permission to perform this action.",
    km: "អ្នកមិនមានសិទ្ធិអនុវត្តសកម្មភាពនេះទេ។",
  },
  VALIDATION_ERROR: {
    en: "The request is invalid. Check the provided information.",
    km: "សំណើមិនត្រឹមត្រូវទេ។ សូមពិនិត្យព័ត៌មានដែលបានបញ្ចូល។",
  },
  RESOURCE_NOT_FOUND: {
    en: "The requested resource was not found.",
    km: "រកមិនឃើញធនធានដែលបានស្នើសុំទេ។",
  },
  RESOURCE_CONFLICT: {
    en: "The request conflicts with existing data.",
    km: "សំណើនេះមានទំនាស់ជាមួយទិន្នន័យដែលមានស្រាប់។",
  },
  FILE_TYPE_NOT_ALLOWED: {
    en: "Only image files are allowed (jpeg, jpg, png, webp, gif).",
    km: "អនុញ្ញាតតែឯកសាររូបភាព (jpeg, jpg, png, webp, gif) ប៉ុណ្ណោះ។",
  },
  REQUEST_TOO_LARGE: {
    en: "The uploaded file is too large.",
    km: "ឯកសារដែលបានផ្ទុកឡើងមានទំហំធំពេក។",
  },
  RATE_LIMITED: {
    en: "Too many requests. Please try again later.",
    km: "មានសំណើច្រើនពេក។ សូមព្យាយាមម្ដងទៀតនៅពេលក្រោយ។",
  },
  SERVICE_UNAVAILABLE: {
    en: "This service is not configured or is temporarily unavailable.",
    km: "សេវានេះមិនទាន់បានកំណត់រចនាសម្ព័ន្ធ ឬមិនអាចប្រើបានបណ្ដោះអាសន្ន។",
  },
  INTERNAL_SERVER_ERROR: {
    en: "An unexpected server error occurred.",
    km: "មានបញ្ហាមិនរំពឹងទុកនៅម៉ាស៊ីនមេ។",
  },
  REQUEST_FAILED: {
    en: "The request could not be completed.",
    km: "មិនអាចបំពេញសំណើនេះបានទេ។",
  },
};

const aliases = {
  invalid_credentials: "AUTH_INVALID_CREDENTIALS",
  token_expired: "AUTH_SESSION_EXPIRED",
  refresh_invalid: "AUTH_INVALID_TOKEN",
  token_invalid: "AUTH_INVALID_TOKEN",
  device_revoked: "AUTH_DEVICE_REVOKED",
  not_super_admin: "AUTH_FORBIDDEN",
  use_google_signin: "AUTH_INVALID_CREDENTIALS",
  super_admin_use_dedicated_route: "AUTH_FORBIDDEN",
  email_exists_google: "RESOURCE_CONFLICT",
  call_cooldown: "RATE_LIMITED",
  EMAIL_EXISTS: "RESOURCE_CONFLICT",
  DUPLICATE_RESTAURANT: "RESOURCE_CONFLICT",
  DUPLICATE_CATEGORY: "RESOURCE_CONFLICT",
};

// ─── SPECIFIC bilingual texts for controller-level errors ───────────────
// Controllers send precise English strings ("Table number is required").
// normalizeErrorResponses upgrades them to { code, message: { en, km } };
// these tables keep the SPECIFIC wording (instead of falling back to the
// generic per-code text) so Khmer users get the real meaning. Keyed by the
// exact English text; dynamic texts (template literals / concatenation)
// match by prefix in specificPrefixes below.
const specificMessages = {
  "A valid url is required": "តម្រូវឱ្យមាន url ត្រឹមត្រូវ។",
  "Access denied. No token provided.": "ចូលមិនបានទេ។ មិនបានផ្តល់ថូខិន។",
  "Admin not found": "រកមិនឃើញអ្នកគ្រប់គ្រង។",
  "Authentication required": "តម្រូវឱ្យចូលប្រើជាមុន។",
  "Cannot delete your own account": "មិនអាចលុបគណនីខ្លួនឯងបានទេ។",
  "Call not found": "រកមិនឃើញសំណើហៅនេះ។",
  "Call type must be 'bill' or 'extra'": "ប្រភេទនៃការហៅត្រូវតែជា 'bill' ឬ 'extra'។",
  "Cannot modify your own account this way":
    "មិនអាចកែប្រែគណនីខ្លួនឯងតាមវិធីនេះបានទេ។",
  "Category name is required": "តម្រូវឱ្យមានឈ្មោះប្រភេទ។",
  "Could not build the QR code": "មិនអាចបង្កើតកូដ QR បានទេ។",
  "Current password is incorrect": "ពាក្យសម្ងាត់បច្ចុប្បន្នមិនត្រឹមត្រូវ។",
  "Current password is required": "តម្រូវឱ្យបញ្ចូលពាក្យសម្ងាត់បច្ចុប្បន្ន។",
  "Design name is required": "តម្រូវឱ្យមានឈ្មោះរចនាប័ទ្ម។",
  "Design not found": "រកមិនឃើញរចនាប័ទ្មនេះ។",
  "Device not found": "រកមិនឃើញឧបករណ៍។",
  "Email and password required": "តម្រូវឱ្យមានអ៊ីមែលនិងពាក្យសម្ងាត់។",
  "Email already exists": "អ៊ីមែលនេះមានរួចហើយ។",
  "Email already registered": "អ៊ីមែលនេះបានចុះឈ្មោះរួចហើយ។",
  "Email already verified": "អ៊ីមែលបានផ្ទៀងផ្ទាត់រួចហើយ។",
  "Email is required": "តម្រូវឱ្យបញ្ចូលអ៊ីមែល។",
  "Failed to call the owner": "មិនអាចហៅម្ចាស់ហាងបានទេ។",
  "Failed to delete design": "មិនអាចលុបរចនាប័ទ្មបានទេ។",
  "Failed to delete QR code": "មិនអាចលុបកូដ QR បានទេ។",
  "Failed to delete webhook": "មិនអាចលុប webhook បានទេ។",
  "Failed to generate share link": "មិនអាចបង្កើតតំណចែករំលែកបានទេ។",
  "Failed to load designs": "មិនអាចទាញរចនាប័ទ្មដែលបានរក្សាទុកបានទេ។",
  "Failed to load QR code": "មិនអាចទាញកូដ QR បានទេ។",
  "Failed to load saved QR codes":
    "មិនអាចទាញកូដ QR ដែលបានរក្សាទុកបានទេ។",
  "Failed to place order": "មិនអាចដាក់ការកម្មង់បានទេ។",
  "Failed to remove subscription": "មិនអាចលុបការជាវបានទេ។",
  "Failed to save design": "មិនអាចរក្សាទុករចនាប័ទ្មបានទេ។",
  "Failed to save subscription": "មិនអាចរក្សាទុកការជាវបានទេ។",
  "Failed to send test push": "មិនអាចផ្ញើសារសាកល្បងបានទេ។",
  "Failed to set webhook": "មិនអាចកំណត់ webhook បានទេ។",
  "Failed to upload image": "មិនអាចផ្ទុករូបភាពឡើងបានទេ។",
  "Google credential is required": "តម្រូវឱ្យមានព័ត៌មានសម្គាល់ Google។",
  "Google Sign-In is not configured on the server":
    "សេវាចូលជាមួយ Google មិនទាន់បានកំណត់រចនាសម្ព័ន្ធលើម៉ាស៊ីនមេ។",
  "Invalid credentials": "អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។",
  "Invalid currency": "រូបិយបណ្ណមិនត្រឹមត្រូវ។",
  "Invalid exchange rate": "អត្រាប្តូរប្រាក់មិនត្រឹមត្រូវ។",
  "Invalid Google token": "ថូខិន Google មិនត្រឹមត្រូវ។",
  "Invalid language": "ភាសាមិនត្រឹមត្រូវ។",
  "Invalid order tracking value": "តម្លៃតាមដានការកម្មង់មិនត្រឹមត្រូវ។",
  "Invalid restaurant ID": "ID ភោជនីយដ្ឋានមិនត្រឹមត្រូវ។",
  "Invalid role": "តួនាទីមិនត្រឹមត្រូវ។",
  "Invalid sidebar position": "ទីតាំងរបារចំហៀងមិនត្រឹមត្រូវ។",
  "Invalid status": "ស្ថានភាពមិនត្រឹមត្រូវ។",
  "Invalid table number": "លេខតុមិនត្រឹមត្រូវ។",
  "Invalid theme color": "ពណ៌រូបរាងមិនត្រឹមត្រូវ។",
  "Invalid admin ID": "ID អ្នកគ្រប់គ្រងមិនត្រឹមត្រូវ។",
  "Invalid or expired refresh token":
    "ថូខិនផ្ទុកថ្មីមិនត្រឹមត្រូវ ឬបានផុតកំណត់។",
  "Invalid or expired token": "ថូខិនមិនត្រឹមត្រូវ ឬបានផុតកំណត់។",
  "Invalid subscription": "ការជាវមិនត្រឹមត្រូវ។",
  "Menu design is required": "តម្រូវឱ្យមានរចនាប័ទ្មមីនុយ។",
  "Menu design is not valid JSON": "រចនាប័ទ្មមីនុយមិនមែនជា JSON ត្រឹមត្រូវទេ។",
  "Menu design is too large": "រចនាប័ទ្មមីនុយធំពេក។",
  "Menu designs are not set up on this server yet":
    "រចនាប័ទ្មមីនុយមិនទាន់បានដំឡើងនៅលើម៉ាស៊ីនមេនេះទេ។",
  "Menu name is required": "តម្រូវឱ្យមានឈ្មោះមីនុយ។",
  "Menu not found or not owned by you":
    "រកមិនឃើញមីនុយ ឬអ្នកមិនមែនជាម្ចាស់។",
  "Missing endpoint": "បាត់ endpoint។",
  "Missing token": "បាត់ថូខិន។",
  "name, price, category required":
    "តម្រូវឱ្យមាន name, price និង category។",
  "No account found with this email":
    "រកមិនឃើញគណនីដែលប្រើអ៊ីមែលនេះ។",
  "No changes requested": "មិនមានការផ្លាស់ប្តូរទេ។",
  "No fields to update":
    "មិនមានទិន្នន័យសម្រាប់ធ្វើបច្ចុប្បន្នភាពទេ។",
  "No restaurant found for this account":
    "រកមិនឃើញភោជនីយដ្ឋានសម្រាប់គណនីនេះ។",
  "No restaurant found — specify ?restaurant_id":
    "រកមិនឃើញភោជនីយដ្ឋាន — សូមបញ្ជាក់ ?restaurant_id",
  "Not found": "រកមិនឃើញ។",
  "Order items are required": "តម្រូវឱ្យមានមុខម្ហូបក្នុងការកម្មង់។",
  "Order not found": "រកមិនឃើញការកម្មង់។",
  "order_id and token are required": "តម្រូវឱ្យមាន order_id និង token។",
  "Password must be at least 8 characters for super admin":
    "ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោច ៨ តួអក្សរសម្រាប់អ្នកគ្រប់គ្រងខ្ពស់បំផុត។",
  "Please enter a valid email address": "សូមបញ្ចូលអ៊ីមែលត្រឹមត្រូវ។",
  "Please wait a moment before calling again":
    "សូមរង់ចាំបន្តិចសិន មុននឹងហៅម្តងទៀត។",
  "Please verify your email before logging in.":
    "សូមផ្ទៀងផ្ទាត់អ៊ីមែលរបស់អ្នក មុនពេលចូលប្រើ។",
  "Push not configured on the server":
    "សេវាជូនដំណឹង Push មិនទាន់បានកំណត់រចនាសម្ព័ន្ធលើម៉ាស៊ីនមេ។",
  "QR code not found": "រកមិនឃើញកូដ QR។",
  "Refresh token required": "តម្រូវឱ្យមានថូខិនផ្ទុកថ្មី។",
  "Restaurant name is required": "តម្រូវឱ្យមានឈ្មោះភោជនីយដ្ឋាន។",
  "Restaurant not found or not owned by you":
    "រកមិនឃើញភោជនីយដ្ឋាន ឬអ្នកមិនមែនជាម្ចាស់។",
  "Restaurant not found": "រកមិនឃើញភោជនីយដ្ឋាន។",
  "restaurant_id is required": "តម្រូវឱ្យមាន restaurant_id។",
  "Route not found": "រកមិនឃើញផ្លូវ (route)។",
  "Role must be 'owner' or 'super_admin'":
    "តួនាទីត្រូវតែជា 'owner' ឬ 'super_admin'។",
  "Server error": "មានបញ្ហាម៉ាស៊ីនមេ។",
  "Session expired": "សម័យចូលប្រើបានផុតកំណត់។",
  "Table number is required": "តម្រូវឱ្យបញ្ចូលលេខតុ។",
  "TELEGRAM_BOT_TOKEN not configured":
    "TELEGRAM_BOT_TOKEN មិនទាន់បានកំណត់រចនាសម្ព័ន្ធ។",
  "This account is not a super admin.":
    "គណនីនេះមិនមែនជាអ្នកគ្រប់គ្រងខ្ពស់បំផុតទេ។",
  "This device has been signed out by the account owner":
    "ម្ចាស់គណនីបានចាកចេញពីឧបករណ៍នេះរួចហើយ។",
  "This email is already in use": "អ៊ីមែលនេះត្រូវបានប្រើរួចហើយ។",
  "This email already has an account created with Google. Use “Continue with Google” to sign in, or “Forgot password” to set a password.":
    "អ៊ីមែលនេះមានគណនីបង្កើតជាមួយ Google រួចហើយ។ សូមប្រើ “បន្តជាមួយ Google” ដើម្បីចូល ឬ “ភ្លេចពាក្យសម្ងាត់” ដើម្បីកំណត់ពាក្យសម្ងាត់។",
  "This account was created with Google. Use the “Continue with Google” button, or set a password via “Forgot password”.":
    "គណនីនេះបានបង្កើតជាមួយ Google។ សូមប្រើប៊ូតុង “បន្តជាមួយ Google” ឬកំណត់ពាក្យសម្ងាត់តាម “ភ្លេចពាក្យសម្ងាត់”។",
  "Super admin accounts must sign in via the dedicated Super Admin portal (/login/super-admin).":
    "គណនីអ្នកគ្រប់គ្រងខ្ពស់បំផុតត្រូវចូលតាមវេបសាយពិសេស (/login/super-admin)។",
  "Token and password required": "តម្រូវឱ្យមានថូខិននិងពាក្យសម្ងាត់។",
  "URL host is not allowed": "មិនអនុញ្ញាតឱ្យប្រើ host នេះទេ។",
  "User not found": "រកមិនឃើញអ្នកប្រើប្រាស់។",
  "Valid email is required": "តម្រូវឱ្យបញ្ចូលអ៊ីមែលត្រឹមត្រូវ។",
  "Verification token required": "តម្រូវឱ្យមានថូខិនផ្ទៀងផ្ទាត់។",
  "You cannot change your own role":
    "អ្នកមិនអាចផ្លាស់ប្តូរតួនាទីខ្លួនឯងបានទេ។",
  "You cannot delete your own account":
    "អ្នកមិនអាចលុបគណនីខ្លួនឯងបានទេ។",
  "You do not have permission to perform this action":
    "អ្នកមិនមានសិទ្ធិអនុវត្តសកម្មភាពនេះទេ។",
  "You already have a category with this name":
    "អ្នកមានប្រភេទឈ្មោះនេះរួចហើយ។",
  "Your account has been suspended. Contact support.":
    "គណនីរបស់អ្នកត្រូវបានផ្អាក។ សូមទាក់ទងការគាំទ្រ។",
  "Your Google email is not verified":
    "អ៊ីមែល Google របស់អ្នកមិនទាន់បានផ្ទៀងផ្ទាត់។",
};

// Dynamic controller texts (template literals / concatenation) — matched by
// prefix; the English original (with its detail) is kept as-is for `en`.
const specificPrefixes = [
  ["Server error:", "មានបញ្ហាម៉ាស៊ីនមេ៖"],
  ["Password must contain:", "ពាក្យសម្ងាត់ត្រូវមាន៖"],
  [
    "You already have a restaurant named",
    "អ្នកមានភោជនីយដ្ឋានឈ្មោះនេះរួចរាល់។",
  ],
  ["Image upload failed:", "មិនអាចផ្ទុករូបភាពឡើងបានទេ៖"],
  [
    "A valid http(s) url is required in ?data=",
    "តម្រូវឱ្យមាន url http(s) ត្រឹមត្រូវនៅ ?data=",
  ],
];

// Returns { en, km } when the English text is one we have vetted, else null
// (callers then fall back to the generic per-code message).
function localizeSpecific(text) {
  if (typeof text !== "string" || !text) return null;
  if (Object.hasOwn(specificMessages, text))
    return { en: text, km: specificMessages[text] };
  for (const [prefix, km] of specificPrefixes) {
    if (text.startsWith(prefix)) return { en: text, km };
  }
  return null;
}

function resolveLanguage(req) {
  const queryLanguage = String(req.query?.lang || "").toLowerCase();
  if (queryLanguage === "km" || queryLanguage === "en") return queryLanguage;

  const accepted = String(
    req.get?.("Accept-Language") || req.headers?.["accept-language"] || "",
  )
    .split(",")
    .map((entry, index) => {
      const [tag, quality = "q=1"] = entry.trim().split(";");
      const q = Number(quality.trim().replace(/^q=/, ""));
      return { language: tag.split("-")[0].toLowerCase(), q, index };
    })
    .filter(
      (entry) =>
        entry.q > 0 && (entry.language === "km" || entry.language === "en"),
    )
    .sort((a, b) => b.q - a.q || a.index - b.index);

  return accepted[0]?.language || "en";
}

function codeForStatus(status) {
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "AUTH_FORBIDDEN";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 409) return "RESOURCE_CONFLICT";
  if (status === 413) return "REQUEST_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "INTERNAL_SERVER_ERROR";
  return "REQUEST_FAILED";
}

function inferErrorCode(code, message, status) {
  if (typeof code === "string" && Object.hasOwn(aliases, code))
    return aliases[code];
  if (typeof code === "string" && Object.hasOwn(messages, code)) return code;

  const text = String(message || "").toLowerCase();
  if (
    text.includes("device") &&
    (text.includes("signed out") || text.includes("revoked"))
  ) {
    return "AUTH_DEVICE_REVOKED";
  }
  if (text.includes("session expired")) return "AUTH_SESSION_EXPIRED";
  if (text.includes("verify your email")) return "AUTH_EMAIL_UNVERIFIED";
  if (text.includes("token") || text.includes("refresh"))
    return "AUTH_INVALID_TOKEN";
  if (
    text.includes("invalid credentials") ||
    text.includes("password is incorrect")
  ) {
    return "AUTH_INVALID_CREDENTIALS";
  }
  if (
    text.includes("permission") ||
    text.includes("not allowed") ||
    text.includes("cannot delete your own") ||
    text.includes("cannot modify your own")
  ) {
    return "AUTH_FORBIDDEN";
  }
  if (
    text.includes("not found") ||
    text.includes("no account found") ||
    text === "not found"
  ) {
    return "RESOURCE_NOT_FOUND";
  }
  if (
    text.includes("already exists") ||
    text.includes("already registered") ||
    text.includes("already in use") ||
    text.includes("duplicate")
  ) {
    return "RESOURCE_CONFLICT";
  }
  if (
    text.includes("not configured") ||
    text.includes("temporarily unavailable")
  ) {
    return "SERVICE_UNAVAILABLE";
  }
  return codeForStatus(status);
}

// Generic per-code text — upgraded to the SPECIFIC bilingual wording when
// the English text is one we have vetted (specificMessages / prefixes).
// Untranslated texts keep the safe generic message in both languages.
function formatError(code, specificText) {
  const specific = localizeSpecific(specificText);
  if (specific) return { code, message: specific };
  return { code, message: messages[code] || messages.REQUEST_FAILED };
}

module.exports = {
  formatError,
  inferErrorCode,
  resolveLanguage,
  localizeSpecific,
};
