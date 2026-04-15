import { describe, it, expect } from "vitest";
import {
  isX402Enabled,
  getSpendingStatus,
  X402Error,
  X402DisabledError,
  X402BudgetError,
} from "../src/x402/client.js";

describe("x402 client", () => {
  it("should report x402 as disabled by default (no env)", () => {
    // X402_ENABLED env is not set in test
    expect(isX402Enabled()).toBe(false);
  });

  it("should return initial spending status", () => {
    const status = getSpendingStatus();
    expect(status.dailySpent).toBe(0n);
    expect(status.totalPayments).toBe(0);
    expect(status.remainingBudget).toBe(status.dailyBudget);
  });
});

describe("x402 error types", () => {
  it("X402Error should contain resource URL", () => {
    const err = new X402Error("test error", "https://api.example.com");
    expect(err.message).toContain("test error");
    expect(err.resource).toBe("https://api.example.com");
    expect(err.name).toBe("X402Error");
  });

  it("X402DisabledError should extend X402Error", () => {
    const err = new X402DisabledError("https://api.example.com");
    expect(err).toBeInstanceOf(X402Error);
    expect(err.name).toBe("X402DisabledError");
  });

  it("X402BudgetError should include requested amount", () => {
    const err = new X402BudgetError("over budget", "https://api.example.com", 1000000n);
    expect(err).toBeInstanceOf(X402Error);
    expect(err.requestedAmount).toBe(1000000n);
    expect(err.name).toBe("X402BudgetError");
  });
});
