import { Router } from "express";
import {
  createConversation,
  listConversations,
  getConversationById,
  sendMessageToConversation,
  deleteConversation,
} from "../controller/conversation-controller";
import { authenticateToken, requireActiveUser } from "../middleware/auth-middleware";

const conversationRouters = Router();

// Protect all conversation routes with JWT authentication and require verified/active user status
conversationRouters.use(authenticateToken, requireActiveUser);

// Conversation management
conversationRouters.post("/", createConversation);
conversationRouters.get("/", listConversations);
conversationRouters.get("/:id", getConversationById);
conversationRouters.delete("/:id", deleteConversation);

// Messaging within a conversation
conversationRouters.post("/:id/messages", sendMessageToConversation);

export default conversationRouters;

