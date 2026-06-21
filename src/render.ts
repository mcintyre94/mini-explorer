import type { TransactionResult, ParsedInstruction, TokenBalance } from './rpc.ts';
import { programLabel, isNative } from './programs.ts';
import type { TokenInfo } from './jupiter.ts';
import { decodeComputeBudget, priorityFeeLamports } from './decode.ts';
import { html, raw, toHtml, marker, range, patch, join, type Html } from './html.ts';

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const lamportsToSol = (l: number) => (l / 1e9).toFixed(9).replace(/\.?0+$/, '');
const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
const usd = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Prices can be sub-cent; show enough significant figures for tiny ones.
const usdPrice = (n: number) =>
  n >= 0.01 ? usd(n) : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 8, minimumFractionDigits: 2 });

// ---- Token cells (enrichment wave) ----------------------------------------
// Resolved: symbol/icon (+ usdPrice and USD value of a delta unless compact).
// Compact mode is for inline mint references in instructions — just identify
// the token (icon + symbol), no price/value clutter.
export function tokenCell(info: TokenInfo, uiDelta?: number, compact = false): Html {
  const iconChar = (info.symbol ?? '?')[0] ?? '?';
  const icon = info.icon
    ? html`<img class="token-img" src="${info.icon}" alt="" width="18" height="18" loading="lazy">`
    : html`<span class="token-icon" aria-hidden="true">${iconChar}</span>`;
  const verified = info.isVerified ? html`<span class="token-verified" title="Verified">✓</span>` : '';
  const symbol = info.symbol ?? '?';
  // icon + symbol link to the mint's account page (info.id is the mint).
  const head = html`<a class="token-id" href="/account/${info.id}" title="${info.id}">${icon}<strong>${symbol}</strong></a>`;
  if (compact) return html`<span class="token resolved">${head}${verified}</span>`;
  const price = info.usdPrice != null ? html`<span class="usd">@ ${usdPrice(info.usdPrice)}</span>` : '';
  const value = uiDelta != null && info.usdPrice != null ? html`<span class="usd">${usd(uiDelta * info.usdPrice)}</span>` : '';
  return html`<span class="token resolved">${head}${verified}${price}${value}</span>`;
}

// Terminal failure state: mint not indexed by Jupiter.
export function unindexedCell(mint: string): Html {
  return html`<span class="token unindexed" title="Not indexed by Jupiter">
    <span class="token-icon muted" aria-hidden="true">?</span>
    <span class="mono">${addrLink(mint)}</span>
    <span class="muted">unindexed</span>
  </span>`;
}

// programLabel ?? shortened id — the "labeled-but-undecoded" naming for MVP.
const labelFor = (programId: string) => programLabel(programId) ?? short(programId);

// Any base58 pubkey becomes a link to its account page — wired everywhere an
// address is shown so the explorer is navigable.
const isAddress = (v: string) => v.length >= 32 && v.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(v);

// Copy-to-clipboard button — handled by one delegated listener in client.js, so
// it works on streamed-in content with no per-element wiring. Static SVG markup.
const COPY_ICON = raw(
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
);
export const copyBtn = (text: string): Html =>
  html`<button class="copy" type="button" data-copy="${text}" title="Copy" aria-label="Copy">${COPY_ICON}</button>`;

// Truncated address → link (full address on hover via title) + hover-reveal copy.
export const addrLink = (addr: string): Html =>
  html`<span class="addr-wrap"><a class="addr" href="/account/${addr}" title="${addr}">${short(addr)}</a>${copyBtn(addr)}</span>`;
// Only addresses get truncated; other values (enum names, amounts) show in full.
const maybeAddr = (v: string): Html => (isAddress(v) ? addrLink(v) : html`${v}`);
const progLink = (programId: string): Html => html`<a class="addr" href="/account/${programId}" title="${programId}">${labelFor(programId)}</a>`;

// ---- Instruction row (wave 1 structure) -----------------------------------
const kv = (k: string, v: string): Html =>
  html`<span class="kv"><span class="k">${k}</span> <span class="mono">${maybeAddr(v)}</span></span>`;

