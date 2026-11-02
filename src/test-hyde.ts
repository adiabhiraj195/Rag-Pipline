import {
  QueryRewriteSchema,
  rewriteQuery,
} from "./services/query-rewriting";

async function runHydeTests() {
  console.log("=== Testing HyDE & Query Rewrite Implementation ===");

  // Test 1: QueryRewriteSchema validation
  console.log("\n1. Testing QueryRewriteSchema validation...");
  const validHyde = QueryRewriteSchema.parse({
    status: "hyde",
    query: "Our refund policy allows full refunds within 30 days of purchase for all unused services.",
    response: null,
    hypotheticalDocument: "Our refund policy allows full refunds within 30 days of purchase for all unused services.",
    standaloneQuery: "What is the refund policy?",
  });
  console.log("✓ Valid HyDE result schema passed:", validHyde.status);

  const validClear = QueryRewriteSchema.parse({
    status: "clear",
    query: "What is the pricing?",
    response: null,
    hypotheticalDocument: null,
  });
  console.log("✓ Valid Clear result schema passed:", validClear.status);

  const validClarify = QueryRewriteSchema.parse({
    status: "clarify",
    query: null,
    response: "Could you please clarify?",
    hypotheticalDocument: null,
  });
  console.log("✓ Valid Clarify result schema passed:", validClarify.status);

  // Test 2: Empty query fast-path with HyDE: false vs true
  console.log("\n2. Testing Fast-Path Validation with HyDE flag...");
  const emptyWithoutHyde = await rewriteQuery("   ", [], false);
  if (emptyWithoutHyde.status !== "clarify" || emptyWithoutHyde.query !== null) {
    throw new Error("Expected empty query without HyDE to return clarify with null query");
  }
  console.log("✓ Fast-path without HyDE returned clarify correctly.");

  const emptyWithHyde = await rewriteQuery("   ", [], { HyDE: true });
  if (emptyWithHyde.status !== "clarify" || emptyWithHyde.query !== null) {
    throw new Error("Expected empty query with HyDE to return clarify with null query");
  }
  console.log("✓ Fast-path with HyDE: true returned clarify correctly.");

  const emptyWithHydeLower = await rewriteQuery("   ", [], { hyde: true });
  if (emptyWithHydeLower.status !== "clarify" || emptyWithHydeLower.query !== null) {
    throw new Error("Expected empty query with hyde: true to return clarify with null query");
  }
  console.log("✓ Fast-path with hyde: true returned clarify correctly.");

  // Test 3: Chat Controller payload parsing
  console.log("\n3. Testing Chat Controller payload handling...");
  const { handleChatQuery } = await import("./controller/chat-controller");

  function createMockReqRes(body: Record<string, any>) {
    let statusCode = 200;
    let responseData: any = null;

    const req: any = { body };
    const res: any = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(data: any) {
        responseData = data;
        return res;
      },
    };

    return {
      req,
      res,
      getStatus: () => statusCode,
      getData: () => responseData,
    };
  }

  // 3A: Empty query with HyDE: true should return 400
  {
    const mock = createMockReqRes({ query: "", HyDE: true });
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() !== 400 || mock.getData()?.success !== false) {
      throw new Error(`Expected status 400 for empty query, got ${mock.getStatus()}`);
    }
    console.log("✓ Chat controller rejected empty query with HyDE: true with 400.");
  }

  // 3B: Non-string query with HyDE: true should return 400
  {
    const mock = createMockReqRes({ query: 12345, HyDE: true });
    await handleChatQuery(mock.req, mock.res);
    if (mock.getStatus() !== 400 || mock.getData()?.success !== false) {
      throw new Error(`Expected status 400 for invalid query type, got ${mock.getStatus()}`);
    }
    console.log("✓ Chat controller rejected non-string query with 400.");
  }

  console.log("\n=== All HyDE Unit Tests Passed Successfully! ===");
}

runHydeTests().catch((err) => {
  console.error("HyDE tests failed:", err);
  process.exit(1);
});
