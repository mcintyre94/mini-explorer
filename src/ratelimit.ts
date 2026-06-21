import type { IncomingMessage } from 'node:http';

// Best-effort, in-memory rate limiting for the dynamic endpoints (they fan out
// to RPC/Jupiter, so unmetered they're a griefing/quota-drain vector). State
// lives in a Map on the single instance — fine here: nothing needs shared state.
//
// Two layers, because behind Railway's proxy `X-Forwarded-For` is client-set and
// therefore spoofable:
//   • per-IP bucket — fairness for the normal case (one actor can't hog).
//   • global bucket — a hard ceiling that protects the upstream quotas even if an
//     attacker rotates fake IPs to dodge the per-IP limit.
//
// Both are token buckets: `burst` capacity, refilling at `perSec`. A page load is
// one stream and typeahead is debounced (~5 req/s, stale queries cancelled), so
// legitimate traffic stays well under these.

type Bucket = { tokens: number; updated: number };

function makeLimiter(burst: number, perSec: number) {
  const take = (b: Bucket, now: number): boolean => {
    b.tokens = Math.min(burst, b.tokens + ((now - b.updated) / 1000) * perSec);
    b.updated = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
  return { take, burst, perSec };
}

const perIp = makeLimiter(20, 5);
const global = makeLimiter(50, 20);
const buckets = new Map<string, Bucket>();
const globalBucket: Bucket = { tokens: global.burst, updated: 0 };

// Drop idle (refilled-to-full) buckets so the Map can't grow without bound.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) {
    if (b.tokens + ((now - b.updated) / 1000) * perIp.perSec >= perIp.burst) buckets.delete(ip);
  }
}, 60_000);
sweep.unref?.(); // never keep the process alive just for the sweep

// True if the request is allowed. Per-IP is checked first so an IP that has
// exhausted its own bucket doesn't also spend from the shared global budget.
export function allow(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: perIp.burst, updated: now }; buckets.set(ip, b); }
  return perIp.take(b, now) && global.take(globalBucket, now);
}

// The client IP. Behind Railway the connecting socket is the proxy, so prefer the
// left-most X-Forwarded-For entry (the original client), falling back to the
// socket address for local/direct connections.
export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const first = typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined;
  return first || req.socket.remoteAddress || 'unknown';
}
