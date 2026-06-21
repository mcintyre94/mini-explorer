import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import type { ServerResponse } from 'node:http';
import { getTransaction, getAccountInfo, getSignaturesForAddress } from './rpc.ts';
import { txSkeleton, balancesPatch, tokenChanges, tokenCellPatch } from './render.ts';
import { searchTokens, getHoldings, searchByText } from './jupiter.ts';
import { classifyQuery, accountResult, txCard, textResults } from './search.ts';
import { esc } from './html.ts';
import {
  routeAccount, accountSkeleton, notFoundSkeleton, holdingRows, holdingsPatch,
  solUsdPatch, usdTotalPatch, historyPatch, mintMetaPatch, taTokenPatch, SOL_MINT,
} from './account.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

// Demo knobs (?slow, ?nocache) are inert unless DEV_TOOLS is enabled, so they
// add no DoS/quota-abuse surface in a public deployment. `npm run dev` sets it.
const DEV_TOOLS = process.env.DEV_TOOLS === '1' || process.env.DEV_TOOLS === 'true';

// Debug/demo aid: ?slow=N adds N ms of latency to each EXTERNAL request (RPC,
// Jupiter) so the wave structure is watchable in DevTools — but each response's
// content still renders atomically when it returns (the batched token search
// fills all its cells together). 0 = real speed.
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const slowly = async <T>(ms: number, fn: () => Promise<T>): Promise<T> => {
  if (ms > 0) await sleep(ms);
  return fn();
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function openStream(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Content-Type-Options': 'nosniff',
    // No Content-Length => Node uses chunked transfer-encoding, so the browser
    // parses each write as it lands.
  });
}

// Friendly message from a raw RPC error (malformed input is the common case).
function cleanErr(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/invalid param/i.test(m)) return 'Invalid address or signature format.';
  return m.replace(/^RPC \w+: /, '');
}
function errorPage(res: ServerResponse, cls: string, html: string) {
  openStream(res);
  res.end(`<section class="${cls}"><p class="error">${html}</p></section>`);
}

// ----------------------------------------------------------------------------
// REAL TRANSACTION PAGE: getTransaction → skeleton + balance diff + token wave
// ----------------------------------------------------------------------------
async function streamTx(res: ServerResponse, sig: string, bypass = false, slow = 0) {
  let tx;
  try {
    tx = await slowly(slow, () => getTransaction(sig)); // wave 1: one RPC read
  } catch (err) {
    return errorPage(res, 'tx', esc(cleanErr(err)));
  }
  if (!tx) {
    return errorPage(res, 'tx', `Transaction not found: <span class="mono">${esc(sig)}</span>`);
  }

  openStream(res);
  // Wave 1: structure renders at once. The skeleton carries token markers for
  // every mint referenced by an instruction (and CPI).
  const { html, mintRefs } = txSkeleton(sig, tx);
  res.write(html);

  // Balance cell carries one token marker per row (the mint → [cells] map).
  const balRefs = tokenChanges(tx);
  if (res.writableEnded || res.destroyed) return;
  res.write('\n' + balancesPatch(tx, balRefs));

  // Wave 2: ONE batched search for ALL referenced mints (balances + instructions,
  // deduped by searchTokens); its cells all land together when the request
  // returns. The same mint fans out to every cell that holds it.
  const refs = [...balRefs, ...mintRefs];
  const info = await slowly(slow, () => searchTokens(refs.map((r) => r.mint), { bypass }));
  for (const ref of refs) {
    if (res.writableEnded || res.destroyed) return;
    res.write('\n' + tokenCellPatch(ref, info.get(ref.mint)));
  }
  res.end();
}

