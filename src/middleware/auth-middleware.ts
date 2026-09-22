import type { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload } from "../services/auth-service";

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
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
 * Express middleware to optionally authenticate requests.
 * If a valid JWT Bearer token is present, req.user will be populated.
 * If no token or an invalid token is provided, the request proceeds anonymously.
 */
export function optionalAuthenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    next();
    return;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    next();
    return;
  }

  const token = parts[1];
  try {
    const payload: TokenPayload = verifyToken(token);
    req.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next();
}

