import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@ajopay/db";
import { requireAuth, signToken, type AuthedRequest } from "./auth.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

const PORT = Number(process.env.GATEWAY_PORT ?? 4000);
const SETTLEMENT_URL = process.env.SETTLEMENT_URL ?? "http://localhost:4001";
const FX_URL = process.env.FX_URL ?? "http://localhost:4002";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";

app.get("/health", (_req, res) => res.json({ ok: true, service: "api-gateway" }));

// ---------- Auth ----------
const signupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  businessName: z.string().min(2),
  stellarAddress: z.string().min(5),
  payoutCurrency: z.string().length(3).default("NGN"),
});

app.post("/auth/signup", async (req, res) => {
  const parsed = signupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, businessName, stellarAddress, payoutCurrency } = parsed.data;

  const existing = await prisma.merchant.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const merchant = await prisma.merchant.create({
    data: { email, passwordHash, businessName, stellarAddress, payoutCurrency: payoutCurrency.toUpperCase() },
  });

  res.status(201).json({
    token: signToken(merchant.id),
    merchant: { id: merchant.id, email: merchant.email, businessName: merchant.businessName },
  });
});

const loginBody = z.object({ email: z.string().email(), password: z.string() });

app.post("/auth/login", async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const merchant = await prisma.merchant.findUnique({ where: { email: parsed.data.email } });
  if (!merchant) return res.status(401).json({ error: "invalid credentials" });

  const ok = await bcrypt.compare(parsed.data.password, merchant.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });

  res.json({
    token: signToken(merchant.id),
    merchant: { id: merchant.id, email: merchant.email, businessName: merchant.businessName },
  });
});

app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: req.merchantId } });
  if (!merchant) return res.status(404).json({ error: "not found" });
  const { passwordHash: _omit, ...safe } = merchant;
  res.json(safe);
});

// ---------- FX (public passthrough — no auth needed to preview a quote) ----------
app.get("/fx/rates", async (_req, res) => {
  const r = await fetch(`${FX_URL}/rates`);
  res.status(r.status).json(await r.json());
});

// ---------- Payments (merchant-authed) ----------
const createPaymentBody = z.object({
  amountUsdc: z.number().positive().max(100_000),
  currency: z.string().length(3).optional(),
});

app.post("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createPaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const merchant = await prisma.merchant.findUnique({ where: { id: req.merchantId } });
  if (!merchant) return res.status(404).json({ error: "merchant not found" });

  const r = await fetch(`${SETTLEMENT_URL}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({
      merchantId: merchant.id,
      amountUsdc: parsed.data.amountUsdc,
      currency: parsed.data.currency ?? merchant.payoutCurrency,
    }),
  });
  res.status(r.status).json(await r.json());
});

app.get("/payments/:id", requireAuth, async (req, res) => {
  const r = await fetch(`${SETTLEMENT_URL}/payments/${req.params.id}`, {
    headers: { "x-internal-key": INTERNAL_KEY },
  });
  res.status(r.status).json(await r.json());
});

app.get("/payments", requireAuth, async (req: AuthedRequest, res) => {
  const r = await fetch(`${SETTLEMENT_URL}/merchants/${req.merchantId}/payments`, {
    headers: { "x-internal-key": INTERNAL_KEY },
  });
  res.status(r.status).json(await r.json());
});

app.get("/summary", requireAuth, async (req: AuthedRequest, res) => {
  const r = await fetch(`${SETTLEMENT_URL}/merchants/${req.merchantId}/summary`, {
    headers: { "x-internal-key": INTERNAL_KEY },
  });
  res.status(r.status).json(await r.json());
});

app.post("/payments/:id/cashout", requireAuth, async (req, res) => {
  const r = await fetch(`${SETTLEMENT_URL}/payments/${req.params.id}/cashout`, {
    method: "POST",
    headers: { "x-internal-key": INTERNAL_KEY },
  });
  res.status(r.status).json(await r.json());
});

// Demo-only: simulate a wallet payment without a real Freighter flow, useful
// while building the frontend before the on-chain call is wired up. Disable in prod.
if (process.env.DEMO_MODE === "true") {
  app.post("/payments/:id/simulate-pay", async (req, res) => {
    const r = await fetch(`${SETTLEMENT_URL}/payments/${req.params.id}/paid`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
      body: JSON.stringify({ payerAddress: "GDEMOPAYERSIMULATEDADDRESS", txHash: "demo-simulated" }),
    });
    res.status(r.status).json(await r.json());
  });
}

app.listen(PORT, () => console.log(`api-gateway listening on :${PORT}`));
