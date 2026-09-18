import "dotenv/config";
import express from "express";
import http from "http";
import authRouters from "./routers/auth-routers";
import ragRouters from "./routers/rag-routers";
import { prisma } from "./config/prisma";

async function runRagAuthE2ETest() {
  console.log("\n=======================================================");
  console.log("      E2E Test: RAG Endpoints Admin-Only Authorization   ");
  console.log("=======================================================\n");

  const app = express();
  app.use(express.json());
  app.use("/auth", authRouters);
  app.use("/rag", ragRouters);
  app.use("/", ragRouters);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const timestamp = Date.now();
  const orgName = `RAG Auth Corp ${timestamp}`;
  const adminEmail = `admin_${timestamp}@ragauth.com`;
  const customerEmail = `customer_${timestamp}@ragauth.com`;
  const agentEmail = `agent_${timestamp}@ragauth.com`;
  const password = "Password123!";

  let orgId = "";
  let adminToken = "";
  let adminUserId = "";
  let customerToken = "";
  let agentToken = "";
  let createdJobId = "";
  let createdDocId = "";

  try {
    // ------------------------------------------------------------------
    // Step 1: Register Admin (Role: Admin)
    // ------------------------------------------------------------------
    console.log("Step 1: Registering Admin user...");
    const adminRes = await fetch(`${baseUrl}/auth/register/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password,
        name: "Admin Alice",
        organisationName: orgName,
        organisationType: "Technology",
      }),
    });
    const adminData = (await adminRes.json()) as any;
    if (adminRes.status !== 201 || !adminData.data?.token) {
      throw new Error(`Admin registration failed: ${JSON.stringify(adminData)}`);
    }
    adminToken = adminData.data.token;
    adminUserId = adminData.data.user.id;
    orgId = adminData.data.organisation.id;
    console.log(`✓ Admin registered: ID=${adminUserId}, OrgID=${orgId}`);

    // ------------------------------------------------------------------
    // Step 2: Register Customer (Role: Customer)
    // ------------------------------------------------------------------
    console.log("\nStep 2: Registering Customer user...");
    const custRes = await fetch(`${baseUrl}/auth/register/customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: customerEmail,
        password,
        name: "Customer Charlie",
        organisationId: orgId,
      }),
    });
    const custData = (await custRes.json()) as any;
    if (custRes.status !== 201 || !custData.data?.token) {
      throw new Error(`Customer registration failed: ${JSON.stringify(custData)}`);
    }
    customerToken = custData.data.token;
    console.log(`✓ Customer registered: ID=${custData.data.user.id}, Role=${custData.data.user.role}`);

    // ------------------------------------------------------------------
    // Step 3: Register Support Agent (Role: Support Agent)
    // ------------------------------------------------------------------
    console.log("\nStep 3: Registering Support Agent user...");
    const agentRes = await fetch(`${baseUrl}/auth/register/support-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: agentEmail,
        password,
        name: "Support Agent Sam",
        organisationId: orgId,
      }),
    });
    const agentData = (await agentRes.json()) as any;
    if (agentRes.status !== 201 || !agentData.data?.token) {
      throw new Error(`Support Agent registration failed: ${JSON.stringify(agentData)}`);
    }
    agentToken = agentData.data.token;
    console.log(`✓ Support Agent registered: ID=${agentData.data.user.id}, Role=${agentData.data.user.role}`);

    // ------------------------------------------------------------------
    // Step 4: Authorization tests for /upload-url & /presigned-url
    // ------------------------------------------------------------------
    console.log("\nStep 4: Testing Authorization on POST /upload-url & POST /presigned-url...");

    // 4.1 Missing Auth Header -> 401
    const unauthUploadRes = await fetch(`${baseUrl}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "sample.txt" }),
    });
    if (unauthUploadRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated /upload-url, got: ${unauthUploadRes.status}`);
    }
    console.log("✓ Unauthenticated POST /upload-url rejected with 401 Unauthorized.");

    // 4.2 Customer Token -> 403
    const custUploadRes = await fetch(`${baseUrl}/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ filename: "sample.txt" }),
    });
    if (custUploadRes.status !== 403) {
      throw new Error(`Expected 403 for Customer on /upload-url, got: ${custUploadRes.status}`);
    }
    console.log("✓ Customer on POST /upload-url rejected with 403 Forbidden.");

    // 4.3 Support Agent Token -> 403
    const agentUploadRes = await fetch(`${baseUrl}/presigned-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ filename: "sample.txt" }),
    });
    if (agentUploadRes.status !== 403) {
      throw new Error(`Expected 403 for Support Agent on /presigned-url, got: ${agentUploadRes.status}`);
    }
    console.log("✓ Support Agent on POST /presigned-url rejected with 403 Forbidden.");

    // 4.4 Admin Token -> 200 OK
    const adminUploadRes = await fetch(`${baseUrl}/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ filename: "contract.txt", mimeType: "text/plain" }),
    });
    const adminUploadData = (await adminUploadRes.json()) as any;
    if (adminUploadRes.status !== 200 || !adminUploadData.data?.presignedUrl) {
      throw new Error(`Admin presigned URL creation failed: ${JSON.stringify(adminUploadData)}`);
    }
    const uploadedS3Key = adminUploadData.data.s3Key;
    console.log(`✓ Admin successfully requested presigned URL (200 OK): S3 Key=${uploadedS3Key}`);

    // Test alias /rag/presigned-url with Admin token
    const adminPresignedRes = await fetch(`${baseUrl}/rag/presigned-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ filename: "policy.txt" }),
    });
    const adminPresignedData = (await adminPresignedRes.json()) as any;
    if (adminPresignedRes.status !== 200 || !adminPresignedData.data?.presignedUrl) {
      throw new Error(`Admin /rag/presigned-url failed: ${JSON.stringify(adminPresignedData)}`);
    }
    console.log("✓ Admin successfully requested presigned URL via alias /rag/presigned-url (200 OK).");

    // ------------------------------------------------------------------
    // Step 5: Authorization tests for POST /injestTXT
    // ------------------------------------------------------------------
    console.log("\nStep 5: Testing Authorization on POST /injestTXT...");

    // 5.1 Missing Auth Header -> 401
    const unauthInjestRes = await fetch(`${baseUrl}/injestTXT`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3Key: uploadedS3Key, filename: "contract.txt" }),
    });
    if (unauthInjestRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated /injestTXT, got: ${unauthInjestRes.status}`);
    }
    console.log("✓ Unauthenticated POST /injestTXT rejected with 401 Unauthorized.");

    // 5.2 Customer Token -> 403
    const custInjestRes = await fetch(`${baseUrl}/injestTXT`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ s3Key: uploadedS3Key, filename: "contract.txt" }),
    });
    if (custInjestRes.status !== 403) {
      throw new Error(`Expected 403 for Customer on /injestTXT, got: ${custInjestRes.status}`);
    }
    console.log("✓ Customer on POST /injestTXT rejected with 403 Forbidden.");

    // 5.3 Support Agent Token -> 403
    const agentInjestRes = await fetch(`${baseUrl}/rag/injestTXT`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ s3Key: uploadedS3Key, filename: "contract.txt" }),
    });
    if (agentInjestRes.status !== 403) {
      throw new Error(`Expected 403 for Support Agent on /rag/injestTXT, got: ${agentInjestRes.status}`);
    }
    console.log("✓ Support Agent on POST /rag/injestTXT rejected with 403 Forbidden.");

    // 5.4 Admin Token -> 202 Accepted
    const adminInjestRes = await fetch(`${baseUrl}/injestTXT`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        s3Key: uploadedS3Key,
        filename: "contract.txt",
        chunkSize: 500,
        chunkOverlap: 50,
      }),
    });
    const adminInjestData = (await adminInjestRes.json()) as any;
    if (adminInjestRes.status !== 202 || !adminInjestData.data?.jobId) {
      throw new Error(`Admin ingestion trigger failed: ${JSON.stringify(adminInjestData)}`);
    }
    createdJobId = adminInjestData.data.jobId;
    createdDocId = adminInjestData.data.documentId;
    console.log(`✓ Admin successfully triggered ingestion (202 Accepted): JobID=${createdJobId}, DocID=${createdDocId}`);

    // Verify document record in database has admin's userId and organisationId
    const docRecord = await prisma.document.findUnique({
      where: { id: createdDocId },
    });
    if (!docRecord) {
      throw new Error(`Document record with ID ${createdDocId} not found in database.`);
    }
    if (docRecord.userId !== adminUserId) {
      throw new Error(`Expected document.userId to be ${adminUserId}, got: ${docRecord.userId}`);
    }
    if (docRecord.organisationId !== orgId) {
      throw new Error(`Expected document.organisationId to be ${orgId}, got: ${docRecord.organisationId}`);
    }
    console.log(`✓ Document record properly attributed in DB: userId=${docRecord.userId}, organisationId=${docRecord.organisationId}`);

    // ------------------------------------------------------------------
    // Step 6: Authorization tests for GET /job-status/:jobId
    // ------------------------------------------------------------------
    console.log("\nStep 6: Testing Authorization on GET /job-status/:jobId...");

    // 6.1 Missing Auth Header -> 401
    const unauthStatusRes = await fetch(`${baseUrl}/job-status/${createdJobId}`);
    if (unauthStatusRes.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated /job-status, got: ${unauthStatusRes.status}`);
    }
    console.log("✓ Unauthenticated GET /job-status/:jobId rejected with 401 Unauthorized.");

    // 6.2 Customer Token -> 403
    const custStatusRes = await fetch(`${baseUrl}/job-status/${createdJobId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (custStatusRes.status !== 403) {
      throw new Error(`Expected 403 for Customer on /job-status, got: ${custStatusRes.status}`);
    }
    console.log("✓ Customer on GET /job-status/:jobId rejected with 403 Forbidden.");

    // 6.3 Support Agent Token -> 403
    const agentStatusRes = await fetch(`${baseUrl}/rag/job-status/${createdJobId}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    if (agentStatusRes.status !== 403) {
      throw new Error(`Expected 403 for Support Agent on /rag/job-status, got: ${agentStatusRes.status}`);
    }
    console.log("✓ Support Agent on GET /rag/job-status/:jobId rejected with 403 Forbidden.");

    // 6.4 Admin Token -> 200 OK
    const adminStatusRes = await fetch(`${baseUrl}/job-status/${createdJobId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminStatusData = (await adminStatusRes.json()) as any;
    if (adminStatusRes.status !== 200 || !adminStatusData.data?.jobId) {
      throw new Error(`Admin job status check failed: ${JSON.stringify(adminStatusData)}`);
    }
    console.log(`✓ Admin successfully retrieved job status (200 OK): State="${adminStatusData.data.state}"`);

    // ------------------------------------------------------------------
    // Step 7: Verify /chat is accessible without Admin requirement
    // ------------------------------------------------------------------
    console.log("\nStep 7: Verifying /chat endpoint remains accessible...");
    const chatRes = await fetch(`${baseUrl}/rag/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }), // Should return 400 Bad Request due to validation, NOT 401/403
    });
    if (chatRes.status === 401 || chatRes.status === 403) {
      throw new Error(`Expected /rag/chat to NOT require Admin auth, but got ${chatRes.status}`);
    }
    if (chatRes.status === 400) {
      console.log("✓ /rag/chat is accessible without Admin auth (returned 400 Bad Request for empty query as expected).");
    }

    console.log("\n=======================================================");
    console.log("   ALL RAG AUTHORIZATION TESTS PASSED SUCCESSFULLY! 🎉 ");
    console.log("=======================================================\n");
  } finally {
    console.log("Cleaning up test data...");
    if (orgId) {
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
    server.close();
    console.log("Server closed and cleanup completed.");
  }
}

runRagAuthE2ETest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RAG Auth E2E Test Failed:", err);
    process.exit(1);
  });

