import { describe, expect, test } from "bun:test";
import {
  DOCS_CONTENT_TYPE,
  PUBLIC_STANDARD_ROUTE_DOCS,
  buildAgentDocsResponse,
  buildServiceStatus,
  renderAgentDocsMarkdown,
} from "../lib/http-public-docs";
import { createStandardRoutes } from "../lib/http-x402";
import { SOLANA_DEVNET_NETWORK } from "../lib/http-pricing";

describe("public standard route discovery", () => {
  test("publishes Bazaar metadata for every public x402 route", () => {
    const routes = createStandardRoutes(
      "ExamplePayTo1111111111111111111111111111111",
      SOLANA_DEVNET_NETWORK
    ) as Record<string, any>;

    for (const route of PUBLIC_STANDARD_ROUTE_DOCS) {
      const config = routes[route.routeKey];
      expect(config).toBeDefined();
      expect(config.extensions?.bazaar).toBeDefined();
      expect(config.extensions?.bazaar.info.input.type).toBe("http");
      expect(config.extensions?.bazaar.info.input.queryParams).toEqual(route.input);
      expect(config.extensions?.bazaar.info.output?.example).toEqual(route.exampleOutput);
    }
  });

  test("does not accidentally expose metered routes in the standard catalog", () => {
    const routes = createStandardRoutes(
      "ExamplePayTo1111111111111111111111111111111",
      SOLANA_DEVNET_NETWORK
    ) as Record<string, any>;
    expect(routes["GET /metered/read"]).toBeUndefined();
    expect(routes["POST /metered/credits/topup/5"]).toBeUndefined();
  });
});

describe("agent docs markdown", () => {
  test("renders the exact public paths and x402 guidance", () => {
    const markdown = renderAgentDocsMarkdown(SOLANA_DEVNET_NETWORK);

    expect(markdown).toContain("/x402/read");
    expect(markdown).toContain("/x402/search/20");
    expect(markdown).toContain("/x402/search/100");
    expect(markdown).toContain("/x402/accounts-feed/20");
    expect(markdown).toContain("/x402/accounts-feed/100");
    expect(markdown).toContain("/x402/thread/100");
    expect(markdown).toContain("/x402/trending/solana");
    expect(markdown).toContain("/x402/trending/general");
    expect(markdown).toContain("PAYMENT-REQUIRED");
    expect(markdown).toContain("PAYMENT-SIGNATURE");
    expect(markdown).toContain("Do not call `/x402` or `/metered` directly.");
  });
});

test("docs response and root payload stay separate", async () => {
  const docsResponse = buildAgentDocsResponse(SOLANA_DEVNET_NETWORK);
  expect(docsResponse.status).toBe(200);
  expect(docsResponse.headers.get("content-type")).toBe(DOCS_CONTENT_TYPE);
  const docsBody = await docsResponse.text();
  for (const route of PUBLIC_STANDARD_ROUTE_DOCS) {
    expect(docsBody).toContain(route.path);
  }

  const rootBody = buildServiceStatus(SOLANA_DEVNET_NETWORK);
  expect(rootBody.service).toBe("ct-alpha");
  expect(rootBody.standard_prefix).toBe("/x402");
  expect(rootBody.metered_prefix).toBe("/metered");
  expect("docs" in rootBody).toBe(false);
});
