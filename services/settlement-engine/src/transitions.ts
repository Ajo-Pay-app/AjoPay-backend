export type PaymentStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";

export type PaidTransitionResult =
  | { kind: "not_found" }
  | { kind: "already_paid" }
  | { kind: "invalid_state"; currentStatus: PaymentStatus }
  | { kind: "apply" };

/**
 * Pure decision function for "can this payment be marked paid right now?".
 * Kept separate from the Prisma calls in index.ts so the state-machine rules
 * can be unit tested without a database.
 */
export function decidePaidTransition(payment: { status: PaymentStatus } | null): PaidTransitionResult {
  if (!payment) return { kind: "not_found" };
  if (payment.status === "PAID") return { kind: "already_paid" };
  if (payment.status !== "PENDING") return { kind: "invalid_state", currentStatus: payment.status };
  return { kind: "apply" };
}

export function httpStatusFor(result: PaidTransitionResult): number {
  switch (result.kind) {
    case "not_found":
      return 404;
    case "already_paid":
      return 200;
    case "invalid_state":
      return 409;
    case "apply":
      return 200;
  }
}

/** True only when a *new* paid transition actually happened (used to decide whether to fire a webhook). */
export function isFreshTransition(result: PaidTransitionResult): boolean {
  return result.kind === "apply";
}

export function isExpired(payment: { status: PaymentStatus; expiresAt: Date }, now = new Date()): boolean {
  return payment.status === "PENDING" && payment.expiresAt < now;
}
