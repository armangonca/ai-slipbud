import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateTradeId,
  getStats,
  getPairWinRate,
  getRouteWinRate,
  getRecentTrades,
  recordTrade,
  loadMemory,
  type TradeRecord,
} from "../src/agent/memory.js";

// Mock file system so tests don't write to disk
vi.mock("fs", () => ({
  existsSync: () => false,
  readFileSync: () => "[]",
  writeFileSync: () => {},
  mkdirSync: () => {},
}));

function makeTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: generateTradeId(),
    timestamp: Date.now(),
    pair: "WETH/USDC",
    buyDex: "UniswapV2",
    sellDex: "SushiSwap",
    amountIn: "100000000000000000",
    amountOut: "320000",
    profitEth: 0.01,
    profitUsd: 32,
    gasUsed: "150000",
    gasCostEth: 0.003,
    spreadPercent: 0.31,
    confidence: 75,
    success: true,
    executionTimeMs: 5000,
    ...overrides,
  };
}

describe("generateTradeId", () => {
  it("should generate unique IDs", () => {
    const id1 = generateTradeId();
    const id2 = generateTradeId();
    expect(id1).not.toBe(id2);
  });

  it("should start with 'trade_'", () => {
    const id = generateTradeId();
    expect(id.startsWith("trade_")).toBe(true);
  });
});

describe("getStats", () => {
  beforeEach(() => {
    // Load empty memory (fs is mocked to return empty)
    loadMemory();
  });

  it("should return zero stats when no trades", () => {
    const stats = getStats();
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.netProfitEth).toBe(0);
  });

  it("should calculate correct stats after trades", () => {
    recordTrade(makeTrade({ success: true, profitEth: 0.01, gasCostEth: 0.003 }));
    recordTrade(makeTrade({ success: true, profitEth: 0.02, gasCostEth: 0.003 }));
    recordTrade(makeTrade({ success: false, profitEth: 0, gasCostEth: 0.003 }));

    const stats = getStats();
    expect(stats.totalTrades).toBe(3);
    expect(stats.successfulTrades).toBe(2);
    expect(stats.failedTrades).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.67, 0);
    expect(stats.totalProfitEth).toBeCloseTo(0.03, 4);
    expect(stats.totalGasCostEth).toBeCloseTo(0.009, 4);
    expect(stats.netProfitEth).toBeCloseTo(0.021, 4);
  });
});

describe("getPairWinRate", () => {
  beforeEach(() => {
    loadMemory();
  });

  it("should return 50 for unknown pair (neutral default)", () => {
    expect(getPairWinRate("UNKNOWN/PAIR")).toBe(50);
  });

  it("should calculate correct pair win rate", () => {
    recordTrade(makeTrade({ pair: "WETH/USDC", success: true }));
    recordTrade(makeTrade({ pair: "WETH/USDC", success: true }));
    recordTrade(makeTrade({ pair: "WETH/USDC", success: false }));

    expect(getPairWinRate("WETH/USDC")).toBeCloseTo(66.67, 0);
  });
});

describe("getRouteWinRate", () => {
  beforeEach(() => {
    loadMemory();
  });

  it("should return 50 for unknown route", () => {
    expect(getRouteWinRate("X", "Y")).toBe(50);
  });
});

describe("getRecentTrades", () => {
  beforeEach(() => {
    loadMemory();
  });

  it("should return recent trades in order", () => {
    const countBefore = getRecentTrades(1000).length;
    for (let i = 0; i < 10; i++) {
      recordTrade(makeTrade({ id: `recent_${i}` }));
    }

    const recent = getRecentTrades(3);
    expect(recent.length).toBe(3);
    expect(recent[2].id).toBe("recent_9");
  });
});