// ----------------------------------------------------------------------------
// REAL ACCOUNT PAGE (step 5: getAccountInfo route → per-route enrichment waves)
// ----------------------------------------------------------------------------
async function streamAccount(res: ServerResponse, addr: string, bypass = false, slow = 0) {
  let acct;
  try {
    acct = await slowly(slow, () => getAccountInfo(addr)); // wave 1 route read
  } catch (err) {
    return errorPage(res, 'account', esc(cleanErr(err)));
  }
  const v = acct?.value;
  if (!v) {
    // Account doesn't currently exist, but it may still have history to show.
    openStream(res);
    res.write(notFoundSkeleton(addr));
    const sigs = await slowly(slow, () => getSignaturesForAddress(addr, 10).catch(() => []));
    if (!res.writableEnded && !res.destroyed) res.write('\n' + historyPatch(sigs ?? []));
    return res.end();
  }

  const route = routeAccount(v);
  openStream(res);
  res.write(accountSkeleton(addr, v, route));
  const alive = () => !res.writableEnded && !res.destroyed;

  // Which enrichment patches fire depends on what wave 1 found.
  if (route === 'wallet') {
    // holdings + history are two parallel requests; both return (slowed) together.
    const [holdings, sigs] = await slowly(slow, () =>
      Promise.all([getHoldings(addr), getSignaturesForAddress(addr, 10)]),
    );
    if (alive()) res.write('\n' + historyPatch(sigs ?? [])); // history streams first
    const rows = holdings ? holdingRows(holdings) : [];
    const nativeSol = v.lamports / 1e9;
    // Holdings render AFTER the search so they can be sorted by USD value.
    const info = await slowly(slow, () => searchTokens([SOL_MINT, ...rows.map((r) => r.mint)], { bypass }));
    if (alive()) res.write('\n' + holdingsPatch(rows, info));
    if (alive()) res.write('\n' + solUsdPatch(nativeSol, info.get(SOL_MINT)));
    if (alive()) res.write('\n' + usdTotalPatch(nativeSol, rows, info));
  } else if (route === 'mint') {
    const info = await slowly(slow, () => searchTokens([addr], { bypass }));
    if (alive()) res.write('\n' + mintMetaPatch(addr, info.get(addr)));
  } else if (route === 'token-account') {
    const mint = String((!Array.isArray(v.data) && v.data.parsed?.info?.mint) || '');
    const info = await slowly(slow, () => searchTokens(mint ? [mint] : [], { bypass }));
    if (alive()) res.write('\n' + taTokenPatch(mint, info.get(mint)));
  }
  // program / other: nothing async in MVP.
  res.end();
}

// ----------------------------------------------------------------------------
// SEARCH (typeahead) — same streaming model, piped into a dropdown client-side.
// Classify the query server-side, fan out to the right source, stream a result.
// ----------------------------------------------------------------------------
async function streamSearch(res: ServerResponse, q: string) {
  openStream(res);
  try {
    const kind = classifyQuery(q);
    if (kind === 'account') {
      // In parallel: the account type, and whether it's a Jupiter-indexed mint.
      const [acct, tokens] = await Promise.all([
        getAccountInfo(q).catch(() => null),
        searchTokens([q]).catch(() => new Map()),
      ]);
      res.end(accountResult(q, acct?.value ?? null, tokens.get(q)));
    } else if (kind === 'tx') {
      const tx = await getTransaction(q).catch(() => null);
      res.end(txCard(q, tx));
    } else {
      res.end(textResults(await searchByText(q)));
    }
  } catch {
    res.end('<div class="search-empty muted">Search failed.</div>');
  }
}

// ----------------------------------------------------------------------------
// Static files + routing
// ----------------------------------------------------------------------------
async function serveStatic(res: ServerResponse, file: string) {
  try {
    const body = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === '/') return serveStatic(res, 'index.html');
  if (path === '/client.js') return serveStatic(res, 'client.js');
  if (path === '/styles.css') return serveStatic(res, 'styles.css');
  if (path === '/search/stream') return streamSearch(res, url.searchParams.get('q') ?? '');

  // Gated: ignored entirely unless DEV_TOOLS is on.
  const bypass = DEV_TOOLS && url.searchParams.has('nocache');
  const slow = DEV_TOOLS ? Math.min(3000, Math.max(0, Number(url.searchParams.get('slow')) || 0)) : 0;

  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/tx\/([^/]+)\/stream$/))) {
    return streamTx(res, decodeURIComponent(m[1]!), bypass, slow);
  }
  if ((m = path.match(/^\/account\/([^/]+)\/stream$/))) {
    return streamAccount(res, decodeURIComponent(m[1]!), bypass, slow);
  }

  if (/^\/(tx|account)\/[^/]+$/.test(path)) return serveStatic(res, 'index.html');

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => {
  console.log(`Solana Stream Explorer (MVP: tx + account, real data) → http://localhost:${PORT}`);
  console.log(`  dev tools (?slow, ?nocache): ${DEV_TOOLS ? 'ENABLED' : 'disabled (set DEV_TOOLS=1 to enable)'}`);
});
