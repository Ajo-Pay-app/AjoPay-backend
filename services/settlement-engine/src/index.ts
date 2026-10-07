import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@ajopay/db";

const app = express();
app.use(express.json());

const PORT = Number(process.env.SETTLEMENT_PORT ?? 4001);
const FX_URL = process.env.FX_URL ?? "http://localhost:4002";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";
const PAYMENT_TTL_MS = 30 * 60 * 1000;

// Only other AjoPay services may call this service.
function internalOnly(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health") return next();
  if (req.header("x-internal-key") !== INTERNAL_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}
app.use(internalOnly);

app.get("/health", (_req, res) => res.json({ ok: true, service: "settlement-engine" }));

const createPaymentBody = z.object({
  merchantId: z.string().min(1),
  amountUsdc: z.number().positive().max(100_000),
  currency: z.string().length(3),
});

app.post("/payments", async (req, res) => {
  const parsed = createPaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { merchantId, amountUsdc, currency } = parsed.data;

  const quoteRes = await fetch(`${FX_URL}/quote?amountUsdc=${amountUsdc}&currency=${currency}`);
  if (!quoteRes.ok) return res.status(502).json({ error: "fx-engine could not quote", detail: await quoteRes.text() });
  const quote = (await quoteRes.json()) as { rate: number; amountFiat: number; currency: string };

  const payment = await prisma.payment.create({
    data: {
      merchantId,
      reference: `AJO-${randomBytes(4).toString("hex").toUpperCase()}`,
      amountUsdc,
      currency: quote.currency,
      fxRate: quote.rate,
      amountFiat: quote.amountFiat,
      expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
    },
  });
  res.status(201).json(payment);
});

app.get("/payments/:id", async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { merchant: { select: { businessName: true, stellarAddress: true } }, settlement: true },
  });
  if (!payment) return res.status(404).json({ error: "not found" });

  // Lazily expire stale pending payments.
  if (payment.status === "PENDING" && payment.expiresAt < new Date()) {
    const expired = await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
    return res.json({ ...payment, status: expired.status });
  }
  res.json(payment);
});

app.get("/merchants/:merchantId/payments", async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { merchantId: req.params.merchantId },
    include: { settlement: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(payments);
});

app.get("/merchants/:merchantId/summary", async (req, res) => {
  const { merchantId } = req.params;
  const [paid, pending, settled] = await Promise.all([
    prisma.payment.aggregate({ where: { merchantId, status: "PAID" }, _sum: { amountUsdc: true, amountFiat: true }, _count: true }),
    prisma.payment.count({ where: { merchantId, status: "PENDING" } }),
    prisma.settlement.aggregate({ where: { status: "COMPLETED", payment: { merchantId } }, _sum: { amountFiat: true } }),
  ]);
  res.json({
    paidCount: paid._count,
    pendingCount: pending,
    totalUsdc: paid._sum.amountUsdc ?? "0",
    totalFiatEarned: paid._sum.amountFiat ?? "0",
    totalFiatCashedOut: settled._sum.amountFiat ?? "0",
  });
});

// Link a payment to the id the contract returned from create_payment_request.
app.post("/payments/:id/link-onchain", async (req, res) => {
  const body = z.object({ onChainId: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const payment = await prisma.payment.update({ where: { id: req.params.id }, data: { onChainId: body.data.onChainId } });
  res.json(payment);
});

const paidBody = z.object({
  txHash: z.string().optional(),
  payerAddress: z.string().optional(),
});

async function markPaid(where: { id?: string; onChainId?: number }, data: z.infer<typeof paidBody>) {
  const payment = await prisma.payment.findFirst({ where });
  if (!payment) return { status: 404 as const, body: { error: "payment not found" } };
  if (payment.status === "PAID") return { status: 200 as const, body: payment };
  if (payment.status !== "PENDING") return { status: 409 as const, body: { error: `payment is ${payment.status}` } };

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: new Date(), txHash: data.txHash, payerAddress: data.payerAddress },
    });
    await tx.settlement.create({
      data: { paymentId: p.id, amountFiat: p.amountFiat, currency: p.currency, status: "QUEUED" },
    });
    return p;
  });
  return { status: 200 as const, body: updated };
}

app.post("/payments/:id/paid", async (req, res) => {
  const body = paidBody.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const out = await markPaid({ id: req.params.id }, body.data);
  res.status(out.status).json(out.body);
});

// Called by the indexer when it sees a payment_settled event.
app.post("/payments/by-onchain/:onChainId/paid", async (req, res) => {
  const body = paidBody.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  const out = await markPaid({ onChainId: Number(req.params.onChainId) }, body.data);
  res.status(out.status).json(out.body);
});

// Cash out to the merchant's local bank. The anchor call is mocked here:
// replace `callAnchor` with a real SEP-24 / SEP-31 integration for production.
async function callAnchor(settlement: { id: string; amountFiat: unknown; currency: string }) {
  await new Promise((r) => setTimeout(r, 500));
  return { anchorRef: `ANCHOR-${randomBytes(5).toString("hex").toUpperCase()}` };
}

app.post("/payments/:id/cashout", async (req, res) => {
  const settlement = await prisma.settlement.findUnique({ where: { paymentId: req.params.id } });
  if (!settlement) return res.status(404).json({ error: "no settlement for this payment (is it paid?)" });
  if (settlement.status === "COMPLETED") return res.json(settlement);
  if (settlement.status === "PROCESSING") return res.status(409).json({ error: "already processing" });

  await prisma.settlement.update({ where: { id: settlement.id }, data: { status: "PROCESSING" } });
  try {
    const { anchorRef } = await callAnchor(settlement);
    const done = await prisma.settlement.update({ where: { id: settlement.id }, data: { status: "COMPLETED", anchorRef } });
    res.json(done);
  } catch (err) {
    await prisma.settlement.update({ where: { id: settlement.id }, data: { status: "FAILED" } });
    res.status(502).json({ error: "anchor call failed", detail: (err as Error).message });
  }
});

app.listen(PORT, () => console.log(`settlement-engine listening on :${PORT}`));
