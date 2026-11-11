import crypto from "node:crypto";

// Team accounts. The built-in "admin" account logs in with APP_PASSWORD; the
// admin adds everyone else from the Team screen. Passwords are stored only as
// salted scrypt hashes.

export const ROLES = ["admin", "manager", "engineer"];
export const ADMIN_USERNAME = "admin";
export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

export function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function publicUser(user) {
  return { username: user.username, displayName: user.displayName, role: user.role };
}

// Checks a new or changed account; returns an error message or null.
export function validateUser({ username, displayName, role, password }, { requirePassword }) {
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    return "Username must be 2 to 32 characters: letters, digits, dots, dashes or underscores.";
  }
  if (username === ADMIN_USERNAME) return "The admin account is built in and can't be changed here.";
  if (typeof displayName !== "string" || !displayName.trim() || displayName.length > 80) return "Enter a name.";
  if (!["manager", "engineer"].includes(role)) return "Role must be manager or engineer.";
  if (requirePassword || password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
  }
  return null;
}
