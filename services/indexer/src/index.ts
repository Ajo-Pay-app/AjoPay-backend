import express from "express";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { prisma } from "@ajopay/db";

const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.SETTLEMENT_CONTRACT_ID ?? "";
const SETTLEMENT_URL = process.env.SETTLEMENT_URL ?? "http://localhost:4001";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 8000);
const PORT = Number(process.env.INDEXER_PORT ?? 4003);
const STATE_ID = "settlement";

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error || !json.result) throw new Error(json.error?.message ?? "empty RPC result");
  return json.result;
}

type RpcEvent = { ledger: number; topic: string[]; value: string; txHash: string };

const decode = (b64: string) => scValToNative(xdr.ScVal.fromXDR(b64, "base64"));

async function handleEvent(ev: RpcEvent) {
  const name = String(decode(ev.topic[0]));
  if (name !== "payment_settled") return;

  // Contract publishes value as (payment_id, merchant_share, fee)
  const [paymentId] = decode(ev.value) as [bigint | number, bigint, bigint];
  const onChainId = Number(paymentId);

  const res = await fetch(`${SETTLEMENT_URL}/payments/by-onchain/${onChainId}/paid`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify({ txHash: ev.txHash }),
  });
  console.log(`[indexer] payment_settled on-chain #${onChainId} -> settlement-engine ${res.status}`);
}

async function poll() {
  if (!CONTRACT_ID || CONTRACT_ID.startsWith("PASTE")) {
    console.warn("[indexer] SETTLEMENT_CONTRACT_ID not set: idle. Deploy the contract and set it in .env");
    return;
  }
  const state = await prisma.indexerState.findUnique({ where: { id: STATE_ID } });
  const latest = await rpc<{ sequence: number }>("getLatestLedger");
  const startLedger = state ? state.lastLedger + 1 : latest.sequence;

  const result = await rpc<{ events: RpcEvent[]; latestLedger: number }>("getEvents", {
    startLedger,
    filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
    pagination: { limit: 100 },
  });

  for (const ev of result.events) await handleEvent(ev);

  await prisma.indexerState.upsert({
    where: { id: STATE_ID },
    update: { lastLedger: result.latestLedger },
    create: { id: STATE_ID, lastLedger: result.latestLedger },
  });
}

async function loop() {
  for (;;) {
    try {
      await poll();
    } catch (err) {
      console.error("[indexer] poll failed:", (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const app = express();
app.get("/health", async (_req, res) => {
  const state = await prisma.indexerState.findUnique({ where: { id: STATE_ID } });
  res.json({ ok: true, service: "indexer", lastLedger: state?.lastLedger ?? null });
});
app.listen(PORT, () => console.log(`indexer listening on :${PORT}`));
void loop();
