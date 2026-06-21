import { getBase58Encoder } from '@solana/kit';
import {
  identifyComputeBudgetInstruction,
  ComputeBudgetInstruction,
  getSetComputeUnitLimitInstructionDataDecoder,
  getSetComputeUnitPriceInstructionDataDecoder,
  getRequestHeapFrameInstructionDataDecoder,
  getSetLoadedAccountsDataSizeLimitInstructionDataDecoder,
} from '@solana-program/compute-budget';
import type { ParsedInstruction, TransactionResult } from './rpc.ts';

// Native decode is synchronous (no IDL, no fetch), so it renders inline in
// wave 1. Hybrid: RPC jsonParsed already decodes Token/System/ATA/etc.; this
// fills its one blind spot — ComputeBudget — via @solana-program/compute-budget.
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const b58 = getBase58Encoder();

export type Decoded = { action: string; args: [string, string][] };

function bytesOf(ix: ParsedInstruction): Uint8Array | null {
  if (!ix.data) return null;
  try {
    return b58.encode(ix.data) as Uint8Array;
  } catch {
    return null;
  }
}

export function decodeComputeBudget(ix: ParsedInstruction): Decoded | null {
  if (ix.programId !== COMPUTE_BUDGET) return null;
  const bytes = bytesOf(ix);
  if (!bytes) return null;
  switch (identifyComputeBudgetInstruction(bytes)) {
    case ComputeBudgetInstruction.SetComputeUnitLimit: {
      const d = getSetComputeUnitLimitInstructionDataDecoder().decode(bytes);
      return { action: 'setComputeUnitLimit', args: [['units', d.units.toLocaleString()]] };
    }
    case ComputeBudgetInstruction.SetComputeUnitPrice: {
      const d = getSetComputeUnitPriceInstructionDataDecoder().decode(bytes);
      return { action: 'setComputeUnitPrice', args: [['microLamports', d.microLamports.toLocaleString()]] };
    }
    case ComputeBudgetInstruction.RequestHeapFrame: {
      const d = getRequestHeapFrameInstructionDataDecoder().decode(bytes);
      return { action: 'requestHeapFrame', args: [['bytes', d.bytes.toLocaleString()]] };
    }
    case ComputeBudgetInstruction.SetLoadedAccountsDataSizeLimit: {
      const d = getSetLoadedAccountsDataSizeLimitInstructionDataDecoder().decode(bytes);
      return { action: 'setLoadedAccountsDataSizeLimit', args: [['bytes', d.accountDataSizeLimit.toLocaleString()]] };
    }
    default:
      return null;
  }
}

// Priority fee (lamports) = unitPrice (µLamports/CU) × unitLimit (CU) ÷ 1e6.
export function priorityFeeLamports(tx: TransactionResult): number | null {
  let limit: bigint | null = null;
  let price: bigint | null = null;
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId !== COMPUTE_BUDGET) continue;
    const bytes = bytesOf(ix);
    if (!bytes) continue;
    const kind = identifyComputeBudgetInstruction(bytes);
    if (kind === ComputeBudgetInstruction.SetComputeUnitLimit)
      limit = BigInt(getSetComputeUnitLimitInstructionDataDecoder().decode(bytes).units);
    else if (kind === ComputeBudgetInstruction.SetComputeUnitPrice)
      price = getSetComputeUnitPriceInstructionDataDecoder().decode(bytes).microLamports;
  }
  if (price == null) return null;
  const lim = limit ?? 200_000n; // default per-instruction CU limit if unset
  return Number((price * lim) / 1_000_000n);
}