// Allocates a marker for a referenced mint so the search wave can fill it.
type AllocMint = (mint: string) => string;
// pubkey → its mint + decimals, derived from meta.pre/postTokenBalances. Lets us
// give plain `transfer` (raw amount, no mint/decimals) a human amount + token —
// for free, no extra RPC (the swap legs' accounts are all in token balances).
type AcctMint = Map<string, { mint: string; decimals: number }>;
type Ctx = { alloc: AllocMint; acct: AcctMint };

// spl-token transfer / transferChecked → human amount + mint cell + flow.
function transferBody(type: string, info: Record<string, unknown>, ctx: Ctx): Html {
  let amount: Html = html``;
  let mint: string | undefined;
  const ta = info.tokenAmount as { uiAmountString?: string; uiAmount?: number } | undefined;
  if (ta && typeof ta === 'object') {
    amount = html`<strong>${ta.uiAmountString ?? String(ta.uiAmount ?? '?')}</strong>`;
    if (typeof info.mint === 'string') mint = info.mint;
  } else if (info.amount != null) {
    const tk = ctx.acct.get(String(info.source ?? '')) ?? ctx.acct.get(String(info.destination ?? ''));
    if (tk) {
      amount = html`<strong>${num(Number(info.amount) / 10 ** tk.decimals)}</strong>`;
      mint = tk.mint;
    } else {
      amount = html`<span class="kv"><span class="k">amount</span> <span class="mono">${String(info.amount)}</span></span>`;
    }
  }
  const mintPart = mint && isAddress(mint) ? html` ${range(ctx.alloc(mint), short(mint))}` : '';
  const flow = info.source && info.destination
    ? html` <span class="muted">${maybeAddr(String(info.source))} → ${maybeAddr(String(info.destination))}</span>`
    : '';
  return html`<span class="action">${type}</span> ${amount}${mintPart}${flow}`;
}

// Decode an instruction's body. jsonParsed already decodes native programs
// server-side; ComputeBudget we decode ourselves; everything else stays raw.
// Same path for top-level and inner (CPI) instructions. `mint` fields become
// token-cell markers resolved by the same batched search wave.
function ixBody(ix: ParsedInstruction, ctx: Ctx): Html {
  const cb = decodeComputeBudget(ix);
  if (ix.parsed?.type) {
    const type = ix.parsed.type;
    const info = ix.parsed.info ?? {};
    if (type === 'transfer' || type === 'transferChecked') return transferBody(type, info, ctx);
    const fields = Object.entries(info).slice(0, 4).map(([k, v]) => {
      const s = String(v);
      if (k === 'mint' && isAddress(s)) {
        return html`<span class="kv"><span class="k">mint</span> <span class="tok-cell">${range(ctx.alloc(s), short(s))}</span></span>`;
      }
      return kv(k, s);
    });
    return html`<span class="action">${type}</span> ${join(fields, ' ')}`;
  }
  if (cb) return html`<span class="action">${cb.action}</span> ${join(cb.args.map(([k, v]) => kv(k, v)), ' ')}`;
  const accts = ix.accounts?.length ?? 0;
  return html`<span class="muted">raw · ${accts} accounts · data ${String(ix.data?.length ?? 0)} chars</span>`;
}

// One CPI row, indented by call depth (stackHeight 2 = first level of nesting).
function innerRow(ix: ParsedInstruction, ctx: Ctx): Html {
  const native = isNative(ix.programId);
  const depth = Math.max(0, (ix.stackHeight ?? 2) - 2);
  return html`<li class="cpi" style="margin-left:${depth * 18}px">
    <span class="program">${progLink(ix.programId)}</span>
    ${native ? '' : html`<span class="tag">not decoded</span>`}
    <span class="cpi-body">${ixBody(ix, ctx)}</span>
  </li>`;
}

