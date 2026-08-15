// widgets/launcher.js — tap-to-launch app grid.
// v1.2.0: tiles carry an opaque ID; main resolves it to a path. The renderer
// never sees or sends filesystem paths.
function makeLauncher() {
  const node = el('div', 'launcher', `<div class="launch-grid"></div>`);
  const grid = node.querySelector('.launch-grid');
  async function load() {
    const apps = await window.dock.getLauncher();
    grid.innerHTML = '';
    if (!apps || !apps.length) {
      grid.innerHTML = '<div class="launch-empty">No apps configured.<br><span>Run resolve-apps.ps1 to populate.</span></div>';
      return;
    }
    apps.forEach(a => {
      const tile = el('button', 'launch-tile');
      tile.innerHTML =
        (a.icon ? `<img src="${a.icon}" alt="">` : `<div class="launch-fallback">${(a.name || '?')[0]}</div>`) +
        `<span>${a.name || ''}</span>`;
      tile.onclick = () => window.dock.launchApp(a.id);
      grid.appendChild(tile);
    });
  }
  load();
  return { node, destroy() {} };
}
