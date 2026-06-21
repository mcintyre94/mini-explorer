// Thin JSON-RPC client. Keys stay server-side (read from .env).
const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL is not set (expected in .env)');

let id = 0;
export async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result as T;
}

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
  slot: number;
  blockTime: number | null;
  version: number | 'legacy';
  transaction: { message: { accountKeys: AccountKey[]; instructions: ParsedInstruction[] }; signatures: string[] };
  meta: {
    err: unknown | null;
    fee: number;
    computeUnitsConsumed?: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
    logMessages?: string[];
  };
};

export const getTransaction = (sig: string) =>
  rpc<TransactionResult | null>('getTransaction', [
    sig,
    { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' },
  ]);

// ---- Account info (drives the account-page route) --------------------------
export type AccountData =
  | [string, string] // [base64, 'base64'] when not parseable
  | { program?: string; parsed?: { type?: string; info?: Record<string, unknown> }; space?: number };

export type AccountValue = {
  owner: string;
  executable: boolean;
  lamports: number;
  rentEpoch?: number;
  space?: number;
  data: AccountData;
};

export const getAccountInfo = (addr: string) =>
  rpc<{ value: AccountValue | null }>('getAccountInfo', [addr, { encoding: 'jsonParsed' }]);

export type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown | null;
  blockTime: number | null;
  memo: string | null;
  confirmationStatus?: string;
};

export const getSignaturesForAddress = (addr: string, limit = 10) =>
  rpc<SignatureInfo[]>('getSignaturesForAddress', [addr, { limit }]);