function ixRow(ix: ParsedInstruction, i: number, inner: ParsedInstruction[], ctx: Ctx): Html {
  const native = isNative(ix.programId);
  const tag = native ? '' : html`<span class="tag">not decoded</span>`;
  // CPIs reveal the real movements even when the outer program isn't decoded.
  const cpis = inner.length
    ? html`<details class="cpis" open><summary>${inner.length} inner instruction${inner.length > 1 ? 's' : ''} (CPIs)</summary>
        <ul class="cpi-tree">${inner.map((x) => innerRow(x, ctx))}</ul></details>`
    : '';

  return html`
    <li class="ix" data-ix="${i}">
      <div class="ix-head">
        <span class="ix-num">#${i}</span>
        <span class="program">${progLink(ix.programId)}</span>
        <span class="mono pid">${addrLink(ix.programId)}</span>
        ${tag}
      </div>
      <div class="ix-body">${ixBody(ix, ctx)}</div>
      ${cpis}
    </li>`;
}

// Returns the skeleton HTML plus the mint cells its instruction rows reference,
// so the server can resolve them in the same batched search wave.
export function txSkeleton(sig: string, tx: TransactionResult): { html: string; mintRefs: TokenCellRef[] } {
  const m = tx.transaction.message;
  const meta = tx.meta;
  const ok = meta.err == null;
  const prio = priorityFeeLamports(tx);
  const when = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';

  // Each referenced mint gets a unique marker → resolved by the search wave.
  const mintRefs: TokenCellRef[] = [];
  const allocMint: AllocMint = (mint) => {
    const name = `tok-ix-${mintRefs.length}`;
    mintRefs.push({ name, mint, compact: true });
    return name;
  };

  // pubkey → {mint, decimals} from meta token balances (for transfer amounts).
  const acctMint: AcctMint = new Map();
  for (const b of [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])]) {
    const pk = m.accountKeys[b.accountIndex]?.pubkey;
    if (pk) acctMint.set(pk, { mint: b.mint, decimals: b.uiTokenAmount.decimals });
  }
  const ctx: Ctx = { alloc: allocMint, acct: acctMint };

  // index → inner (CPI) instructions, from meta.innerInstructions.
  const innerByIndex = new Map<number, ParsedInstruction[]>();
  for (const g of meta.innerInstructions ?? []) innerByIndex.set(g.index, g.instructions);

  const accounts = m.accountKeys.map((a, i) => {
    const badges = [
      a.signer ? html`<span class="b sign">signer</span>` : '',
      a.writable ? html`<span class="b write">writable</span>` : html`<span class="b ro">readonly</span>`,
      a.source === 'lookupTable' ? html`<span class="b alt">ALT</span>` : '',
    ];
    return html`<li><span class="ix-num">${i}</span> <span class="mono">${addrLink(a.pubkey)}</span> ${badges}</li>`;
  });

  // Built inside the template; allocMint populates mintRefs during evaluation.
  const out = html`
<section class="tx">
  <div class="page-head">
    <span class="badge ${ok ? 'ok' : 'fail'}">${ok ? 'Success' : 'Failed'}</span>
    <h2>Transaction</h2>
    <div class="mono sig">${sig} ${copyBtn(sig)}</div>
  </div>

  <dl class="meta">
    <div><dt>Slot</dt><dd class="mono">${tx.slot.toLocaleString()}</dd></div>
    <div><dt>Block time</dt><dd>${when}</dd></div>
    <div><dt>Fee payer</dt><dd class="mono">${m.accountKeys[0] ? addrLink(m.accountKeys[0].pubkey) : '—'}</dd></div>
    <div><dt>Fee</dt><dd class="mono">${lamportsToSol(meta.fee)} SOL</dd></div>
    <div><dt>Priority fee</dt><dd class="mono">${prio == null ? '—' : lamportsToSol(prio) + ' SOL'}</dd></div>
    <div><dt>Compute units</dt><dd class="mono">${(meta.computeUnitsConsumed ?? 0).toLocaleString()} CU</dd></div>
    <div><dt>Version</dt><dd class="mono">${String(tx.version)}</dd></div>
  </dl>

  <h3>Balance changes</h3>
  <div class="balances">${range('balances', 'diffing pre/post balances…')}</div>

  <h3>Instructions <span class="muted">(${m.instructions.length})</span></h3>
  <ol class="ixs">
    ${m.instructions.map((ix, i) => ixRow(ix, i, innerByIndex.get(i) ?? [], ctx))}
    ${marker('ixs')}
  </ol>

  <h3>Accounts <span class="muted">(${m.accountKeys.length})</span></h3>
  <ul class="accounts">${accounts}</ul>
</section>`;
  return { html: toHtml(out), mintRefs };
}

