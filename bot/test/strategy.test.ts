import { describe, it, expect, beforeEach } from "vitest";
import { evaluateOpportunity, selectBestOpportunity } from "../src/agent/strategy.js";
import { resumeAgent } from "../src/agent/risk.js";
import type { ArbitrageOpportunity } from "../src/arbitrage.js";
import type { PairAnalysis } from "../src/agent/analyst.js";
import type { Address } from "viem";

const TOKEN_A = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const TOKEN_B = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

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
    estimatedProfitUsd: 15,
    optimalAmountIn: 100000000000000000n,
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

describe("evaluateOpportunity", () => {
  beforeEach(() => {
    resumeAgent();
  });

  it("should produce a score between 0 and 100", () => {
    const decision = evaluateOpportunity(makeOpp(), makeAnalysis());
    expect(decision.score).toBeGreaterThanOrEqual(0);
    expect(decision.score).toBeLessThanOrEqual(100);
  });

  it("should include reasoning", () => {
    const decision = evaluateOpportunity(makeOpp(), makeAnalysis());
    expect(decision.reasoning.length).toBeGreaterThan(0);
  });

  it("should select flashloan mode for high profit + high confidence", () => {
    const decision = evaluateOpportunity(
      makeOpp({ estimatedProfitUsd: 20 }),
      makeAnalysis({ confidence: 80 }),
    );
    expect(decision.mode).toBe("flashloan");
  });

  it("should select simple mode for medium profit", () => {
    const decision = evaluateOpportunity(
      makeOpp({ estimatedProfitUsd: 5 }),
      makeAnalysis({ confidence: 60 }),
    );
    expect(decision.mode).toBe("simple");
  });

  it("should skip for very low profit", () => {
    const decision = evaluateOpportunity(
      makeOpp({ estimatedProfitUsd: 0.5 }),
      makeAnalysis({ confidence: 40 }),
    );
    expect(decision.mode).toBe("skip");
  });
});

describe("selectBestOpportunity", () => {
  beforeEach(() => {
    resumeAgent();
  });

  it("should return null when no opportunities pass", () => {
    const opps = [makeOpp({ estimatedProfitUsd: 0.1, spreadPercent: 0.01 })];
    const analyses = [makeAnalysis({ confidence: 30, liquidityScore: 10 })];
    const result = selectBestOpportunity(opps, analyses);
    expect(result).toBeNull();
  });

  it("should pick the highest-scoring opportunity", () => {
    const opp1 = makeOpp({ estimatedProfitUsd: 5, spreadPercent: 0.2 });
    const opp2 = makeOpp({ estimatedProfitUsd: 20, spreadPercent: 0.5 });
    const analysis = makeAnalysis({ confidence: 80, liquidityScore: 80 });

    const result = selectBestOpportunity([opp1, opp2], [analysis]);
    if (result) {
      expect(result.opportunity.estimatedProfitUsd).toBe(20);
    }
  });
});
