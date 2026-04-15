import { describe, it, expect } from "vitest";
import { escapeHtml, isEnabled } from "../src/telegram/bot.js";

describe("escapeHtml", () => {
  it("should escape < and >", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("should escape &", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("should handle empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("should not double-escape", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("isEnabled", () => {
  it("should return false when env vars are not set", () => {
    // In test environment, TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set
    expect(isEnabled()).toBe(false);
  });
});
