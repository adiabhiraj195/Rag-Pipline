import crypto from "crypto";
import { prisma } from "./config/prisma";
import { getRedisClient } from "./config/redis";
import express from "express";
import documentRouters from "./routers/document-routers";
import { generateToken } from "./services/auth-service";

async function runTest() {
  console.log("=== Testing Document APIs ===");

  const app = express();
  app.use(express.json());
  app.use("/documents", documentRouters);

  // Start temporary server for testing HTTP requests
  const server = app.listen(0);
  const address: any = server.address();
  const baseUrl = `http://localhost:${address.port}`;

  const testEmail = `doc_test_${Date.now()}@example.com`;
  let testUserId: string | null = null;
  const testDocId = crypto.randomUUID();

  try {
    // 1. Create a test user
    const testUser = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: "dummy-hash",
        name: "Test Doc User",
        role: "user",
      },
    });
    testUserId = testUser.id;
    const testToken = generateToken({
      userId: testUser.id,
      email: testUser.email,
      role: testUser.role,
    });

    // 2. Create a test document
    const testDoc = await prisma.document.create({
      data: {
        id: testDocId,
        userId: testUser.id,
        filename: "test-knowledge-base-guide.txt",
        mimeType: "text/plain",
        s3Key: `uploads/${testUser.id}/test-guide.txt`,
        status: "COMPLETED",
        version: 1,
      },
    });
    console.log(`[Test] Created test document ID: ${testDoc.id}`);

    // 3. Test GET /documents (unauthenticated, all documents)
    const listRes = await fetch(`${baseUrl}/documents?all=true&limit=10`);
    const listData = await listRes.json();
    console.log(`[Test] GET /documents status: ${listRes.status}, count: ${listData?.data?.documents?.length}`);
    if (!listData.success || !Array.isArray(listData.data?.documents)) {
      throw new Error("Failed to list documents");
    }

    // 4. Test GET /documents with search filter
    const searchRes = await fetch(`${baseUrl}/documents?search=knowledge-base`);
    const searchData = await searchRes.json();
    console.log(`[Test] GET /documents?search=knowledge-base found: ${searchData?.data?.documents?.length}`);
    const foundInSearch = searchData?.data?.documents?.some((d: any) => d.id === testDocId);
    if (!foundInSearch) {
      throw new Error("Search filter failed to find created document");
    }

    // 5. Test GET /documents with authenticated token
    const authListRes = await fetch(`${baseUrl}/documents`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    const authListData = await authListRes.json();
    console.log(`[Test] Authenticated GET /documents found user's docs: ${authListData?.data?.documents?.length}`);
    const foundInUserDocs = authListData?.data?.documents?.some((d: any) => d.id === testDocId);
    if (!foundInUserDocs) {
      throw new Error("Authenticated user document list did not find created document");
    }

    // 6. Test GET /documents/:id
    const detailRes = await fetch(`${baseUrl}/documents/${testDocId}`);
    const detailData = await detailRes.json();
    console.log(`[Test] GET /documents/:id status: ${detailRes.status}, filename: ${detailData?.data?.document?.filename}`);
    if (!detailData.success || detailData?.data?.document?.id !== testDocId) {
      throw new Error("Failed to get document by ID");
    }

    // 7. Test GET /documents/:id/view-url
    const urlRes = await fetch(`${baseUrl}/documents/${testDocId}/view-url`);
    const urlData = await urlRes.json();
    console.log(`[Test] GET /documents/:id/view-url status: ${urlRes.status}, hasUrl: ${Boolean(urlData?.data?.downloadUrl)}`);
    if (!urlData.success || !urlData?.data?.downloadUrl) {
      throw new Error("Failed to generate presigned download URL");
    }

    // 8. Seed sample vector chunks into Redis to test Vector DB deletion
    const redisClient = await getRedisClient();
    const chunkKey1 = `doc:rag_chunks:${testDocId}:0`;
    const chunkKey2 = `doc:rag_chunks:${testDocId}:1`;
    await redisClient.hSet(chunkKey1, {
      content: "First test chunk content",
      metadata: JSON.stringify({ documentId: testDocId, chunkIndex: 0 }),
    });
    await redisClient.hSet(chunkKey2, {
      content: "Second test chunk content",
      metadata: JSON.stringify({ documentId: testDocId, chunkIndex: 1 }),
    });
    console.log(`[Test] Seeded 2 vector chunk keys into Redis: ${chunkKey1}, ${chunkKey2}`);

    // 9. Test DELETE /documents/:id
    const delRes = await fetch(`${baseUrl}/documents/${testDocId}`, {
      method: "DELETE",
    });
    const delData = await delRes.json();
    console.log(`[Test] DELETE /documents/:id status: ${delRes.status}, msg: ${delData?.message}`);
    console.log(`[Test] Deleted vector chunks count reported: ${delData?.data?.deletedVectorChunks}`);
    if (!delData.success) {
      throw new Error("Failed to delete document");
    }
    if (delData?.data?.deletedVectorChunks !== 2) {
      throw new Error(`Expected 2 deleted vector chunks, got ${delData?.data?.deletedVectorChunks}`);
    }

    // Verify vector chunks are deleted from Redis
    const chunk1Exists = await redisClient.exists(chunkKey1);
    const chunk2Exists = await redisClient.exists(chunkKey2);
    if (chunk1Exists !== 0 || chunk2Exists !== 0) {
      throw new Error("Vector chunks still exist in Redis after document deletion!");
    }
    console.log("[Test] Verified vector chunks were completely removed from Redis Vector Store.");

    // Verify document was deleted from DB
    const checkDeleted = await prisma.document.findUnique({
      where: { id: testDocId },
    });
    if (checkDeleted) {
      throw new Error("Document still exists in DB after deletion");
    }
    console.log("[Test] Verified document was removed from PostgreSQL database.");


    console.log("=== All Document API Tests Passed Successfully! ===");
  } finally {
    // Cleanup test user if exists
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
    const redisClient = await getRedisClient();
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    await prisma.$disconnect();
    server.close();
  }
}

runTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Test Failure]", err);
    process.exit(1);
  });


