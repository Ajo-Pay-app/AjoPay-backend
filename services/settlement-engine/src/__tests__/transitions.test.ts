import { describe, expect, it } from "vitest";
import { decidePaidTransition, httpStatusFor, isExpired, isFreshTransition } from "../transitions.js";

describe("decidePaidTransition", () => {
  it("returns not_found for a missing payment", () => {
    const result = decidePaidTransition(null);
    expect(result.kind).toBe("not_found");
    expect(httpStatusFor(result)).toBe(404);
  });

  it("is idempotent for an already-paid payment", () => {
    const result = decidePaidTransition({ status: "PAID" });
    expect(result.kind).toBe("already_paid");
    expect(httpStatusFor(result)).toBe(200);
    expect(isFreshTransition(result)).toBe(false);
  });

  it("rejects an expired payment with 409", () => {
    const result = decidePaidTransition({ status: "EXPIRED" });
    expect(result.kind).toBe("invalid_state");
    expect(httpStatusFor(result)).toBe(409);
  });

  it("rejects a cancelled payment with 409", () => {
    const result = decidePaidTransition({ status: "CANCELLED" });
    expect(result.kind).toBe("invalid_state");
    expect(httpStatusFor(result)).toBe(409);
  });

  it("applies the transition for a pending payment", () => {
    const result = decidePaidTransition({ status: "PENDING" });
    expect(result.kind).toBe("apply");
    expect(httpStatusFor(result)).toBe(200);
    expect(isFreshTransition(result)).toBe(true);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("is true for a pending payment past its expiry", () => {
    const payment = { status: "PENDING" as const, expiresAt: new Date("2026-01-01T11:00:00Z") };
    expect(isExpired(payment, now)).toBe(true);
  });

  it("is false for a pending payment not yet expired", () => {
    const payment = { status: "PENDING" as const, expiresAt: new Date("2026-01-01T13:00:00Z") };
    expect(isExpired(payment, now)).toBe(false);
  });

  it("is false for a non-pending payment even if expiresAt is in the past", () => {
    const payment = { status: "PAID" as const, expiresAt: new Date("2026-01-01T11:00:00Z") };
    expect(isExpired(payment, now)).toBe(false);
  });
});
