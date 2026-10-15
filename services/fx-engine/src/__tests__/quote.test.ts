import { describe, expect, it } from "vitest";
import { computeQuote } from "../quote.js";

describe("computeQuote", () => {
  it("applies the platform spread below the market rate", () => {
    const quote = computeQuote({ marketRate: 1600, amountUsdc: 100, currency: "NGN", spreadBps: 50 });
    // 0.5% below market: 1600 * 0.995 = 1592
    expect(quote.rate).toBeCloseTo(1592, 5);
    expect(quote.amountFiat).toBeCloseTo(159_200, 2);
  });

  it("rounds amountFiat to 2 decimal places", () => {
    const quote = computeQuote({ marketRate: 129.3333, amountUsdc: 37.5, currency: "KES", spreadBps: 50 });
    expect(quote.amountFiat.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("a zero spread returns exactly the market rate", () => {
    const quote = computeQuote({ marketRate: 15.5, amountUsdc: 10, currency: "GHS", spreadBps: 0 });
    expect(quote.rate).toBe(15.5);
  });

  it("throws on a non-positive market rate", () => {
    expect(() => computeQuote({ marketRate: 0, amountUsdc: 10, currency: "NGN", spreadBps: 50 })).toThrow();
  });

  it("throws on a non-positive amount", () => {
    expect(() => computeQuote({ marketRate: 1600, amountUsdc: -5, currency: "NGN", spreadBps: 50 })).toThrow();
  });

  it("higher spread strictly lowers what the merchant receives", () => {
    const low = computeQuote({ marketRate: 1600, amountUsdc: 100, currency: "NGN", spreadBps: 50 });
    const high = computeQuote({ marketRate: 1600, amountUsdc: 100, currency: "NGN", spreadBps: 200 });
    expect(high.amountFiat).toBeLessThan(low.amountFiat);
  });
});
