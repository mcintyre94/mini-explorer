// The client does exactly one thing: pipe a chunked text/html response into
// #page-root via streamAppendHTMLUnsafe(). No routing, no decoding, no
// framework. Each <template for> chunk routes itself to its marker.

const root = document.getElementById('page-root');
const banner = document.getElementById('banner');

// One delegated listener handles every copy button — including ones that stream
// in later. This is the only client-side behavior beyond piping the stream.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  e.preventDefault();
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const orig = btn.innerHTML;
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1000);
  } catch {}
});

// Feature-detect the experimental API. No polyfill by design — the
// html-setters-polyfill buffers instead of streaming, collapsing the reveal.
if (!Element.prototype.streamAppendHTMLUnsafe) {
  showFlagBanner();
} else {
  wireSearch();
  start();
}

function showFlagBanner() {
  banner.hidden = false;
  banner.innerHTML = `
    <strong>Declarative partial updates not available.</strong>
    This demo needs <em>Chrome 148+</em> with
    <code>chrome://flags/#enable-experimental-web-platform-features</code> enabled,
    then a restart. (<code>Element.prototype.streamAppendHTMLUnsafe</code> is missing.)`;
}

// Typeahead search: same streaming model, just piped into a dropdown instead of
// #page-root. The server classifies + fetches + renders; the client only pipes,
// debounces, and cancels stale queries. This is the one interactive island.
function wireSearch() {
  const form = document.getElementById('nav');
  const q = document.getElementById('q');
  const dd = document.getElementById('search-dd');
  let abort, debounce;

  const close = () => { dd.hidden = true; dd.replaceChildren(); };

  async function run(query) {
    abort?.abort(); // cancel the previous query's in-flight stream
    if (query.trim().length < 2) { close(); return; }
    const mine = (abort = new AbortController());
    dd.hidden = false;
    form.classList.add('searching');
    try {
      const res = await fetch('/search/stream?q=' + encodeURIComponent(query), { signal: mine.signal });
      if (!res.ok || !res.body) return;
      // streamHTMLUnsafe = the REPLACE variant: each query clears + refills.
      // (Results are a flat anchor list — no markers — so innerHTML is a safe fallback.)
      if (dd.streamHTMLUnsafe) {
        await res.body.pipeThrough(new TextDecoderStream()).pipeTo(dd.streamHTMLUnsafe(), { signal: mine.signal });
      } else {
        const text = await res.text();
        if (abort === mine) dd.innerHTML = text;
      }
    } catch { /* aborted or failed */ }
    finally { if (abort === mine) form.classList.remove('searching'); }
  }

  q.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => run(q.value), 200); });
  q.addEventListener('focus', () => { if (dd.childElementCount) dd.hidden = false; });

  q.addEventListener('keydown', (e) => {
    const items = [...dd.querySelectorAll('.search-result')];
    if (e.key === 'Escape') return close();
    if (!items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const cur = dd.querySelector('.search-result.active');
    let i = items.indexOf(cur) + (e.key === 'ArrowDown' ? 1 : -1);
    i = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el) => el.classList.remove('active'));
    items[i].classList.add('active');
    items[i].scrollIntoView({ block: 'nearest' });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const target = dd.querySelector('.search-result.active') || dd.querySelector('.search-result');
    if (target) location.href = target.getAttribute('href');
  });

  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
}

async function start() {
  const path = location.pathname;
  const match = /^\/(tx|account)\/[^/]+$/.test(path);
  if (!match) {
    root.innerHTML = landing();
    return;
  }
  try {
    const res = await fetch(path + '/stream' + location.search);
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    // The whole reveal is this one line.
    await res.body.pipeThrough(new TextDecoderStream()).pipeTo(root.streamAppendHTMLUnsafe());
  } catch (err) {
    root.innerHTML = `<p class="error">Stream failed: ${String(err)}</p>`;
  }
}

function landing() {
  const tx = '35sRCZPkq2pwF1rEJ1MpXE9PD1Bxj8iUVRRfm4Dy38U9FCBnvnbuYyoNVo5oBC4gN8spaZ9Zf88NZWKuDeaZKYzL';
  return `
    <div class="landing">
      <p>Each page renders its skeleton instantly from one fast read, then fills
         in detail <em>out of order</em> as slower sources resolve — no client routing JS.</p>
      <p>Live examples (real chain data):</p>
      <ul>
        <li><a href="/tx/${tx}">Transaction</a> — SOL/USDC/USDT Jupiter swap (native decode, balances, token cells)</li>
        <li><a href="/account/5Wru1WjtbN1JXfeadYrRUGHdAMjMTUZD7YSFVrmTxqGw">Wallet</a> — SOL + holdings + history + portfolio USD</li>
        <li><a href="/account/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">Mint (USDC)</a> — on-chain layout + Jupiter market data</li>
        <li><a href="/account/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4">Program</a> — labeled program account</li>
      </ul>
      <p class="hint">Tip: append <code>?nocache=1</code> to force a cold load — the
         token cache warms after the first view and flattens the reveal, so a cold
         load is the dramatic one.</p>
    </div>`;
}
