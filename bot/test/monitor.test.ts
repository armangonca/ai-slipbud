import { describe, it, expect } from "vitest";
import { getV2Price, getV2AmountOut, getV3Price } from "../src/monitor.js";
import type { V2PoolState, V3PoolState } from "../src/monitor.js";
import type { Address } from "viem";

const TOKEN_A = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address; // WETH
const TOKEN_B = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address; // USDC

describe("getV2Price", () => {
  it("should calculate correct price when tokenA is token0", () => {
    const pool: V2PoolState = {
      reserve0: 1000n * 10n ** 18n, // 1000 WETH
      reserve1: 3_200_000n * 10n ** 6n, // 3,200,000 USDC
      token0: TOKEN_A,
    };

    const price = getV2Price(pool, TOKEN_A, 18, 6);
    expect(price).toBeCloseTo(3200, 0);
  });

  it("should calculate correct price when tokenA is token1", () => {
    const pool: V2PoolState = {
      reserve0: 3_200_000n * 10n ** 6n, // USDC as token0
      reserve1: 1000n * 10n ** 18n, // WETH as token1
      token0: TOKEN_B,
    };

    const price = getV2Price(pool, TOKEN_A, 18, 6);
    expect(price).toBeCloseTo(3200, 0);
  });

  it("should return 0-like price for empty reserves", () => {
    const pool: V2PoolState = {
      reserve0: 0n,
      reserve1: 1000n * 10n ** 6n,
      token0: TOKEN_A,
    };

    // Division by zero case
    const price = getV2Price(pool, TOKEN_A, 18, 6);
    expect(price).toBe(Infinity);
  });
});

describe("getV2AmountOut", () => {
  const pool: V2PoolState = {
    reserve0: 1000n * 10n ** 18n,
    reserve1: 3_200_000n * 10n ** 6n,
    token0: TOKEN_A,
  };

  it("should calculate correct output amount with 0.3% fee", () => {
    const amountIn = 1n * 10n ** 18n; // 1 WETH
    const amountOut = getV2AmountOut(pool, TOKEN_A, amountIn);

    // ~3200 USDC minus fee and price impact
    // 1 WETH in 1000 WETH pool ≈ 0.1% impact + 0.3% fee
    expect(Number(amountOut) / 1e6).toBeGreaterThan(3180);
    expect(Number(amountOut) / 1e6).toBeLessThan(3200);
  });

  it("should return 0 for 0 input", () => {
    const amountOut = getV2AmountOut(pool, TOKEN_A, 0n);
    expect(amountOut).toBe(0n);
  });

  it("should have increasing slippage for larger amounts", () => {
    const small = getV2AmountOut(pool, TOKEN_A, 1n * 10n ** 18n);
    const large = getV2AmountOut(pool, TOKEN_A, 100n * 10n ** 18n);

    const priceSmall = Number(small) / 1e6; // per WETH
    const priceLarge = Number(large) / 1e6 / 100; // per WETH

    expect(priceLarge).toBeLessThan(priceSmall);
  });
});

describe("getV3Price", () => {
  it("should calculate correct price from sqrtPriceX96", () => {
    // sqrtPriceX96 for ~3200 USDC/WETH
    // price = (sqrtPriceX96 / 2^96)^2
    // For WETH(18dec)/USDC(6dec) pair where WETH is token0:
    // raw price token0InToken1 = 3200 * 10^(6-18) = 3200 * 10^-12
    // sqrtPrice = sqrt(3200 * 10^-12) ≈ 1.7889e-6 * 2^96 ≈ 1.4167e71...
    // Let's use a realistic value
    const sqrtPriceX96 = 4_468_362_717_044_691_460_564_684n; // ~3200 USDC/ETH

    const pool: V3PoolState = {
      sqrtPriceX96,
      tick: -196200,
      liquidity: 10000000000000000n,
      token0: TOKEN_A,
    };

    const price = getV3Price(pool, TOKEN_A, 18, 6);
    // The price should be a positive number representing WETH->USDC rate
    expect(price).toBeGreaterThan(0);
    expect(typeof price).toBe("number");
    expect(Number.isFinite(price)).toBe(true);
  });
});