// A cell holding a mint, filled by the search wave. `uiDelta` (balance rows)
// adds a USD value; `compact` (instruction mint refs) shows just icon+symbol.
export type TokenCellRef = { name: string; mint: string; uiDelta?: number; compact?: boolean };

// Collect non-zero token deltas, each assigned a unique marker name. A mint can
// appear in several rows → several distinct markers (the mint → [cells] map).
export function tokenChanges(tx: TransactionResult): TokenCellRef[] {
  const meta = tx.meta;
  const pre = new Map<string, TokenBalance>();
  for (const b of meta.preTokenBalances ?? []) pre.set(`${b.accountIndex}:${b.mint}`, b);
  const seen = new Set<string>();
  const refs: TokenCellRef[] = [];
  const consider = (b: TokenBalance) => {
    const k = `${b.accountIndex}:${b.mint}`;
    if (seen.has(k)) return;
    seen.add(k);
    const before = pre.get(k)?.uiTokenAmount.uiAmount ?? 0;
    const after = meta.postTokenBalances?.find((x) => `${x.accountIndex}:${x.mint}` === k)?.uiTokenAmount.uiAmount ?? 0;
    const d = (after ?? 0) - (before ?? 0);
    if (d === 0) return;
    refs.push({ name: `tok-bal-${refs.length}`, mint: b.mint, uiDelta: d });
  };
  (meta.preTokenBalances ?? []).forEach(consider);
  (meta.postTokenBalances ?? []).forEach(consider);
  return refs;
}

// ---- Balance-change diff. Token rows carry markers the search wave fills. ----
export function balancesPatch(tx: TransactionResult, refs: TokenCellRef[]): string {
  const m = tx.transaction.message;
  const meta = tx.meta;

  const solRows: Html[] = [];
  for (let i = 0; i < meta.preBalances.length; i++) {
    const d = (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0);
    if (d === 0) continue;
    const key = m.accountKeys[i]?.pubkey ?? `#${i}`;
    solRows.push(html`<tr><td class="mono">${maybeAddr(key)}</td>
      <td class="${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${lamportsToSol(d)} SOL</td></tr>`);
  }

  // Owner lookup, parallel to refs (tokenChanges walks pre then post balances).
  const ordered = [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])];
  const used = new Set<number>();
  const ownerFor = (mint: string) => {
    for (let i = 0; i < ordered.length; i++) {
      if (!used.has(i) && ordered[i]!.mint === mint) { used.add(i); return ordered[i]!.owner ?? '—'; }
    }
    return '—';
  };
  const tokRows = refs.map((r) => {
    const owner = ownerFor(r.mint);
    const d = r.uiDelta ?? 0;
    return html`<tr>
      <td class="mono">${maybeAddr(owner)}</td>
      <td class="${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${num(d)}</td>
      <td class="tok-cell">${range(r.name, 'resolving…')}</td>
    </tr>`;
  });

  const solTable = solRows.length ? html`<table class="bal"><caption>SOL</caption>${solRows}</table>` : '';
  const tokTable = tokRows.length ? html`<table class="bal"><caption>Tokens</caption>${tokRows}</table>` : '';
  const inner = solRows.length || tokRows.length
    ? html`${solTable}${tokTable}`
    : html`<p class="muted">No balance changes.</p>`;
  return toHtml(patch('balances', inner));
}

// One patch per token cell: resolved cell, or the unindexed failure state.
export function tokenCellPatch(ref: TokenCellRef, info: TokenInfo | undefined): string {
  const cell = info ? tokenCell(info, ref.uiDelta, ref.compact) : unindexedCell(ref.mint);
  return toHtml(patch(ref.name, cell));
}
