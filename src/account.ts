import type { AccountValue, SignatureInfo } from './rpc.ts';
import type { TokenInfo, Holdings } from './jupiter.ts';
import { short, tokenCell, unindexedCell, addrLink, copyBtn } from './render.ts';
import { html, toHtml, raw, range, patch, type Html } from './html.ts';
import { programLabel } from './programs.ts';

const SYSTEM = '11111111111111111111111111111111';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

const sol = (lamports: number) => (lamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 });
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type Route = 'wallet' | 'mint' | 'token-account' | 'program' | 'program-data' | 'other';

export function routeAccount(v: AccountValue): Route {
  if (v.executable) return 'program';
  const d = v.data;
  if (!Array.isArray(d) && d.parsed) {
    if (d.parsed.type === 'mint') return 'mint';
    if (d.parsed.type === 'account') return 'token-account';
    if (d.parsed.type === 'programData') return 'program-data';
  }
  if (v.owner === SYSTEM) return 'wallet';
  return 'other';
}

export const ROUTE_LABEL: Record<Route, string> = {
  wallet: 'Wallet',
  mint: 'Mint',
  'token-account': 'Token Account',
  program: 'Program',
  'program-data': 'Program Data',
  other: 'Account',
};

const parsedInfo = (v: AccountValue): Record<string, unknown> =>
  !Array.isArray(v.data) && v.data.parsed?.info ? v.data.parsed.info : {};

const dataSize = (v: AccountValue): number =>
  Array.isArray(v.data) ? Math.ceil((v.data[0].length * 3) / 4) : (v.data.space ?? v.space ?? 0);

const none = html`<span class="muted">none</span>`;

// ---- Wave 1 skeleton (route-specific markers) ------------------------------
export function accountSkeleton(addr: string, v: AccountValue, route: Route): string {
  const info = parsedInfo(v);
  const head = html`
  <div class="page-head">
    <span class="badge ok">${ROUTE_LABEL[route]}</span>
    <h2>Account</h2>
    <div class="mono sig">${addr} ${copyBtn(addr)}</div>
  </div>`;

  // For a wallet, lamports IS the SOL balance (show USD); for other accounts it's
  // rent-holding lamports, so keep the literal "Lamports" label and no USD.
  const solField = route === 'wallet'
    ? html`<div><dt>SOL balance</dt><dd class="mono">${sol(v.lamports)} SOL <span class="usd">${range('sol-usd', '…')}</span></dd></div>`
    : html`<div><dt>Lamports</dt><dd class="mono">${sol(v.lamports)} SOL</dd></div>`;
  const portfolio = route === 'wallet'
    ? html`<div><dt>Portfolio (USD)</dt><dd class="mono">${range('usd-total', 'summing…')}</dd></div>`
    : '';

  const base = html`
  <dl class="meta">
    <div><dt>Owner</dt><dd class="mono"><a class="addr" href="/account/${v.owner}" title="${v.owner}">${programLabel(v.owner) ?? short(v.owner)}</a></dd></div>
    ${solField}
    ${portfolio}
    <div><dt>Executable</dt><dd class="mono">${v.executable ? 'yes' : 'no'}</dd></div>
    <div><dt>Data size</dt><dd class="mono">${dataSize(v).toLocaleString()} bytes</dd></div>
  </dl>`;

  let body: Html;
  if (route === 'wallet') {
    body = html`
    <h3>Token holdings</h3>
    <ul class="holdings">${range('holdings', 'loading holdings…')}</ul>`;
  } else if (route === 'mint') {
    const supply = Number(info.supply ?? 0) / 10 ** Number(info.decimals ?? 0);
    body = html`
    <dl class="meta">
      <div><dt>Decimals</dt><dd class="mono">${String(info.decimals ?? '—')}</dd></div>
      <div><dt>On-chain supply</dt><dd class="mono">${supply.toLocaleString('en-US')}</dd></div>
      <div><dt>Mint authority</dt><dd class="mono">${info.mintAuthority ? addrLink(String(info.mintAuthority)) : none}</dd></div>
      <div><dt>Freeze authority</dt><dd class="mono">${info.freezeAuthority ? addrLink(String(info.freezeAuthority)) : none}</dd></div>
    </dl>
    <h3>Market &amp; metadata <span class="muted">(Jupiter)</span></h3>
    <div class="mint-meta">${range('mint-meta', 'resolving market data…')}</div>`;
  } else if (route === 'token-account') {
    const amt = (info.tokenAmount ?? {}) as Record<string, unknown>;
    body = html`
    <dl class="meta">
      <div><dt>Mint</dt><dd class="mono">${info.mint ? addrLink(String(info.mint)) : '—'}</dd></div>
      <div><dt>Owner</dt><dd class="mono">${info.owner ? addrLink(String(info.owner)) : '—'}</dd></div>
      <div><dt>Amount</dt><dd class="mono">${String(amt.uiAmountString ?? amt.uiAmount ?? '—')}</dd></div>
      <div><dt>State</dt><dd class="mono">${String(info.state ?? '—')}</dd></div>
    </dl>
    <h3>Token</h3>
    <div class="ta-token">${range('ta-token', 'resolving token…')}</div>`;
  } else if (route === 'program') {
    body = html`
    <dl class="meta">
      <div><dt>Label</dt><dd>${programLabel(addr) ?? 'Unknown program'}</dd></div>
      <div><dt>Program data</dt><dd class="mono">${info.programData ? addrLink(String(info.programData)) : '—'}</dd></div>
    </dl>`;
  } else if (route === 'program-data') {
    body = html`
    <dl class="meta">
      <div><dt>Upgrade authority</dt><dd class="mono">${info.authority ? addrLink(String(info.authority)) : none}</dd></div>
      <div><dt>Last deployed slot</dt><dd class="mono">${info.slot != null ? Number(info.slot).toLocaleString() : '—'}</dd></div>
    </dl>
    <p class="muted">Holds the deployed bytecode for an upgradeable program.</p>`;
  } else {
    body = html`<p class="muted">Unrecognized account layout — owner ${addrLink(v.owner)}, ${dataSize(v).toLocaleString()} bytes of data. Best-effort raw view.</p>`;
  }

  // Recent transactions — universal (getSignaturesForAddress works on any
  // address). The note is route-aware where the result needs a caveat.
  const note = route === 'mint' ? html`<span class="muted">(referencing this mint — not all transfers)</span>`
    : route === 'program' ? html`<span class="muted">(recent invocations)</span>`
    : '';
  const history = html`
  <h3>Recent transactions ${note}</h3>
  <ul class="history">${range('history', 'loading…')}</ul>`;

  return toHtml(html`<section class="account">${head}${base}${body}${history}</section>`);
}

