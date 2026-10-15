import { createHmac } from "node:crypto";
import { prisma } from "@ajopay/db";

const WEBHOOK_SECRET = process.env.WEBHOOK_SIGNING_SECRET ?? "change-me-webhook-secret";
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;

export type WebhookEvent = "payment.paid" | "settlement.completed" | "settlement.failed";

interface NotifyArgs {
  merchantId: string;
  paymentId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

function sign(body: string) {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
}

/**
 * Fires a webhook to the merchant's configured URL, if they have one set.
 * Retries a couple of times on network failure, and always logs the attempt
 * to WebhookDelivery so a merchant (or you, debugging) can see what happened —
 * this does not block the caller for long: give up after MAX_ATTEMPTS.
 */
export async function notifyMerchant({ merchantId, paymentId, event, payload }: NotifyArgs) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant?.webhookUrl) return; // merchant hasn't configured a webhook — nothing to do

  const body = JSON.stringify({ event, paymentId, data: payload, sentAt: new Date().toISOString() });
  const signature = sign(body);

  let lastError: string | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(merchant.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ajopay-signature": signature },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      lastStatus = res.status;
      if (res.ok) {
        await logDelivery({ merchantId, paymentId, event, url: merchant.webhookUrl, statusCode: res.status, success: true });
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    // Small backoff between retries so a flaky endpoint gets a moment to recover.
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 500));
  }

  await logDelivery({
    merchantId,
    paymentId,
    event,
    url: merchant.webhookUrl,
    statusCode: lastStatus,
    success: false,
    error: lastError,
  });
  console.warn(`[webhooks] gave up delivering ${event} for payment ${paymentId}: ${lastError}`);
}

function logDelivery(args: {
  merchantId: string;
  paymentId: string;
  event: string;
  url: string;
  statusCode: number | null;
  success: boolean;
  error?: string | null;
}) {
  return prisma.webhookDelivery.create({
    data: {
      merchantId: args.merchantId,
      paymentId: args.paymentId,
      event: args.event,
      url: args.url,
      statusCode: args.statusCode ?? undefined,
      success: args.success,
      error: args.error ?? undefined,
    },
  });
}
