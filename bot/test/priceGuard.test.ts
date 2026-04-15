import { describe, it, expect } from "vitest";
import { validateSpotPrice, type ReferencePrice } from "../src/priceGuard.js";
import type { Address } from "viem";

const TOKEN_A = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const TOKEN_B = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

function makeRef(token: Address, priceUsd: number): ReferencePrice {
  return {
    token,
    priceUsd,
    source: "test",
    timestamp: Date.now(),
  };
}

describe("validateSpotPrice", () => {
  it("should approve price within deviation threshold", () => {
    const refA = makeRef(TOKEN_A, 3200); // WETH = $3200
    const refB = makeRef(TOKEN_B, 1); // USDC = $1
    // Reference ratio: 3200/1 = 3200
    // Spot: 3200 → 0% deviation → valid
    const result = validateSpotPrice(3200, refA, refB);
    expect(result.valid).toBe(true);
    expect(result.deviationPercent).toBeCloseTo(0, 1);
  });

  it("should reject price with high deviation", () => {
    const refA = makeRef(TOKEN_A, 3200);
    const refB = makeRef(TOKEN_B, 1);
    // Spot: 3500 → ~9.4% deviation → invalid
    const result = validateSpotPrice(3500, refA, refB);
    expect(result.valid).toBe(false);
    expect(result.deviationPercent).toBeGreaterThan(2);
  });

  it("should pass validation when no reference prices exist", () => {
    const result = validateSpotPrice(3200, undefined, undefined);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("Referans fiyat yok");
  });

  it("should reject when reference price is zero", () => {
    const refA = makeRef(TOKEN_A, 0);
    const refB = makeRef(TOKEN_B, 1);
    const result = validateSpotPrice(3200, refA, refB);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("sıfır");
  });

  it("should accept small deviations", () => {
    const refA = makeRef(TOKEN_A, 3200);
    const refB = makeRef(TOKEN_B, 1);
    // 1% deviation → should pass (default limit is 2%)
    const result = validateSpotPrice(3232, refA, refB);
    expect(result.valid).toBe(true);
    expect(result.deviationPercent).toBeCloseTo(1, 0);
  });
});