// Account doesn't currently exist (never created, or closed) — but it may still
// have transaction history referencing it, which we can show.
export function notFoundSkeleton(addr: string): string {
  return toHtml(html`<section class="account">
    <div class="page-head">
      <span class="badge">Not found</span>
      <h2>Account</h2>
      <div class="mono sig">${addr} ${copyBtn(addr)}</div>
    </div>
    <p class="muted">This account doesn't currently exist on-chain — it was never created, or it was closed (e.g. a temporary token account). Its transaction history is still available below.</p>
    <h3>Recent transactions</h3>
    <ul class="history">${range('history', 'loading history…')}</ul>
  </section>`);
}

// ---- Wallet holdings: rows + the mints to resolve --------------------------
export type HoldingRow = { name: string; mint: string; uiAmount: number; account: string; frozen: boolean; ata: boolean; token2022: boolean };

export function holdingRows(h: Holdings): HoldingRow[] {
  const rows: HoldingRow[] = [];
  for (const [mint, accounts] of Object.entries(h.tokens ?? {})) {
    for (const a of accounts) {
      rows.push({
        name: `tok-h-${rows.length}`,
        mint,
        uiAmount: a.uiAmount ?? 0,
        account: a.account,
        frozen: !!a.isFrozen,
        ata: !!a.isAssociatedTokenAccount,
        token2022: a.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      });
    }
  }
  return rows;
}

