import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  hashPassword,
  comparePassword,
  generateToken,
  normalizeRole,
  UserRole,
  VALID_ROLES,
} from "../services/auth-service";

/**
 * Handle user registration for Admin, Support Agent, and Customer.
 * POST /auth/register
 * 
 * - Admin: Requires organisation details (organisationName, organisationType?, organisationConfig?). Creates both Organisation and Admin user. Status: ACTIVE.
 * - Support Agent: Requires organisation selection (organisationId or organisationName). Status: PENDING_APPROVAL. Awaiting Admin verification.
 * - Customer: Requires organisation selection (organisationId or organisationName). Status: ACTIVE.
 */
export async function registerUser(req: Request, res: Response): Promise<void> {
  try {
    const {
      email,
      password,
      name,
      role: rawRole,
      organisationId,
      organisationName,
      organisationType,
      organisationConfig,
      organisation,
    } = req.body;

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

    // Role validation
    const normalizedRole: UserRole | null = normalizeRole(rawRole || "Customer");
    if (!normalizedRole) {
      res.status(400).json({
        success: false,
        error: `Invalid role '${rawRole}'. Allowed roles: ${VALID_ROLES.join(", ")}.`,
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

    const passwordHash = await hashPassword(password);
    const cleanedName = name ? String(name).trim() : null;

    // -------------------------------------------------------------
    // 1. ADMIN REGISTRATION
    // -------------------------------------------------------------
    if (normalizedRole === "Admin") {
      const orgName = organisationName || organisation?.name;
      const orgType = organisationType || organisation?.type || null;
      const orgCfg = organisationConfig || organisation?.config || null;

      if (!orgName || typeof orgName !== "string" || orgName.trim() === "") {
        res.status(400).json({
          success: false,
          error: "Organisation name ('organisationName' or 'organisation.name') is required when registering as an Admin.",
        });
        return;
      }

      const trimmedOrgName = orgName.trim();

      // Check if organisation with this name already exists
      const existingOrg = await prisma.organisation.findUnique({
        where: { name: trimmedOrgName },
      });

      if (existingOrg) {
        res.status(409).json({
          success: false,
          error: `An organisation with name '${trimmedOrgName}' already exists. Please use a unique organisation name or contact its administrator.`,
        });
        return;
      }

      // Atomically create Organisation and Admin User
      const newOrg = await prisma.organisation.create({
        data: {
          name: trimmedOrgName,
          type: orgType ? String(orgType).trim() : null,
          config: orgCfg && typeof orgCfg === "object" ? orgCfg : null,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          name: cleanedName,
          role: "Admin",
          status: "ACTIVE",
          isVerified: true,
          organisationId: newOrg.id,
        },
        include: { organisation: true },
      });

      const token = generateToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId,
        status: user.status,
        isVerified: user.isVerified,
      });

      res.status(201).json({
        success: true,
        message: "Admin user and organisation registered successfully.",
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            isVerified: user.isVerified,
            createdAt: user.createdAt,
          },
          organisation: {
            id: newOrg.id,
            name: newOrg.name,
            type: newOrg.type,
            config: newOrg.config,
            createdAt: newOrg.createdAt,
          },
        },
      });
      return;
    }

    // -------------------------------------------------------------
    // 2. SUPPORT AGENT & CUSTOMER REGISTRATION
    // -------------------------------------------------------------
    const targetOrgId = organisationId || organisation?.id;
    const targetOrgName = organisationName || organisation?.name;

    if (!targetOrgId && !targetOrgName) {
      res.status(400).json({
        success: false,
        error: `Please specify the organisation you are joining ('organisationId' or 'organisationName' is required for ${normalizedRole}).`,
      });
      return;
    }

    // Lookup organisation by ID or Name
    let matchedOrg = null;
    if (targetOrgId && typeof targetOrgId === "string") {
      matchedOrg = await prisma.organisation.findUnique({
        where: { id: targetOrgId.trim() },
      });
    }

    if (!matchedOrg && targetOrgName && typeof targetOrgName === "string") {
      matchedOrg = await prisma.organisation.findFirst({
        where: {
          name: {
            equals: targetOrgName.trim(),
            mode: "insensitive",
          },
        },
      });
    }

    if (!matchedOrg) {
      res.status(404).json({
        success: false,
        error: "Specified organisation was not found. Please verify the organisation ID or name.",
      });
      return;
    }

    // Determine status & verification based on role
    const isSupportAgent = normalizedRole === "Support Agent";
    const initialStatus = isSupportAgent ? "PENDING_APPROVAL" : "ACTIVE";
    const isVerified = !isSupportAgent;

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: cleanedName,
        role: normalizedRole,
        status: initialStatus,
        isVerified,
        organisationId: matchedOrg.id,
      },
      include: { organisation: true },
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organisationId: user.organisationId,
      status: user.status,
      isVerified: user.isVerified,
    });

    const message = isSupportAgent
      ? "Support Agent registration submitted. Your account is pending approval by your organisation admin before you can perform any tasks."
      : "Customer registered successfully.";

    res.status(201).json({
      success: true,
      message,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          isVerified: user.isVerified,
          organisationId: user.organisationId,
          createdAt: user.createdAt,
        },
        organisation: {
          id: matchedOrg.id,
          name: matchedOrg.name,
          type: matchedOrg.type,
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
 * Shortcut handler for Admin registration.
 * POST /auth/register/admin
 */
export async function registerAdmin(req: Request, res: Response): Promise<void> {
  req.body.role = "Admin";
  return registerUser(req, res);
}

/**
 * Shortcut handler for Support Agent registration.
 * POST /auth/register/support-agent
 */
export async function registerSupportAgent(req: Request, res: Response): Promise<void> {
  req.body.role = "Support Agent";
  return registerUser(req, res);
}

/**
 * Shortcut handler for Customer registration.
 * POST /auth/register/customer
 */
export async function registerCustomer(req: Request, res: Response): Promise<void> {
  req.body.role = "Customer";
  return registerUser(req, res);
}

/**
 * Public endpoint to list available organisations for registration.
 * GET /auth/organisations
 */
export async function listOrganisations(req: Request, res: Response): Promise<void> {
  try {
    const organisations = await prisma.organisation.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        createdAt: true,
        _count: {
          select: { users: true },
        },
      },
      orderBy: { name: "asc" },
    });

    res.status(200).json({
      success: true,
      data: { organisations },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - listOrganisations]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to retrieve organisations.",
    });
  }
}

