import { describe, it, expect } from "vitest";
import {
  EXECUTOR_CONFIG,
  RISK_CONFIG,
  STRATEGY_CONFIG,
  ANALYST_CONFIG,
  PRICE_GUARD_CONFIG,
} from "../src/strategyConfig.js";

describe("EXECUTOR_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(EXECUTOR_CONFIG.DEADLINE_SECONDS).toBeGreaterThan(0);
    expect(EXECUTOR_CONFIG.SLIPPAGE_BPS).toBeGreaterThan(0);
    expect(EXECUTOR_CONFIG.SLIPPAGE_BPS).toBeLessThanOrEqual(1000); // max 10%
    expect(EXECUTOR_CONFIG.TRADE_BUFFER_BPS).toBeGreaterThan(0);
    expect(EXECUTOR_CONFIG.TRADE_BUFFER_BPS).toBeLessThanOrEqual(2000); // max 20%
    expect(EXECUTOR_CONFIG.MAX_RETRIES).toBeGreaterThanOrEqual(0);
    expect(EXECUTOR_CONFIG.RETRY_BASE_DELAY_MS).toBeGreaterThan(0);
    expect(EXECUTOR_CONFIG.RETRYABLE_ERRORS.length).toBeGreaterThan(0);
  });
});

describe("RISK_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(RISK_CONFIG.MAX_TRADE_AMOUNT_ETH).toBeGreaterThan(0);
    expect(RISK_CONFIG.MAX_DAILY_LOSS_ETH).toBeGreaterThan(0);
    expect(RISK_CONFIG.MAX_OPEN_TRADES).toBeGreaterThanOrEqual(1);
    expect(RISK_CONFIG.MIN_CONFIDENCE).toBeGreaterThan(0);
    expect(RISK_CONFIG.MIN_CONFIDENCE).toBeLessThanOrEqual(100);
    expect(RISK_CONFIG.COOLDOWN_MS).toBeGreaterThan(0);
    expect(RISK_CONFIG.MAX_CONSECUTIVE_FAILS).toBeGreaterThan(0);
  });
});

describe("STRATEGY_CONFIG", () => {
  it("should have weights that sum to 100", () => {
    const sum =
      STRATEGY_CONFIG.WEIGHT_SPREAD +
      STRATEGY_CONFIG.WEIGHT_CONFIDENCE +
      STRATEGY_CONFIG.WEIGHT_LIQUIDITY +
      STRATEGY_CONFIG.WEIGHT_HISTORY +
      STRATEGY_CONFIG.WEIGHT_GAS_EFFICIENCY;
    expect(sum).toBe(100);
  });

  it("should have flashloan thresholds higher than simple", () => {
    expect(STRATEGY_CONFIG.FLASHLOAN_MIN_PROFIT_USD).toBeGreaterThan(
      STRATEGY_CONFIG.SIMPLE_MIN_PROFIT_USD,
    );
    expect(STRATEGY_CONFIG.FLASHLOAN_MIN_CONFIDENCE).toBeGreaterThan(
      STRATEGY_CONFIG.SIMPLE_MIN_CONFIDENCE,
    );
  });
});

describe("ANALYST_CONFIG", () => {
  it("should have ordered liquidity thresholds", () => {
    expect(ANALYST_CONFIG.LIQUIDITY_EXCELLENT).toBeGreaterThan(ANALYST_CONFIG.LIQUIDITY_GOOD);
    expect(ANALYST_CONFIG.LIQUIDITY_GOOD).toBeGreaterThan(ANALYST_CONFIG.LIQUIDITY_FAIR);
    expect(ANALYST_CONFIG.LIQUIDITY_FAIR).toBeGreaterThan(ANALYST_CONFIG.LIQUIDITY_LOW);
    expect(ANALYST_CONFIG.LIQUIDITY_LOW).toBeGreaterThan(ANALYST_CONFIG.LIQUIDITY_POOR);
  });
});

describe("PRICE_GUARD_CONFIG", () => {
  it("should have positive cache TTL", () => {
    expect(PRICE_GUARD_CONFIG.CACHE_TTL_MS).toBeGreaterThan(0);
  });

  it("should have reasonable deviation limit", () => {
    expect(PRICE_GUARD_CONFIG.MAX_DEVIATION_PERCENT).toBeGreaterThan(0);
    expect(PRICE_GUARD_CONFIG.MAX_DEVIATION_PERCENT).toBeLessThan(50);
  });
});
