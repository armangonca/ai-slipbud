import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRisk,
  onTradeStarted,
  onTradeCompleted,
  onTradeFailed,
  pauseAgent,
  resumeAgent,
  getRiskState,
  type RiskConfig,
} from "../src/agent/risk.js";
import type { ArbitrageOpportunity } from "../src/arbitrage.js";
import type { PairAnalysis } from "../src/agent/analyst.js";
import type { Address } from "viem";

const TOKEN_A = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const TOKEN_B = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

const testConfig: RiskConfig = {
  maxTradeAmountEth: 1.0,
  maxDailyLossEth: 0.5,
  maxOpenTrades: 1,
  minConfidence: 60,
  minLiquidity: 40,
  maxSlippageBps: 50,
  cooldownMs: 1000,
  maxConsecutiveFails: 3,
};

function makeOpp(overrides: Partial<ArbitrageOpportunity> = {}): ArbitrageOpportunity {
  return {
    pair: {
      label: "WETH/USDC",
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      uniV2Pair: TOKEN_A,
      sushiPair: TOKEN_A,
      uniV3Pool: TOKEN_A,
      uniV3Fee: 500,
    },
    buyDex: "UniswapV2",
    sellDex: "SushiSwap",
    buyRouter: TOKEN_A,
    sellRouter: TOKEN_A,
    buySwapType: "V2",
    sellSwapType: "V2",
    buyPrice: 3200,
    sellPrice: 3210,
    spreadPercent: 0.31,
    estimatedProfitUsd: 10,
    optimalAmountIn: 100000000000000000n, // 0.1 ETH
    expectedAmountOut: 320000n,
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<PairAnalysis> = {}): PairAnalysis {
  return {
    label: "WETH/USDC",
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    prices: [],
    maxSpread: 0.31,
    avgSpread: 0.31,
    volatility: 0.5,
    bestBuyDex: "UniswapV2",
    bestSellDex: "SushiSwap",
    liquidityScore: 80,
    confidence: 75,
    ...overrides,
  };
}

describe("checkRisk", () => {
  beforeEach(() => {
    // Reset state by resuming (clears pause and consecutive fails)
    resumeAgent();
  });

  it("should approve a normal opportunity", () => {
    const result = checkRisk(makeOpp(), makeAnalysis(), testConfig);
    expect(result.approved).toBe(true);
  });

  it("should reject when agent is paused", () => {
    pauseAgent("test pause");
    const result = checkRisk(makeOpp(), makeAnalysis(), testConfig);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("paused");
  });

  it("should reject when trade amount exceeds limit", () => {
    const bigOpp = makeOpp({
      optimalAmountIn: 2n * 10n ** 18n, // 2 ETH > 1 ETH limit
    });
    const result = checkRisk(bigOpp, makeAnalysis(), testConfig);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("yüksek");
  });

  it("should reject when confidence is too low", () => {
    const result = checkRisk(makeOpp(), makeAnalysis({ confidence: 30 }), testConfig);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("güven");
  });

  it("should reject when liquidity is too low", () => {
    const result = checkRisk(makeOpp(), makeAnalysis({ liquidityScore: 10 }), testConfig);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("likidite");
  });

  it("should reject unrealistic spread (>5%)", () => {
    const result = checkRisk(
      makeOpp({ spreadPercent: 6.0 }),
      makeAnalysis(),
      testConfig,
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("gerçek dışı");
  });
});

describe("risk state management", () => {
  beforeEach(() => {
    resumeAgent();
  });

  it("should track open trades", () => {
    const before = getRiskState().openTrades;
    onTradeStarted();
    expect(getRiskState().openTrades).toBe(before + 1);
    // Clean up
    onTradeCompleted(0);
  });

  it("should decrement open trades on completion", () => {
    const before = getRiskState().openTrades;
    onTradeStarted();
    expect(getRiskState().openTrades).toBe(before + 1);
    onTradeCompleted(0.01);
    expect(getRiskState().openTrades).toBe(before);
  });

  it("should track consecutive failures", () => {
    onTradeStarted();
    onTradeFailed();
    const state = getRiskState();
    expect(state.consecutiveFails).toBe(1);
  });

  it("should reset consecutive failures on success", () => {
    onTradeStarted();
    onTradeFailed();
    onTradeStarted();
    onTradeCompleted(0.01);
    const state = getRiskState();
    expect(state.consecutiveFails).toBe(0);
  });

  it("should pause and resume correctly", () => {
    pauseAgent("test");
    expect(getRiskState().isPaused).toBe(true);
    expect(getRiskState().pauseReason).toBe("test");

    resumeAgent();
    expect(getRiskState().isPaused).toBe(false);
    expect(getRiskState().pauseReason).toBe("");
  });
});