/**
 * List support agents for the authenticated Admin's organisation.
 * GET /auth/organisation/support-agents
 * Query: ?status=PENDING_APPROVAL | ACTIVE | REJECTED | all
 */
export async function listSupportAgents(req: Request, res: Response): Promise<void> {
  try {
    const adminOrgId = req.user?.organisationId;
    if (!adminOrgId) {
      res.status(403).json({
        success: false,
        error: "Forbidden: Admin is not associated with an organisation.",
      });
      return;
    }

    const { status } = req.query;
    const statusFilter =
      status && typeof status === "string" && status.toLowerCase() !== "all"
        ? status.toUpperCase()
        : undefined;

    const agents = await prisma.user.findMany({
      where: {
        organisationId: adminOrgId,
        role: "Support Agent",
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isVerified: true,
        organisationId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      success: true,
      data: { agents },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - listSupportAgents]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to retrieve support agents.",
    });
  }
}

/**
 * Approve a pending Support Agent belonging to the authenticated Admin's organisation.
 * POST /auth/organisation/support-agents/:id/approve
 */
export async function approveSupportAgent(req: Request, res: Response): Promise<void> {
  try {
    const adminOrgId = req.user?.organisationId;
    const id = String(req.params.id);

    if (!adminOrgId) {
      res.status(403).json({
        success: false,
        error: "Forbidden: Admin is not associated with an organisation.",
      });
      return;
    }

    const agent = await prisma.user.findUnique({
      where: { id },
    });

    if (!agent) {
      res.status(404).json({
        success: false,
        error: "Support agent not found.",
      });
      return;
    }

    // Verify same organisation
    if (agent.organisationId !== adminOrgId) {
      res.status(403).json({
        success: false,
        error: "Forbidden: You can only manage support agents belonging to your own organisation.",
      });
      return;
    }

    if (agent.role !== "Support Agent") {
      res.status(400).json({
        success: false,
        error: `User is not a Support Agent (current role: ${agent.role}).`,
      });
      return;
    }

    const updatedAgent = await prisma.user.update({
      where: { id },
      data: {
        status: "ACTIVE",
        isVerified: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isVerified: true,
        organisationId: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "Support agent approved successfully. The agent can now perform tasks.",
      data: { agent: updatedAgent },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - approveSupportAgent]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to approve support agent.",
    });
  }
}

/**
 * Reject a pending Support Agent belonging to the authenticated Admin's organisation.
 * POST /auth/organisation/support-agents/:id/reject
 */
export async function rejectSupportAgent(req: Request, res: Response): Promise<void> {
  try {
    const adminOrgId = req.user?.organisationId;
    const id = String(req.params.id);

    if (!adminOrgId) {
      res.status(403).json({
        success: false,
        error: "Forbidden: Admin is not associated with an organisation.",
      });
      return;
    }

    const agent = await prisma.user.findUnique({
      where: { id },
    });

    if (!agent) {
      res.status(404).json({
        success: false,
        error: "Support agent not found.",
      });
      return;
    }

    if (agent.organisationId !== adminOrgId) {
      res.status(403).json({
        success: false,
        error: "Forbidden: You can only manage support agents belonging to your own organisation.",
      });
      return;
    }

    const updatedAgent = await prisma.user.update({
      where: { id },
      data: {
        status: "REJECTED",
        isVerified: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isVerified: true,
        organisationId: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      success: true,
      message: "Support agent rejected.",
      data: { agent: updatedAgent },
    });
  } catch (error: any) {
    console.error("[Auth Controller Error - rejectSupportAgent]", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Failed to reject support agent.",
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
      include: { organisation: true },
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

    if (user.status === "REJECTED") {
      res.status(403).json({
        success: false,
        error: "Account rejected. Your account registration was rejected by your organisation admin.",
      });
      return;
    }

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organisationId: user.organisationId,
      status: user.status,
      isVerified: user.isVerified,
    });

    const isPending = user.status === "PENDING_APPROVAL";
    const message = isPending
      ? "Login successful. Notice: Your account is pending approval by your organisation admin and cannot perform tasks until approved."
      : "Login successful.";

    res.status(200).json({
      success: true,
      message,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          isVerified: user.isVerified,
          createdAt: user.createdAt,
        },
        organisation: user.organisation
          ? {
              id: user.organisation.id,
              name: user.organisation.name,
              type: user.organisation.type,
            }
          : null,
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
        status: true,
        isVerified: true,
        organisationId: true,
        createdAt: true,
        updatedAt: true,
        organisation: {
          select: {
            id: true,
            name: true,
            type: true,
            config: true,
            createdAt: true,
          },
        },
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


