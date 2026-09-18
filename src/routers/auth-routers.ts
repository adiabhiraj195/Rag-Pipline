import { Router } from "express";
import {
  registerUser,
  registerAdmin,
  registerSupportAgent,
  registerCustomer,
  listOrganisations,
  listSupportAgents,
  approveSupportAgent,
  rejectSupportAgent,
  loginUser,
  getMe,
} from "../controller/auth-controller";
import { authenticateToken, requireAdmin } from "../middleware/auth-middleware";

const authRouters = Router();

// Public routes
authRouters.post("/register", registerUser);
authRouters.post("/register/admin", registerAdmin);
authRouters.post("/register/support-agent", registerSupportAgent);
authRouters.post("/register/customer", registerCustomer);
authRouters.get("/organisations", listOrganisations);
authRouters.post("/login", loginUser);

// Protected routes (Any authenticated user)
authRouters.get("/me", authenticateToken, getMe);

// Admin-only Organisation Support Agent verification routes
authRouters.get("/organisation/support-agents", requireAdmin, listSupportAgents);
authRouters.post("/organisation/support-agents/:id/approve", requireAdmin, approveSupportAgent);
authRouters.post("/organisation/support-agents/:id/reject", requireAdmin, rejectSupportAgent);

export default authRouters;


