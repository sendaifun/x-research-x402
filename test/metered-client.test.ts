import { describe, expect, test } from "bun:test";
import { buildQueryPath } from "../lib/metered-client";

describe("buildQueryPath", () => {
  test("appends scalar params and skips empty values", () => {
    expect(
      buildQueryPath("metered/search", {
        q: "solana",
        limit: 20,
        fresh: true,
        since: undefined,
        ignored: "",
      })
    ).toBe("metered/search?q=solana&limit=20&fresh=true");
  });

  test("joins array params and preserves existing query strings", () => {
    expect(
      buildQueryPath("metered/trending?window=6h", {
        accounts: ["solana", "bonk"],
        top: 5,
      })
    ).toBe("metered/trending?window=6h&accounts=solana%2Cbonk&top=5");
  });
});
