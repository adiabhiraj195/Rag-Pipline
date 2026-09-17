import { Router } from "express";
import { registerUser, loginUser, getMe } from "../controller/auth-controller";
import { authenticateToken } from "../middleware/auth-middleware";

const authRouters = Router();

// Public routes
authRouters.post("/register", registerUser);
authRouters.post("/login", loginUser);

// Protected routes
authRouters.get("/me", authenticateToken, getMe);

export default authRouters;

