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
  wireNav();
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

function wireNav() {
  const form = document.getElementById('nav');
  const q = document.getElementById('q');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = q.value.trim();
    if (!v) return;
    // Signatures are ~88 base58 chars; addresses ~32–44. Cheap heuristic.
    location.href = (v.length >= 80 ? '/tx/' : '/account/') + encodeURIComponent(v);
  });
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
