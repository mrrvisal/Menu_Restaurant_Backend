// backend/helpers/passwordPolicy.js
// Shared password policy used by account creation and password resets.
//
// Policy (enforced server-side; mirrored in the frontend meter):
//   - at least 8 characters
//   - at least one lowercase letter  (a-z)
//   - at least one uppercase letter  (A-Z)
//   - at least one digit             (0-9)
//   - at least one special character (!@#$%^&* … any non-alphanumeric)
const PASSWORD_MIN_LENGTH = 8;

// Any printable character that is NOT a letter or digit (spaces don't count)
const SPECIAL_RE = /[^A-Za-z0-9\s]/;

const RULES = [
  {
    key: "length",
    label: `at least ${PASSWORD_MIN_LENGTH} characters`,
    test: (pw) => typeof pw === "string" && pw.length >= PASSWORD_MIN_LENGTH,
  },
  {
    key: "lower",
    label: "one lowercase letter (a-z)",
    test: (pw) => typeof pw === "string" && /[a-z]/.test(pw),
  },
  {
    key: "upper",
    label: "one uppercase letter (A-Z)",
    test: (pw) => typeof pw === "string" && /[A-Z]/.test(pw),
  },
  {
    key: "digit",
    label: "one number (0-9)",
    test: (pw) => typeof pw === "string" && /[0-9]/.test(pw),
  },
  {
    key: "special",
    label: "one special character (!@#$%…)",
    test: (pw) => typeof pw === "string" && SPECIAL_RE.test(pw),
  },
];

// Returns { valid, errors } — errors is a human-readable list of unmet rules.
function validatePassword(password) {
  const errors = RULES.filter((rule) => !rule.test(password)).map(
    (rule) => rule.label,
  );
  return { valid: errors.length === 0, errors };
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  RULES,
  validatePassword,
};