// Filter dust (zero balance), enrich with price, sort by USD value desc, then
// show the top N inline and collapse the rest into a <details> — pure HTML, no
// client JS. Unpriced / unindexed tokens have value 0 and sink into the tail.
// Rendered after the search wave (sort needs prices), so cells are inline.
export function holdingsPatch(rows: HoldingRow[], info: Map<string, TokenInfo>, topN = 8): string {
  const enriched = rows
    .filter((r) => r.uiAmount > 0)
    .map((r) => {
      const tok = info.get(r.mint);
      return { row: r, tok, value: r.uiAmount * (tok?.usdPrice ?? 0) };
    })
    .sort((a, b) => {
      // All Jupiter-indexed tokens first (by USD value), then unindexed together.
      if (!!a.tok !== !!b.tok) return a.tok ? -1 : 1;
      return b.value - a.value;
    });

  if (!enriched.length) return toHtml(patch('holdings', html`<li class="muted">No token holdings.</li>`));

  const li = ({ row, tok }: (typeof enriched)[number]) => {
    const badges = [
      row.ata ? '' : html`<span class="b alt">non-ATA</span>`,
      row.frozen ? html`<span class="b" style="color:#ff6b6b">frozen</span>` : '',
      row.token2022 ? html`<span class="b alt">Token-2022</span>` : '',
    ];
    return html`<li>
      <span class="amount">${row.uiAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
      <span class="hold-tok">${tok ? tokenCell(tok, row.uiAmount) : unindexedCell(row.mint)}</span>
      ${badges}
    </li>`;
  };

  const top = enriched.slice(0, topN).map(li);
  const rest = enriched.slice(topN);
  const more = rest.length
    ? html`<li class="more"><details><summary>Show ${rest.length} more (dust &amp; unlisted)</summary>
        <ul class="holdings">${rest.map(li)}</ul></details></li>`
    : '';
  return toHtml(patch('holdings', html`${top}${more}`));
}

export function solUsdPatch(nativeSol: number, solInfo: TokenInfo | undefined): string {
  const body = solInfo?.usdPrice ? html`${usd(nativeSol * solInfo.usdPrice)}` : raw('');
  return toHtml(patch('sol-usd', body));
}

export function usdTotalPatch(nativeSol: number, rows: HoldingRow[], info: Map<string, TokenInfo>): string {
  const solPrice = info.get(SOL_MINT)?.usdPrice ?? 0;
  let total = nativeSol * solPrice;
  for (const r of rows) total += r.uiAmount * (info.get(r.mint)?.usdPrice ?? 0);
  return toHtml(patch('usd-total', html`${usd(total)}`));
}

export function historyPatch(sigs: SignatureInfo[]): string {
  if (!sigs.length) return toHtml(patch('history', html`<li class="muted">No recent transactions.</li>`));
  const items = sigs.map((s) => {
    const when = s.blockTime ? new Date(s.blockTime * 1000).toISOString().slice(0, 19).replace('T', ' ') : '—';
    const status = s.err ? html`<span class="b" style="color:#ff6b6b">failed</span>` : '';
    return html`<li>
      <span class="addr-wrap"><a class="mono addr" href="/tx/${s.signature}" title="${s.signature}">${short(s.signature)}</a>${copyBtn(s.signature)}</span>
      <span class="muted">slot ${s.slot.toLocaleString()}</span>
      <span class="muted">${when}</span> ${status}
    </li>`;
  });
  return toHtml(patch('history', html`${items}`));
}

// ---- Mint metadata cell (rich Jupiter data) --------------------------------
export function mintMetaPatch(mint: string, info: TokenInfo | undefined): string {
  if (!info) return toHtml(patch('mint-meta', unindexedCell(mint)));
  const a = info.audit ?? {};
  const stat = (label: string, value: string): Html => html`<div><dt>${label}</dt><dd class="mono">${value}</dd></div>`;
  const fmt = (n?: number) => (n == null ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const verified = info.isVerified ? html`<span class="b sign">verified</span>` : '';
  const tags = (info.tags ?? []).map((t) => html`<span class="b">${t}</span>`);
  const body = html`
    <div class="mint-head">${tokenCell(info)} ${verified} ${tags}</div>
    <dl class="meta">
      ${stat('Price', info.usdPrice != null ? '$' + info.usdPrice.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—')}
      ${stat('Holders', info.holderCount != null ? info.holderCount.toLocaleString() : '—')}
      ${stat('Market cap', fmt(info.mcap))}
      ${stat('FDV', fmt(info.fdv))}
      ${stat('Liquidity', fmt(info.liquidity))}
      ${stat('Mint auth', a.mintAuthorityDisabled ? 'disabled ✓' : 'enabled')}
      ${stat('Freeze auth', a.freezeAuthorityDisabled ? 'disabled ✓' : 'enabled')}
      ${stat('Top holders', a.topHoldersPercentage != null ? a.topHoldersPercentage.toFixed(1) + '%' : '—')}
    </dl>`;
  return toHtml(patch('mint-meta', body));
}

export function taTokenPatch(mint: string, info: TokenInfo | undefined): string {
  const cell = info ? tokenCell(info) : unindexedCell(mint);
  return toHtml(patch('ta-token', cell));
}
