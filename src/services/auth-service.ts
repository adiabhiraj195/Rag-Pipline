import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "rag-secret-jwt-key-2026-production-ready";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export type UserRole = "Admin" | "Customer" | "Support Agent";
export type UserStatus = "ACTIVE" | "PENDING_APPROVAL" | "REJECTED";

export const VALID_ROLES: readonly UserRole[] = ["Admin", "Customer", "Support Agent"] as const;

export function normalizeRole(roleInput?: string | null): UserRole | null {
  if (!roleInput || typeof roleInput !== "string") return null;
  const trimmed = roleInput.trim();
  const found = VALID_ROLES.find((r) => r.toLowerCase() === trimmed.toLowerCase());
  return found || null;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole | string;
  organisationId?: string | null;
  status: UserStatus | string;
  isVerified?: boolean;
}

/**
 * Hash a plain text password using bcryptjs.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Compare a plain text password with a bcrypt hash.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a signed JWT token for a user.
 */
export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * Verify and decode a JWT token.
 */
export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
