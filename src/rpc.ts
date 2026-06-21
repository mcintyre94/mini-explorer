import { createSolanaRpc, type Address, type Signature } from '@solana/kit';

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL is not set (expected in .env)');

// kit's RPC client (a proxy). u64/i64 fields come back as `bigint`. We add the
// type for Triton's custom getTransactionsForAddress — the proxy dispatches any
// method name at runtime, so only the type is needed. Responses are cast to our
// own loose shapes (kit's jsonParsed unions are gnarly; we access defensively).
type GtfaConfig = {
  transactionDetails: 'full' | 'signatures';
  encoding?: 'json' | 'jsonParsed' | 'base64' | 'base58';
  maxSupportedTransactionVersion?: number;
  limit?: number;
  filters?: { tokenAccounts?: 'none' | 'balanceChanged' | 'all' };
};
type WithTriton = {
  getTransactionsForAddress(address: string, config: GtfaConfig): { send(): Promise<{ data?: GtfaEntry[] }> };
};

const base = createSolanaRpc(RPC_URL);
const rpc = base as typeof base & WithTriton;

// ---- Shapes we read (defensive: treat as intent, access fields carefully) ----
export type ParsedInstruction = {
  programId: string;
  program?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
  accounts?: string[];
  data?: string;
  stackHeight?: number;
};

export type AccountKey = { pubkey: string; signer: boolean; writable: boolean; source?: string };

export type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null; uiAmountString: string };
};

export type TransactionResult = {
  slot: bigint;
  blockTime: bigint | null;
  version: number | 'legacy';
  transaction: { message: { accountKeys: AccountKey[]; instructions: ParsedInstruction[] }; signatures: string[] };
  meta: {
    err: unknown | null;
    fee: bigint;
    computeUnitsConsumed?: bigint;
    preBalances: bigint[];
    postBalances: bigint[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
    logMessages?: string[];
  };
};

export const getTransaction = (sig: string) =>
  rpc
    .getTransaction(sig as Signature, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' })
    .send() as unknown as Promise<TransactionResult | null>;

// ---- Account info (drives the account-page route) --------------------------
export type AccountData =
  | [string, string] // [base64, 'base64'] when not parseable
  | { program?: string; parsed?: { type?: string; info?: Record<string, unknown> }; space?: number };

export type AccountValue = {
  owner: string;
  executable: boolean;
  lamports: bigint;
  rentEpoch?: bigint;
  space?: number;
  data: AccountData;
};

export const getAccountInfo = (addr: string) =>
  rpc.getAccountInfo(addr as Address, { encoding: 'jsonParsed' }).send() as unknown as Promise<{
    value: AccountValue | null;
  }>;

export type SignatureInfo = {
  signature: string;
  slot: bigint;
  err: unknown | null;
  blockTime: bigint | null;
};

export const getSignaturesForAddress = (addr: string, limit = 10) =>
  rpc.getSignaturesForAddress(addr as Address, { limit }).send() as unknown as Promise<SignatureInfo[]>;

// A history entry — numbers coerced to `number` here so callers stay simple.
export type HistoryIx = { programId: string; program?: string; parsed?: { type?: string } };
export type HistoryEntry = {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
  instructions: HistoryIx[]; // top-level; empty if we fell back to signatures-only
};

type GtfaEntry = {
  slot: bigint;
  blockTime: bigint | null;
  meta: { err: unknown | null };
  transaction: { signatures: string[]; message: { instructions: HistoryIx[] } };
};

// Triton's getTransactionsForAddress returns FULL txs in one call (so we can
// summarize each), and `tokenAccounts: balanceChanged` also surfaces a wallet's
// token transfers (which don't name the wallet pubkey). Falls back to the
// standard getSignaturesForAddress (signatures only) on any non-Triton RPC.
export async function getAccountTransactions(addr: string, limit = 10): Promise<HistoryEntry[]> {
  try {
    const r = await rpc.getTransactionsForAddress(addr, {
      transactionDetails: 'full',
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
      limit,
      filters: { tokenAccounts: 'balanceChanged' },
    }).send();
    return (r?.data ?? []).map((e) => ({
      signature: e.transaction?.signatures?.[0] ?? '',
      slot: Number(e.slot),
      blockTime: e.blockTime != null ? Number(e.blockTime) : null,
      err: e.meta?.err ?? null,
      instructions: e.transaction?.message?.instructions ?? [],
    }));
  } catch {
    const sigs = await getSignaturesForAddress(addr, limit).catch(() => []);
    return sigs.map((s) => ({
      signature: s.signature,
      slot: Number(s.slot),
      blockTime: s.blockTime != null ? Number(s.blockTime) : null,
      err: s.err,
      instructions: [],
    }));
  }
}
