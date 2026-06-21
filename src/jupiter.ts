// Jupiter client. Confirmed: base https://api.jup.ag, auth header x-api-key.
const KEY = process.env.JUPITER_API_KEY;
const BASE = 'https://api.jup.ag';

export type TokenInfo = {
  id: string;
  symbol: string;
  name: string;
  icon?: string;
  decimals: number;
  usdPrice?: number;
  priceBlockId?: number;
  holderCount?: number;
  isVerified?: boolean;
  tags?: string[];
  circSupply?: number;
  totalSupply?: number;
  fdv?: number;
  mcap?: number;
  liquidity?: number;
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number };
  organicScore?: number;
  organicScoreLabel?: string;
  stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number; numTraders?: number };
};

// Token-metadata cache, keyed by mint (small + high-hit). The cache warms the
// reveal — which is exactly why a cold load is the dramatic one to demo. Pass
// { bypass } (the ?nocache= param) to force a cold fetch.
const TTL_MS = 60_000;
const tokenCache = new Map<string, { info: TokenInfo; exp: number }>();

// Batched: up to 100 comma-separated mints per call. Returns mint → info.
// Only known/tradeable mints are indexed; missing mints are simply absent
// from the map → caller renders the "unindexed" failure state.
export async function searchTokens(
  mints: string[],
  opts: { bypass?: boolean } = {},
): Promise<Map<string, TokenInfo>> {
  const out = new Map<string, TokenInfo>();
  const unique = [...new Set(mints)].filter(Boolean);
  if (!unique.length) return out;

  const now = Date.now();
  const missing: string[] = [];
  for (const mint of unique) {
    const hit = opts.bypass ? undefined : tokenCache.get(mint);
    if (hit && hit.exp > now) out.set(mint, hit.info);
    else missing.push(mint);
  }
  if (!missing.length) return out; // fully warm — no round-trip

  // Jupiter caps the query at 100 mints, so fetch in sequential batches of 100
  // (sequential to stay friendly to the rate limit). Dropping the overflow is
  // what made mints past #100 on a dusty wallet show as "unindexed".
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    try {
      const res = await fetch(`${BASE}/tokens/v2/search?query=${batch.join(',')}`, {
        headers: { 'x-api-key': KEY ?? '' },
      });
      if (!res.ok) continue; // skip this batch; others can still resolve
      const arr = (await res.json()) as TokenInfo[];
      for (const t of arr) {
        if (!t?.id) continue;
        out.set(t.id, t);
        tokenCache.set(t.id, { info: t, exp: now + TTL_MS }); // warm for next time
      }
    } catch {
      // network failure on this batch → its mints fall to unindexed
    }
  }
  return out;
}

// Trending tokens (top organic score, 24h) for the home page. Short list cache
// so it isn't a fresh Jupiter call per homepage hit; also warms the token cache.
let trendingCache: { data: TokenInfo[]; exp: number } | null = null;
export async function getTrending(limit = 12): Promise<TokenInfo[]> {
  const now = Date.now();
  if (trendingCache && trendingCache.exp > now) return trendingCache.data;
  try {
    const res = await fetch(`${BASE}/tokens/v2/toporganicscore/24h`, { headers: { 'x-api-key': KEY ?? '' } });
    if (!res.ok) return trendingCache?.data ?? [];
    const arr = (await res.json()) as TokenInfo[];
    const data = arr.filter((t) => t?.id).slice(0, limit);
    for (const t of data) tokenCache.set(t.id, { info: t, exp: now + TTL_MS });
    trendingCache = { data, exp: now + 30_000 };
    return data;
  } catch {
    return trendingCache?.data ?? [];
  }
}

// Search tokens by name/symbol (same endpoint, query is text not mints).
// Returns results in Jupiter's relevance order and warms the token cache, so
// clicking a result into its mint page is a warm load.
export async function searchByText(query: string): Promise<TokenInfo[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(`${BASE}/tokens/v2/search?query=${encodeURIComponent(q)}`, {
      headers: { 'x-api-key': KEY ?? '' },
    });
    if (!res.ok) return [];
    const arr = (await res.json()) as TokenInfo[];
    const now = Date.now();
    for (const t of arr) if (t?.id) tokenCache.set(t.id, { info: t, exp: now + TTL_MS });
    return arr.filter((t) => t?.id);
  } catch {
    return [];
  }
}

// ---- Wallet holdings: native SOL + per-mint token accounts -----------------
export type TokenAccountHolding = {
  account: string;
  amount: string;
  uiAmount: number;
  uiAmountString?: string;
  decimals: number;
  programId: string;
  isFrozen: boolean;
  isAssociatedTokenAccount: boolean;
  lamports?: string;
};

export type Holdings = {
  amount: string;
  uiAmount: number;
  uiAmountString: string;
  tokens: Record<string, TokenAccountHolding[]>;
};

export async function getHoldings(address: string): Promise<Holdings | null> {
  try {
    const res = await fetch(`${BASE}/ultra/v1/holdings/${address}`, { headers: { 'x-api-key': KEY ?? '' } });
    if (!res.ok) return null;
    return (await res.json()) as Holdings;
  } catch {
    return null;
  }
}
