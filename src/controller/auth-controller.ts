import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { hashPassword, comparePassword, generateToken } from "../services/auth-service";

/**
 * Handle user registration.
 * POST /auth/register
 * Body: { email: string, password: string, name?: string, role?: string }
 */
export async function registerUser(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name, role } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({
        success: false,
        error: "A valid email address is required.",
      });
      return;
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      res.status(400).json({
        success: false,
        error: "Password is required and must be at least 6 characters long.",
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      res.status(409).json({
        success: false,
        error: "A user with this email address already exists.",
      });
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: name ? String(name).trim() : null,
        role: role ? String(role).trim() : "user",
      },
    });

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully.",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - Register]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error during registration.",
    });
  }
}

/**
 * Handle user login.
 * POST /auth/login
 * Body: { email: string, password: string }
 */
export async function loginUser(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: "Both 'email' and 'password' are required.",
      });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
      return;
    }

    // Check password
    const isPasswordValid = await comparePassword(String(password), user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
      return;
    }

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - Login]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error during login.",
    });
  }
}

/**
 * Get current user profile.
 * GET /auth/me
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: "User not found.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - getMe]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Internal server error fetching profile.",
    });
  }
}

