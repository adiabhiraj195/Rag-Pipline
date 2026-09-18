import type { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload, UserRole, UserStatus } from "../services/auth-service";
import { prisma } from "../config/prisma";

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole | string;
  organisationId?: string | null;
  status?: UserStatus | string;
  isVerified?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Express middleware to authenticate requests using JWT Bearer tokens.
 */
export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: "Authentication required. Missing 'Authorization' header.",
    });
    return;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({
      success: false,
      error: "Malformed authorization header. Format must be 'Bearer <token>'.",
    });
    return;
  }

  const token = parts[1];

  try {
    const payload: TokenPayload = verifyToken(token);
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      organisationId: payload.organisationId ?? null,
      status: payload.status ?? "ACTIVE",
      isVerified: payload.isVerified ?? true,
    };
    next();
  } catch (error: any) {
    console.error("[Auth Middleware] JWT verification failed:", error?.message);
    res.status(401).json({
      success: false,
      error: "Invalid or expired access token.",
    });
    return;
  }
}

/**
 * Express middleware to ensure the authenticated user is active and approved.
 * Support agents pending approval are forbidden from performing any task.
 */
export async function requireActiveUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: "Unauthorized: Authentication required.",
    });
    return;
  }

  // If token shows pending approval, query DB to see if admin recently approved
  if (req.user.status === "PENDING_APPROVAL") {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { status: true, isVerified: true, role: true, organisationId: true },
      });
      if (dbUser) {
        req.user.status = dbUser.status;
        req.user.isVerified = dbUser.isVerified;
        req.user.role = dbUser.role;
        req.user.organisationId = dbUser.organisationId;
      }
    } catch (err) {
      console.warn("[Auth Middleware] Could not refresh user status from DB:", err);
    }
  }

  if (req.user.status === "PENDING_APPROVAL") {
    res.status(403).json({
      success: false,
      error: "Account pending approval. Your account must be approved by your organisation admin before you can perform any tasks.",
    });
    return;
  }

  if (req.user.status === "REJECTED") {
    res.status(403).json({
      success: false,
      error: "Account rejected. Your account registration was rejected by your organisation admin.",
    });
    return;
  }

  next();
}

/**
 * Express middleware to enforce role-based access control.
 * Matches allowed roles case-insensitively.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Unauthorized: Authentication required.",
      });
      return;
    }

    const userRole = (req.user.role || "").toLowerCase();
    const hasRole = allowedRoles.some((r) => r.toLowerCase() === userRole);

    if (!hasRole) {
      res.status(403).json({
        success: false,
        error: `Forbidden. This operation requires one of the following roles: ${allowedRoles.join(", ")}.`,
      });
      return;
    }

    next();
  };
}

/**
 * Convenience middleware for admin-only operations (requires active Admin).
 */
export const requireAdmin = [authenticateToken, requireActiveUser, requireRole("Admin")];


