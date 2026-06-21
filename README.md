# Mini Explorer

A Solana block explorer — transactions, accounts, tokens — with a **near-empty
client**. The server fans out to every data source, decodes everything, and
streams *finished HTML cells* out of order; the browser does nothing but pipe
them into place. No client-side routing, rendering, or decode logic.

It works by leaning on Chrome's experimental **declarative partial updates**
(out-of-order HTML streaming): each page renders its structural skeleton from one
fast RPC read, then progressively fills in slower detail — token metadata,
balances, market data, instruction decodes — each landing in its own marker as it
resolves.

## What it does

- **Transaction pages** — status, fee, derived priority fee, compute units, the
  account list, decoded instructions (native programs via `@solana-program` +
  RPC `jsonParsed`; non-native labeled), the CPI tree, a balance-change ledger,
  and token cells with live USD prices.
- **Account pages** — routed by type: wallet (holdings, portfolio USD, history),
  mint (on-chain layout + Jupiter market data), token account, program,
  program-data, or raw. Recent transactions on every type.
- **Typeahead search** — token name/symbol, or paste an address / signature.
- **Home** — trending tokens (24h volume + price change).
- Everywhere a mint or address appears it links through and is copyable, and
  amounts are formatted adaptively (compact for the huge, full precision for the
  tiny).

## Requirements

- **Chrome 148+** with `chrome://flags/#enable-experimental-web-platform-features`
  enabled (the experimental `streamAppendHTMLUnsafe` API). Other browsers see a
  banner — there is **no polyfill** by design (it would buffer and defeat the
  streaming).
- **Node 24+** — runs TypeScript directly via type-stripping, no build step.
- A `.env` (see `.env.copy`) with `RPC_URL` (Solana JSON-RPC) and
  `JUPITER_API_KEY`. Account history uses an extended `getTransactionsForAddress`
  RPC method (full transactions + token-transfer detection in one call) where the
  provider supports it (e.g. Helius), and falls back to the standard
  `getSignaturesForAddress` (signatures only) otherwise.

## Run

```bash
npm install
cp .env.copy .env   # then fill in RPC_URL and JUPITER_API_KEY
npm run dev         # or: npm start  (no dev knobs — see below)
# → http://localhost:3000
```

Open the root in a flag-enabled Chrome.

## How it works

```
Browser ──GET /tx/{sig}/stream──▶  Server (per-request orchestrator)
   │                                  ├─ RPC getTransaction (wave 1, fast)
   │   chunked text/html              ├─ decode: @solana-program + jsonParsed
   ◀────── <template for> cells ──────┤─ Jupiter /tokens/v2/search (token cells)
        (out of order, as resolved)   └─ each patches its marker
```

- **Wave 1 (structure)** — one fast RPC read renders the whole skeleton. Every
  slower detail is a `<?start name>…<?end>` range or a `<?marker name>`.
- **Wave 2+ (enrichment)** — slower sources patch their markers with finished
  HTML, landing in completion order. A patch can carry its own markers, so
  dependent data nests.
- **Ordering invariant** — a `<template for>` only applies if its target marker
  already exists when parsed; otherwise it's dropped. So every structural row is
  flushed before its enrichment patches.
- **Escaping** — the stream runs with the sanitizer off (that's what "Unsafe"
  means, so the `<template>`/`<?marker>` machinery survives), so every
  chain-derived value is HTML-escaped server-side via a small `html` tagged
  template (escape-by-default). `runScripts` stays `false`.

The client is genuinely one line of work — `response.body.pipeTo(root.streamAppendHTMLUnsafe())` — plus a little cosmetic JS (copy buttons, the search dropdown).

## Endpoints

- `GET /` — the canvas; the client streams `/home/stream` into it.
- `GET /home/stream` — hero + trending tokens.
- `GET /tx/{sig}/stream` — transaction stream.
- `GET /account/{addr}/stream` — account stream (route decided by `getAccountInfo`).
- `GET /search/stream?q=` — typeahead results, classified server-side by base58
  byte length (32 = account, 64 = signature, else a free-text token search),
  streamed into the dropdown via the **replace** variant (`streamHTMLUnsafe`).

All streams are long-lived chunked `text/html` (not SSE — SSE framing would land
as literal text in the DOM).

### Dev knobs

`?slow=N` (adds N ms latency per external request) and `?nocache=1` (bypass the
token cache for a cold load) are **inert unless `DEV_TOOLS=1`** — set by
`npm run dev`, not `npm start` — so they add no abuse surface in production.

## Layout

| File | Role |
|---|---|
| `src/server.ts` | HTTP server, routing, per-request stream orchestration |
| `src/html.ts` | `html` tagged template (escape-by-default) + marker/range/patch helpers |
| `src/rpc.ts` | RPC client (`@solana/kit`) + extended `getTransactionsForAddress` (with fallback) |
| `src/jupiter.ts` | Jupiter client (token search, holdings, trending) + token cache |
| `src/decode.ts` | Native instruction decode (`@solana-program/compute-budget`) + priority fee |
| `src/programs.ts` | Curated programId → label dictionary + native set |
| `src/render.ts` | Token cells, tx skeleton, balance ledger, address links, amount formatting |
| `src/account.ts` | Account routing + per-route skeletons & enrichment patches |
| `src/home.ts` | Home page (trending tokens) |
| `src/search.ts` | Query classification + result cards |
| `public/` | Canvas (`index.html`), the single-pipe client (`client.js`), styles |

## Limitations & non-goals

- **Read-only.** No writes, signing, or auth.
- **Chrome-only**, by design (the experimental streaming API).
- Non-native programs are labeled but not decoded (IDL resolution via Program
  Metadata / Anchor → Codama is a natural next step). Other not-yet-done:
  Token-2022 extensions, on-chain metadata for Jupiter-unindexed mints,
  historical USD at block time, SNS `.sol` names, NFT/DAS media.
- The search and home endpoints hit RPC/Jupiter per request; add per-IP rate
  limiting before any serious public deployment.
