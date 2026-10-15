export interface Quote {
  currency: string;
  marketRate: number;
  rate: number;
  amountUsdc: number;
  amountFiat: number;
  spreadBps: number;
}

/**
 * Pure function: given a market rate and the platform's spread, compute what
 * the merchant actually receives. Kept separate from the Express route and
 * the live-rate fetch so it's trivial to unit test without network calls.
 */
export function computeQuote(args: {
  marketRate: number;
  amountUsdc: number;
  currency: string;
  spreadBps: number;
}): Quote {
  const { marketRate, amountUsdc, currency, spreadBps } = args;
  if (marketRate <= 0) throw new Error("marketRate must be positive");
  if (amountUsdc <= 0) throw new Error("amountUsdc must be positive");

  const rate = marketRate * (1 - spreadBps / 10_000);
  const amountFiat = Number((amountUsdc * rate).toFixed(2));

  return {
    currency,
    marketRate,
    rate: Number(rate.toFixed(6)),
    amountUsdc,
    amountFiat,
    spreadBps,
  };
}
