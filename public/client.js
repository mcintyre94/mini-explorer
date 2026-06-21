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
    <strong>This browser isn't supported yet.</strong>
    Mini Explorer needs <em>Chrome 148+</em> with experimental web platform features enabled —
    turn on <code>chrome://flags/#enable-experimental-web-platform-features</code> and restart Chrome.`;
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
  let streamUrl;
  if (path === '/') streamUrl = '/home/stream';
  else if (/^\/(tx|account)\/[^/]+$/.test(path)) streamUrl = path + '/stream' + location.search;
  else { root.innerHTML = '<p class="error">Not found.</p>'; return; }
  try {
    const res = await fetch(streamUrl);
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    // The whole page is this one line. (The home stream stays open for live slots.)
    await res.body.pipeThrough(new TextDecoderStream()).pipeTo(root.streamAppendHTMLUnsafe());
  } catch (err) {
    root.innerHTML = `<p class="error">Stream failed: ${String(err)}</p>`;
  }
}
