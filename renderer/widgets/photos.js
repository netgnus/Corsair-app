// widgets/photos.js — cross-fading recursive slideshow.
// Slideshow + rescan timers pause while the dock is hidden and resume cleanly.
function makePhotos() {
  const node = el('div', 'photo-stage', `
    <div class="photo-empty">
      <div class="big-icon">🖼️</div>
      <p>No photo folder set</p>
      <button class="btn pick">Choose folder…</button>
    </div>`);
  const imgA = el('img'), imgB = el('img');
  node.insertBefore(imgA, node.firstChild);
  node.insertBefore(imgB, node.firstChild);
  const empty = node.querySelector('.photo-empty');
  node.querySelector('.pick').onclick = async () => {
    const f = await window.dock.pickPhotoFolder();
    if (f) { dockConfig.photoFolder = f; load(); }
  };

  let photos = [], idx = 0, showingA = true, timer = null, rescan = null, paused = false;

  function shuffle(a) {                       // Fisher–Yates
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  function order() {
    if (dockConfig && dockConfig.shuffle) shuffle(photos);
    else photos.sort();
  }
  function next() {
    if (!photos.length) return;
    if (idx >= photos.length) { idx = 0; if (dockConfig && dockConfig.shuffle) shuffle(photos); }
    const src = photos[idx]; idx++;
    const nx = showingA ? imgB : imgA, cur = showingA ? imgA : imgB;
    nx.onload = () => { nx.classList.add('show'); cur.classList.remove('show'); showingA = !showingA; };
    nx.src = src;
  }
  function startTimers() {
    stopTimers();
    timer = setInterval(next, (dockConfig && dockConfig.slideMs) || 8000);
    rescan = setInterval(load, 5 * 60 * 1000);
  }
  function stopTimers() {
    if (timer) { clearInterval(timer); timer = null; }
    if (rescan) { clearInterval(rescan); rescan = null; }
  }
  async function load() {
    photos = await window.dock.listPhotos();
    if (photos.length) {
      empty.style.display = 'none';
      order(); idx = 0; next();
      if (!paused) startTimers();
    } else {
      empty.style.display = 'flex';
    }
  }
  // tap the photo to skip (and reset the interval)
  node.addEventListener('click', (e) => {
    if (e.target.closest('.photo-empty')) return;
    if (!photos.length) return;
    next();
    if (!paused) startTimers();
  });
  load();

  return {
    node,
    pause() { paused = true; stopTimers(); },
    resume() { paused = false; if (photos.length) { next(); startTimers(); } else load(); },
    destroy() { stopTimers(); }
  };
}
