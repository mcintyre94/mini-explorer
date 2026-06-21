import { html, toHtml, range } from './html.ts';
import { trendingRow } from './render.ts';
import type { TokenInfo } from './jupiter.ts';

// Wave 1: hero + a trending marker. Trending fills from Jupiter (one wave).
export function homeSkeleton(): string {
  return toHtml(html`
<section class="home">
  <div class="home-hero">
    <h2>Solana Stream Explorer</h2>
    <p class="muted">Search a token, account, or transaction above. Every page renders from one fast read, then fills in as the rest resolves.</p>
  </div>
  <h3>Trending tokens <span class="muted">(24h)</span></h3>
  <div class="trending">
    <div class="trending-head"><span></span><span>Token</span><span>Volume</span><span>Price</span><span>24h</span></div>
    <div class="trending-rows">${range('trending', 'loading trending…')}</div>
  </div>
</section>`);
}

export function trendingPatch(tokens: TokenInfo[]): string {
  const body = tokens.length
    ? html`${tokens.map(trendingRow)}`
    : html`<div class="search-empty muted">Trending tokens unavailable.</div>`;
  return toHtml(html`<template for="trending">${body}</template>`);
}
