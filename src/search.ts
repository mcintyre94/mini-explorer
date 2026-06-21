import { getBase58Encoder } from '@solana/kit';
import type { AccountValue, TransactionResult } from './rpc.ts';
import type { TokenInfo } from './jupiter.ts';
import { html, toHtml } from './html.ts';
import { short, tokenResultRow } from './render.ts';
import { routeAccount, ROUTE_LABEL } from './account.ts';

const b58 = getBase58Encoder();
export type SearchKind = 'account' | 'tx' | 'text';

// Classify by base58 byte length, not char count: a pubkey decodes to 32 bytes,
// a transaction signature to 64. Anything that isn't base58 (or another length)
// is a free-text token query. Robust where char-length heuristics are fuzzy.
export function classifyQuery(q: string): SearchKind {
  const t = q.trim();
  if (t) {
    try {
      const n = (b58.encode(t) as Uint8Array).length;
      if (n === 32) return 'account';
      if (n === 64) return 'tx';
    } catch {
      /* invalid base58 → text */
    }
  }
  return 'text';
}

// ---- Result cards (each a single anchor → links to the full page) ----------
export function accountCard(addr: string, value: AccountValue | null): string {
  if (!value)
    return toHtml(html`<a class="search-result" href="/account/${addr}"><span class="badge">Account</span> <span class="mono">${short(addr)}</span> <span class="muted">not found — history available</span></a>`);
  return toHtml(html`<a class="search-result" href="/account/${addr}"><span class="badge ok">${ROUTE_LABEL[routeAccount(value)]}</span> <span class="mono">${short(addr)}</span></a>`);
}

// An address result: if it's a Jupiter-indexed mint, show the rich token row
// (identical to a text search for its symbol); otherwise the account-type card.
export function accountResult(addr: string, value: AccountValue | null, token: TokenInfo | undefined): string {
  if (token) return toHtml(tokenResultRow(token));
  return accountCard(addr, value);
}

export function txCard(sig: string, tx: TransactionResult | null): string {
  if (!tx)
    return toHtml(html`<a class="search-result" href="/tx/${sig}"><span class="badge">Transaction</span> <span class="mono">${short(sig)}</span> <span class="muted">not found</span></a>`);
  const ok = tx.meta.err == null;
  return toHtml(html`<a class="search-result" href="/tx/${sig}"><span class="badge ${ok ? 'ok' : 'fail'}">${ok ? 'Success' : 'Failed'}</span> <span class="mono">${short(sig)}</span> <span class="muted">transaction</span></a>`);
}

export function textResults(tokens: TokenInfo[]): string {
  if (!tokens.length) return toHtml(html`<div class="search-empty muted">No tokens found.</div>`);
  return toHtml(html`${tokens.slice(0, 8).map(tokenResultRow)}`);
}
