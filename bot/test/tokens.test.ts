import { describe, it, expect } from "vitest";
import { getDecimals } from "../src/tokens.js";
import type { Address } from "viem";

describe("getDecimals", () => {
  it("should return 18 for WETH", () => {
    expect(getDecimals("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address)).toBe(18);
  });

  it("should return 6 for USDC", () => {
    expect(getDecimals("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address)).toBe(6);
  });

  it("should return 6 for USDT", () => {
    expect(getDecimals("0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address)).toBe(6);
  });

  it("should return 8 for WBTC", () => {
    expect(getDecimals("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" as Address)).toBe(8);
  });

  it("should return 18 for DAI", () => {
    expect(getDecimals("0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address)).toBe(18);
  });

  it("should return 18 for unknown token (fallback)", () => {
    expect(getDecimals("0x0000000000000000000000000000000000000001" as Address)).toBe(18);
  });

  it("should be case-insensitive", () => {
    const lower = getDecimals("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" as Address);
    const upper = getDecimals("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address);
    expect(lower).toBe(upper);
  });
});
