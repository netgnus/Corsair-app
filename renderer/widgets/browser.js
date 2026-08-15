// widgets/browser.js — embedded web view with URL bar and quick links.
// Guests are locked down by main's security layer (will-attach-webview,
// popup routing, permission denial). Browser state survives hide/show —
// hiding the dock must never log Home Assistant out.
function makeBrowser(slotIndex) {
  const node = el('div', 'browser', `
    <div class="url-bar">
      <button class="back" title="Back">‹</button>
      <button class="fwd" title="Forward">›</button>
      <button class="reload" title="Reload">⟳</button>
      <input class="url" type="text" placeholder="Enter URL or search…" />
      <button class="go" title="Go">→</button>
      <div class="quicklinks">
        <button data-url="https://www.google.com" title="Google">🔍</button>
        <button data-url="https://www.youtube.com" title="YouTube">▶</button>
        <button data-url="https://web.whatsapp.com" title="WhatsApp">💬</button>
      </div>
    </div>`);
  const wv = document.createElement('webview');
  const startUrl = (dockConfig.browserUrls && dockConfig.browserUrls[slotIndex]) || 'https://www.google.com';
  wv.setAttribute('src', startUrl);
  // No allowpopups: main routes http(s) popups back into this webview.
  node.appendChild(wv);

  const input = node.querySelector('.url');
  input.value = startUrl;

  function normalize(v) {
    v = v.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+/.test(v)) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  }
  function navigate(v) { const u = normalize(v); if (u) wv.loadURL(u); }

  node.querySelector('.go').onclick = () => navigate(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(input.value); });
  node.querySelector('.back').onclick = () => { if (wv.canGoBack()) wv.goBack(); };
  node.querySelector('.fwd').onclick = () => { if (wv.canGoForward()) wv.goForward(); };
  node.querySelector('.reload').onclick = () => wv.reload();
  node.querySelectorAll('.quicklinks button').forEach(b => b.onclick = () => navigate(b.dataset.url));

  wv.addEventListener('did-navigate', (e) => {
    input.value = e.url;
    dockConfig.browserUrls[slotIndex] = e.url;
    window.dock.setConfig({ browserUrls: dockConfig.browserUrls });
  });
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) input.value = e.url; });

  return { node, destroy() { /* webview removed with node */ } };
}
