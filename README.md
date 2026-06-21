# Solana Stream Explorer

A Solana block explorer (transaction + account pages) that demos Chrome's
**declarative partial updates** — out-of-order HTML streaming. Each page renders
its structural skeleton instantly from one fast RPC read, then progressively
fills in detail *out of order* as slower sources resolve (token metadata,
balances, market data) — each landing in its own marker, with **no client-side
routing or decode JS**. The client is a single pipe; the server fans out to all
sources, decodes everything, and emits finished HTML cells as `<template for>`
chunks.

## Requirements

- **Chrome 148+** with `chrome://flags/#enable-experimental-web-platform-features`
  enabled (the experimental `streamAppendHTMLUnsafe` API). Other browsers see a
  feature-detect banner — there is **no polyfill** by design (it would buffer and
  collapse the reveal).
- **Node 24+** (runs TypeScript directly via type-stripping — no build step).
- A `.env` with `RPC_URL` (Solana JSON-RPC) and `JUPITER_API_KEY`.

## Run

```bash
npm install
npm start         # or: npm run dev  (watch mode)
# → http://localhost:3000
```

Open the root in a flag-enabled Chrome and use the example links.

## How it works

```
Browser ──GET /tx/{sig}/stream──▶  Server (per-request orchestrator)
   │                                  ├─ RPC getTransaction (wave 1, fast)
   │   chunked text/html              ├─ @solana-program decode (ComputeBudget) + jsonParsed
   ◀────── <template for> cells ──────┤─ Jupiter /tokens/v2/search (token cells, wave 2)
        (out of order, as resolved)   └─ each patches its marker
```

- **Wave 1 (structure):** one fast RPC read renders the whole skeleton. Every
  slower detail is a `<?start name>…<?end>` range or `<?marker name>`.
- **Wave 2+ (enrichment):** slower sources patch their markers with finished HTML,
  landing in completion order. A patch's content can carry its own markers, so
  dependent data nests.
- **Ordering invariant:** a `<template for>` only applies if its target marker
  already exists when parsed — otherwise it's lost. So all structural rows are
  flushed before their enrichment patches.
- **Escaping:** streamed with the sanitizer off (that's what "Unsafe" means, so
  the `<template>`/`<?marker>` machinery survives), so every chain-derived value
  is HTML-escaped server-side. `runScripts` stays `false`.

### Endpoints

- `GET /` — static canvas
- `GET /tx/{sig}/stream` — chunked `text/html` transaction stream
- `GET /account/{addr}/stream` — chunked `text/html` account stream
- `?slow=N` / `?nocache=1` on either — **dev knobs** (add N ms latency per
  external request / bypass the token cache for a cold load). Inert unless
  `DEV_TOOLS=1` is set (it is under `npm run dev`, not `npm start`), so they add
  no DoS/quota-abuse surface in production.

## Layout

| File | Role |
|---|---|
| `src/server.ts` | HTTP server, routing, per-request stream orchestration |
| `src/rpc.ts` | JSON-RPC client (getTransaction / getAccountInfo / getSignaturesForAddress) |
| `src/jupiter.ts` | Jupiter client (token search + holdings) + token cache |
| `src/decode.ts` | Native decode — `@solana-program/compute-budget` + priority fee |
| `src/programs.ts` | Curated programId → label dictionary + native set |
| `src/render.ts` | Escaping, token cells, tx skeleton + balance diff |
| `src/account.ts` | Account routing + per-route skeletons & enrichment patches |
| `public/` | Canvas (`index.html`), the single pipe (`client.js`), styles |

## Scope

**In (MVP):** tx page (skeleton, balances, native-program decode, non-native
labeled "not decoded", token cells, USD); account page (wallet / mint /
token-account / program / other routing, holdings, history, market data);
authored failure states; server-side decode + token cache.

**Post-MVP:** non-native IDL resolution (Program Metadata + Anchor → Codama
dynamic-client) to decode the programs left labeled; Token-2022 extensions;
on-chain metadata fallback for unindexed mints; historical USD at block time;
SNS `.sol` names; NFT/DAS media.

**Non-goals:** writes/interaction; auth; non-Chrome support / polyfills.
