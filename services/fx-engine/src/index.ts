import express from "express";
import { z } from "zod";

const app = express();
const PORT = Number(process.env.FX_PORT ?? 4002);
const SPREAD_BPS = Number(process.env.FX_SPREAD_BPS ?? 50);
const CACHE_MS = 5 * 60 * 1000;

// Used only if the live rate provider is unreachable.
const FALLBACK: Record<string, number> = { NGN: 1600, KES: 129, GHS: 15.5, ZAR: 18 };

let cache: { rates: Record<string, number>; fetchedAt: number; source: string } | null = null;

async function getRates() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (!data.rates) throw new Error("no rates in response");
    cache = { rates: data.rates, fetchedAt: Date.now(), source: "open.er-api.com" };
  } catch (err) {
    console.warn("[fx] provider failed, using fallback rates:", (err as Error).message);
    cache = { rates: FALLBACK, fetchedAt: Date.now(), source: "fallback" };
  }
  return cache;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "fx-engine" }));

app.get("/rates", async (_req, res) => {
  const { rates, source, fetchedAt } = await getRates();
  const picked = Object.fromEntries(Object.keys(FALLBACK).map((c) => [c, rates[c] ?? FALLBACK[c]]));
  res.json({ base: "USD", rates: picked, source, fetchedAt });
});

const quoteQuery = z.object({
  amountUsdc: z.coerce.number().positive(),
  currency: z.string().length(3).transform((s) => s.toUpperCase()),
});

app.get("/quote", async (req, res) => {
  const parsed = quoteQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { amountUsdc, currency } = parsed.data;
  const { rates, source } = await getRates();
  const marketRate = rates[currency];
  if (!marketRate) return res.status(400).json({ error: `Unsupported currency ${currency}` });

  // Merchant receives slightly less than mid-market: that's the platform spread.
  const rate = marketRate * (1 - SPREAD_BPS / 10_000);
  res.json({
    currency,
    marketRate,
    rate: Number(rate.toFixed(6)),
    amountUsdc,
    amountFiat: Number((amountUsdc * rate).toFixed(2)),
    spreadBps: SPREAD_BPS,
    source,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

app.listen(PORT, () => console.log(`fx-engine listening on :${PORT}`));
