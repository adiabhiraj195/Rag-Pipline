import "dotenv/config";
import express from "express";
import http from "http";
import authRouters from "./routers/auth-routers";
import conversationRouters from "./routers/conversation-routers";
import { prisma } from "./config/prisma";

async function runOrganisationAuthE2ETest() {
  console.log("\n=======================================================");
  console.log("   E2E Test: Organisation & Role-Based Auth System      ");
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

  const timestamp = Date.now();
  const orgName1 = `Acme Technologies ${timestamp}`;
  const orgName2 = `Beta Global ${timestamp}`;

  const adminEmail1 = `admin1_${timestamp}@acme.com`;
  const agentEmail1 = `agent1_${timestamp}@acme.com`;
  const agentEmail2 = `agent2_${timestamp}@acme.com`;
  const customerEmail1 = `cust1_${timestamp}@client.com`;
  const adminEmail2 = `admin2_${timestamp}@beta.com`;

  const testPassword = "Password123!";

  let orgId1 = "";
  let orgId2 = "";
  let adminToken1 = "";
  let adminToken2 = "";
  let agentToken1 = "";
  let agentToken2 = "";
  let agentId1 = "";
  let agentId2 = "";
  let customerToken1 = "";

  try {
    // ---------------------------------------------------------
    // 1. Admin Registration (Creates Organisation & Admin User)
    // ---------------------------------------------------------
    console.log("Step 1: Testing Admin Registration with Organisation configuration...");
    const adminRegRes = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail1,
        password: testPassword,
        name: "Acme Admin Alice",
        role: "Admin",
        organisationName: orgName1,
        organisationType: "Technology",
        organisationConfig: { domain: "acme.com", plan: "Enterprise" },
      }),
    });
    const adminRegData = (await adminRegRes.json()) as any;
    if (adminRegRes.status !== 201 || !adminRegData.data?.token) {
      throw new Error(`Admin registration failed: ${JSON.stringify(adminRegData)}`);
    }

    adminToken1 = adminRegData.data.token;
    orgId1 = adminRegData.data.organisation.id;
    const adminUser = adminRegData.data.user;

    if (adminUser.role !== "Admin" || adminUser.status !== "ACTIVE" || !adminUser.isVerified) {
      throw new Error(`Admin user should be ACTIVE and verified. Got: ${JSON.stringify(adminUser)}`);
    }
    console.log(`✓ Admin registered: ID=${adminUser.id}, OrgID=${orgId1}, OrgName="${adminRegData.data.organisation.name}"`);

    // ---------------------------------------------------------
    // 2. Organisation Public Listing
    // ---------------------------------------------------------
    console.log("\nStep 2: Testing Public Organisation Listing...");
    const orgsRes = await fetch(`${baseUrl}/auth/organisations`);
    const orgsData = (await orgsRes.json()) as any;
    if (orgsRes.status !== 200 || !Array.isArray(orgsData.data?.organisations)) {
      throw new Error(`Failed to list organisations: ${JSON.stringify(orgsData)}`);
    }
    const foundOrg = orgsData.data.organisations.find((o: any) => o.id === orgId1);
    if (!foundOrg) {
      throw new Error(`Created organisation ${orgId1} not found in public list.`);
    }
    console.log(`✓ Organisation discovered in public list: ${foundOrg.name} (${foundOrg.type})`);

    // ---------------------------------------------------------
    // 3. Support Agent Registration (Pending Approval)
    // ---------------------------------------------------------
    console.log("\nStep 3: Testing Support Agent Registration (should be PENDING_APPROVAL)...");
    const agentRegRes = await fetch(`${baseUrl}/auth/register/support-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: agentEmail1,
        password: testPassword,
        name: "Support Agent Sam",
        organisationId: orgId1,
      }),
    });
    const agentRegData = (await agentRegRes.json()) as any;
    if (agentRegRes.status !== 201) {
      throw new Error(`Support Agent registration failed: ${JSON.stringify(agentRegData)}`);
    }
    agentToken1 = agentRegData.data?.token;
    agentId1 = agentRegData.data?.user?.id;
    const agentUser = agentRegData.data?.user;

    if (agentUser.role !== "Support Agent" || agentUser.status !== "PENDING_APPROVAL" || agentUser.isVerified !== false) {
      throw new Error(`Support Agent must be PENDING_APPROVAL and isVerified=false. Got: ${JSON.stringify(agentUser)}`);
    }
    console.log(`✓ Support Agent registered: ID=${agentId1}, Status=${agentUser.status}, isVerified=${agentUser.isVerified}`);

    // ---------------------------------------------------------
    // 4. Support Agent Task Prohibition (Must be rejected with 403)
    // ---------------------------------------------------------
    console.log("\nStep 4: Testing Support Agent Task Prohibition before approval...");
    const agentTaskRes = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken1}`,
      },
      body: JSON.stringify({ title: "Unauthorized Attempt" }),
    });
    const agentTaskData = (await agentTaskRes.json()) as any;
    if (agentTaskRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for pending Support Agent task, got: ${agentTaskRes.status}`);
    }
    console.log(`✓ Unapproved Support Agent correctly blocked from creating conversations (403 Forbidden): "${agentTaskData.error}"`);

    // ---------------------------------------------------------
    // 5. Customer Registration (Active Immediately)
    // ---------------------------------------------------------
    console.log("\nStep 5: Testing Customer Registration (should be ACTIVE immediately)...");
    const custRegRes = await fetch(`${baseUrl}/auth/register/customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: customerEmail1,
        password: testPassword,
        name: "Customer Cathy",
        organisationName: orgName1, // Lookup by name test
      }),
    });
    const custRegData = (await custRegRes.json()) as any;
    if (custRegRes.status !== 201 || !custRegData.data?.token) {
      throw new Error(`Customer registration failed: ${JSON.stringify(custRegData)}`);
    }
    customerToken1 = custRegData.data.token;
    const custUser = custRegData.data.user;

    if (custUser.role !== "Customer" || custUser.status !== "ACTIVE" || !custUser.isVerified) {
      throw new Error(`Customer must be ACTIVE and isVerified=true. Got: ${JSON.stringify(custUser)}`);
    }
    console.log(`✓ Customer registered and ACTIVE: ID=${custUser.id}, Org=${custRegData.data.organisation.name}`);

    // Customer can create conversation
    const custConvRes = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken1}`,
      },
      body: JSON.stringify({ title: "Customer Support Chat" }),
    });
    const custConvData = (await custConvRes.json()) as any;
    if (custConvRes.status !== 201) {
      throw new Error(`Customer failed to create conversation: ${JSON.stringify(custConvData)}`);
    }
    console.log(`✓ Customer successfully created conversation: ID=${custConvData.data?.conversation?.id}`);

    // ---------------------------------------------------------
    // 6. Admin Lists Pending Support Agents
    // ---------------------------------------------------------
    console.log("\nStep 6: Testing Admin Listing Pending Support Agents...");
    const listAgentsRes = await fetch(`${baseUrl}/auth/organisation/support-agents?status=PENDING_APPROVAL`, {
      headers: { Authorization: `Bearer ${adminToken1}` },
    });
    const listAgentsData = (await listAgentsRes.json()) as any;
    if (listAgentsRes.status !== 200 || !Array.isArray(listAgentsData.data?.agents)) {
      throw new Error(`Failed to list support agents: ${JSON.stringify(listAgentsData)}`);
    }
    const foundPendingAgent = listAgentsData.data.agents.find((a: any) => a.id === agentId1);
    if (!foundPendingAgent) {
      throw new Error(`Pending agent ${agentId1} not found in admin agent list.`);
    }
    console.log(`✓ Admin successfully listed pending agent: ${foundPendingAgent.email} (${foundPendingAgent.status})`);

    // ---------------------------------------------------------
    // 7. Cross-Organisation Admin Authorization Isolation
    // ---------------------------------------------------------
    console.log("\nStep 7: Testing Cross-Organisation Admin Security Isolation...");
    // Register second admin for a different organisation
    const admin2Res = await fetch(`${baseUrl}/auth/register/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail2,
        password: testPassword,
        name: "Beta Admin Bob",
        organisationName: orgName2,
        organisationType: "Finance",
      }),
    });
    const admin2Data = (await admin2Res.json()) as any;
    adminToken2 = admin2Data.data.token;
    orgId2 = admin2Data.data.organisation.id;

    // Admin 2 attempts to approve Acme's agent 1
    const crossApproveRes = await fetch(`${baseUrl}/auth/organisation/support-agents/${agentId1}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken2}` },
    });
    if (crossApproveRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for cross-organisation approval attempt, got: ${crossApproveRes.status}`);
    }
    console.log("✓ Cross-organisation approval strictly blocked (403 Forbidden).");

    // ---------------------------------------------------------
    // 8. Admin Approves Support Agent
    // ---------------------------------------------------------
    console.log("\nStep 8: Testing Admin Approving Support Agent...");
    const approveRes = await fetch(`${baseUrl}/auth/organisation/support-agents/${agentId1}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken1}` },
    });
    const approveData = (await approveRes.json()) as any;
    if (approveRes.status !== 200 || approveData.data?.agent?.status !== "ACTIVE") {
      throw new Error(`Approval failed: ${JSON.stringify(approveData)}`);
    }
    console.log("✓ Support agent approved successfully by organisation admin.");

    // ---------------------------------------------------------
    // 9. Approved Support Agent Can Now Perform Tasks
    // ---------------------------------------------------------
    console.log("\nStep 9: Testing Support Agent Task Execution After Approval...");
    const agentPostApprovalRes = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken1}`,
      },
      body: JSON.stringify({ title: "Support Ticket #101" }),
    });
    const agentPostApprovalData = (await agentPostApprovalRes.json()) as any;
    if (agentPostApprovalRes.status !== 201) {
      throw new Error(`Approved agent failed to create conversation: ${JSON.stringify(agentPostApprovalData)}`);
    }
    console.log(`✓ Approved Support Agent can now perform tasks: Created conversation ID=${agentPostApprovalData.data?.conversation?.id}`);

    // ---------------------------------------------------------
    // 10. Support Agent Rejection Flow
    // ---------------------------------------------------------
    console.log("\nStep 10: Testing Support Agent Rejection Flow...");
    const agent2RegRes = await fetch(`${baseUrl}/auth/register/support-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: agentEmail2,
        password: testPassword,
        name: "Support Agent Dave",
        organisationId: orgId1,
      }),
    });
    const agent2RegData = (await agent2RegRes.json()) as any;
    agentId2 = agent2RegData.data.user.id;
    agentToken2 = agent2RegData.data.token;

    // Admin rejects agent 2
    const rejectRes = await fetch(`${baseUrl}/auth/organisation/support-agents/${agentId2}/reject`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken1}` },
    });
    const rejectData = (await rejectRes.json()) as any;
    if (rejectRes.status !== 200 || rejectData.data?.agent?.status !== "REJECTED") {
      throw new Error(`Rejection failed: ${JSON.stringify(rejectData)}`);
    }
    console.log("✓ Support agent rejected successfully.");

    // Rejected agent tries task -> 403
    const rejectedTaskRes = await fetch(`${baseUrl}/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken2}`,
      },
      body: JSON.stringify({ title: "Rejected Agent Task" }),
    });
    if (rejectedTaskRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for rejected agent task, got: ${rejectedTaskRes.status}`);
    }
    console.log("✓ Rejected Support Agent task blocked (403 Forbidden).");

    console.log("\n=======================================================");
    console.log("  ALL ORGANISATION AUTH & WORKFLOW TESTS PASSED! 🎉    ");
    console.log("=======================================================\n");
  } finally {
    console.log("Cleaning up test organisations and users...");
    if (orgId1) {
      await prisma.organisation.deleteMany({ where: { id: orgId1 } });
    }
    if (orgId2) {
      await prisma.organisation.deleteMany({ where: { id: orgId2 } });
    }
    server.close();
    console.log("Cleanup complete.");
  }
}

runOrganisationAuthE2ETest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Organisation Auth E2E Test Failed:", err);
    process.exit(1);
  });

