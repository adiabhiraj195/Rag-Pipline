import "dotenv/config";
import express from "express";
import http from "http";
import authRouters from "./routers/auth-routers";
import conversationRouters from "./routers/conversation-routers";
import { prisma } from "./config/prisma";

async function runE2ETest() {
  console.log("\n=======================================================");
  console.log("       E2E Test: Auth & Persistent Conversation RAG     ");
  console.log("=======================================================\n");

  const app = express();
  app.use(express.json());
  app.use("/auth", authRouters);
  app.use("/conversations", conversationRouters);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testEmail = `test_${Date.now()}@rag-pipline.io`;
  const testPassword = "Password123!";
  const testName = "Test Alice";

  const otherEmail = `other_${Date.now()}@rag-pipline.io`;

  let token1 = "";
  let userId1 = "";
  let token2 = "";
  let userId2 = "";
  let conversationId = "";

  try {
    // ---------------------------------------------------------
    // 1. Test Registration
    // ---------------------------------------------------------
    console.log("Step 1: Testing User Registration...");
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: testName,
      }),
    });
    const regData = (await regRes.json()) as any;
    if (regRes.status !== 201 || !regData.data?.token) {
      throw new Error(`Registration failed: ${JSON.stringify(regData)}`);
    }
    token1 = regData.data.token;
    userId1 = regData.data.user.id;
    console.log(`✓ User registered: ID=${userId1}, Email=${regData.data.user.email}`);

    // Duplicate registration should fail
    const dupRes = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    if (dupRes.status !== 409) {
      throw new Error(`Expected 409 Conflict for duplicate user, got: ${dupRes.status}`);
    }
    console.log("✓ Duplicate user registration correctly rejected (409 Conflict).");

    // ---------------------------------------------------------
    // 2. Test Login
    // ---------------------------------------------------------
    console.log("\nStep 2: Testing User Login...");
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    const loginData = (await loginRes.json()) as any;
    if (loginRes.status !== 200 || !loginData.data?.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    console.log("✓ Login successful and returned valid JWT token.");

    // Invalid login should fail
    const badLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "WrongPassword123!",
      }),
    });
    if (badLoginRes.status !== 401) {
      throw new Error(`Expected 401 for bad password, got: ${badLoginRes.status}`);
    }
    console.log("✓ Bad password rejected (401 Unauthorized).");

    // ---------------------------------------------------------
    // 3. Test Profile (/auth/me)
    // ---------------------------------------------------------
    console.log("\nStep 3: Testing /auth/me profile endpoint...");
    const meRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const meData = (await meRes.json()) as any;
    if (meRes.status !== 200 || meData.data?.user?.email !== testEmail) {
      throw new Error(`Failed to fetch profile: ${JSON.stringify(meData)}`);
    }
    console.log(`✓ /auth/me returned user profile for ${meData.data.user.name}.`);

    // Unauthenticated request to /auth/me should fail
    const unauthRes = await fetch(`${baseUrl}/auth/me`);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for missing token, got: ${unauthRes.status}`);
    }
    console.log("✓ Unauthenticated request rejected (401 Unauthorized).");

    // ---------------------------------------------------------
    // 4. Test Create Conversation
    // ---------------------------------------------------------
    console.log("\nStep 4: Testing Create Conversation...");
    const createConvRes = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({ title: "My Research Chat" }),
    });
    const createConvData = (await createConvRes.json()) as any;
    if (createConvRes.status !== 201 || !createConvData.data?.conversation?.id) {
      throw new Error(`Failed to create conversation: ${JSON.stringify(createConvData)}`);
    }
    conversationId = createConvData.data.conversation.id;
    console.log(`✓ Conversation created: ID=${conversationId}, Title="${createConvData.data.conversation.title}"`);

    // ---------------------------------------------------------
    // 5. Test List Conversations
    // ---------------------------------------------------------
    console.log("\nStep 5: Testing List Conversations...");
    const listConvRes = await fetch(`${baseUrl}/conversations`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const listConvData = (await listConvRes.json()) as any;
    if (listConvRes.status !== 200 || !Array.isArray(listConvData.data?.conversations)) {
      throw new Error(`Failed to list conversations: ${JSON.stringify(listConvData)}`);
    }
    console.log(`✓ Listed ${listConvData.data.conversations.length} conversation(s).`);

    // ---------------------------------------------------------
    // 6. Test Sending Message to Conversation (RAG + LLM)
    // ---------------------------------------------------------
    console.log("\nStep 6: Testing Sending Message to Conversation...");
    const sendMsgRes = await fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        message: "What is this knowledge base about? Give a brief summary.",
        topK: 3,
      }),
    });
    const sendMsgData = (await sendMsgRes.json()) as any;
    if (sendMsgRes.status !== 200) {
      throw new Error(`Failed to send message: ${JSON.stringify(sendMsgData)}`);
    }
    console.log("✓ User message processed and answered by LLM:");
    console.log(`  - Status: ${sendMsgData.data?.userMessage ? "User message saved" : "No user message"}`);
    console.log(`  - Assistant Answer: "${sendMsgData.data?.answer?.slice(0, 100)}..."`);
    console.log(`  - Sources Retrieved: ${sendMsgData.data?.sources?.length || 0}`);

    // ---------------------------------------------------------
    // 7. Test Follow-up Message (Testing history memory)
    // ---------------------------------------------------------
    console.log("\nStep 7: Testing Follow-up Message (Conversational Context)...");
    const followUpRes = await fetch(`${baseUrl}/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        message: "Can you elaborate further on that?",
      }),
    });
    const followUpData = (await followUpRes.json()) as any;
    if (followUpRes.status !== 200) {
      throw new Error(`Failed to send follow-up message: ${JSON.stringify(followUpData)}`);
    }
    console.log("✓ Follow-up message processed successfully:");
    console.log(`  - Rewritten Query: "${followUpData.data?.rewrittenQuery || 'N/A'}"`);
    console.log(`  - Answer: "${followUpData.data?.answer?.slice(0, 100)}..."`);

    // ---------------------------------------------------------
    // 8. Test Get Conversation with Message History
    // ---------------------------------------------------------
    console.log("\nStep 8: Testing Get Conversation with full message history...");
    const getConvRes = await fetch(`${baseUrl}/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    const getConvData = (await getConvRes.json()) as any;
    if (getConvRes.status !== 200 || !getConvData.data?.conversation?.messages) {
      throw new Error(`Failed to get conversation: ${JSON.stringify(getConvData)}`);
    }
    const msgs = getConvData.data.conversation.messages;
    console.log(`✓ Retrieved conversation with ${msgs.length} messages in history:`);
    for (const m of msgs) {
      console.log(`  [${m.role.toUpperCase()}]: ${m.content.slice(0, 60)}...`);
    }

    // ---------------------------------------------------------
    // 9. Test User Isolation (Other user cannot access conversation)
    // ---------------------------------------------------------
    console.log("\nStep 9: Testing User Isolation Security...");
    const reg2Res = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: otherEmail,
        password: testPassword,
        name: "Test Bob",
      }),
    });
    const reg2Data = (await reg2Res.json()) as any;
    token2 = reg2Data.data.token;
    userId2 = reg2Data.data.user.id;

    // Bob tries to access Alice's conversation
    const bobAccessRes = await fetch(`${baseUrl}/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    if (bobAccessRes.status !== 404) {
      throw new Error(`Expected 404 for unauthorized conversation access, got: ${bobAccessRes.status}`);
    }
    console.log("✓ Access cross-tenant/user strictly isolated: User 2 cannot access User 1's conversation (404).");

    // ---------------------------------------------------------
    // 10. Test Delete Conversation
    // ---------------------------------------------------------
    console.log("\nStep 10: Testing Delete Conversation...");
    const delRes = await fetch(`${baseUrl}/conversations/${conversationId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token1}` },
    });
    if (delRes.status !== 200) {
      throw new Error(`Failed to delete conversation: ${delRes.status}`);
    }
    console.log("✓ Conversation successfully deleted.");

    // Verify messages cascaded
    const remainingMsgs = await prisma.message.count({
      where: { conversationId },
    });
    if (remainingMsgs !== 0) {
      throw new Error(`Expected 0 messages after conversation deletion, found: ${remainingMsgs}`);
    }
    console.log("✓ Cascade deletion confirmed: all messages removed.");

    console.log("\n=======================================================");
    console.log("       ALL E2E INTEGRATION TESTS PASSED! 🎉             ");
    console.log("=======================================================\n");
  } finally {
    // Cleanup created test users
    console.log("Cleaning up test users...");
    if (userId1) {
      await prisma.user.deleteMany({ where: { id: userId1 } });
    }
    if (userId2) {
      await prisma.user.deleteMany({ where: { id: userId2 } });
    }
    server.close();
    console.log("Cleanup completed.");
  }
}

runE2ETest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("E2E Test Failed:", err);
    process.exit(1);
  });

