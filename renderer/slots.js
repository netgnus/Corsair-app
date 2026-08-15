// slots.js — the three-slot layout, widget registry, and widget lifecycle.
//
// Lifecycle contract: a widget factory returns { node, destroy, pause?, resume? }.
// pause/resume are dispatched to every mounted widget on visibilitychange, so
// hidden docks do no rendering work (the store also stops all polling).
const WIDGETS = {
  browser: { icon: '🌐', label: 'Browser', make: (i) => makeBrowser(i) },
  apps:    { icon: '▦',  label: 'Apps',    make: () => makeLauncher() },
  photos:  { icon: '🖼️', label: 'Photos',  make: () => makePhotos() },
  clock:   { icon: '🕐', label: 'Clock',   make: () => makeClock() },
  system:  { icon: '📊', label: 'System',  make: () => makeSystem() }
};
const WIDGET_ORDER = ['browser', 'apps', 'photos', 'clock', 'system'];

const slotControllers = [null, null, null];

function setSlot(index, key) {
  if (!WIDGETS[key]) key = 'clock';
  const slotEl = document.querySelectorAll('.slot')[index];
  const body = slotEl.querySelector('.slot-body');
  if (slotControllers[index]) { try { slotControllers[index].destroy(); } catch (e) {} }
  body.innerHTML = '';
  const ctrl = WIDGETS[key].make(index);
  body.appendChild(ctrl.node);
  slotControllers[index] = ctrl;
  slotEl.querySelectorAll('.swbtn').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  dockConfig.slots[index] = key;
  window.dock.setConfig({ slots: dockConfig.slots });
}

function buildSlots() {
  const dock = $('dock');
  dock.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const slot = el('div', 'slot');
    const switcher = el('div', 'slot-switcher');
    WIDGET_ORDER.forEach(key => {
      const b = el('button', 'swbtn');
      b.innerHTML = `<span class="swicon">${WIDGETS[key].icon}</span><span class="swlabel">${WIDGETS[key].label}</span>`;
      b.title = WIDGETS[key].label;
      b.dataset.key = key;
      b.onclick = () => setSlot(i, key);
      switcher.appendChild(b);
    });
    const body = el('div', 'slot-body');
    slot.appendChild(switcher);
    slot.appendChild(body);
    dock.appendChild(slot);
  }
  for (let i = 0; i < 3; i++) {
    const key = (dockConfig.slots && dockConfig.slots[i]) || WIDGET_ORDER[i] || 'clock';
    setSlot(i, key);
  }
}

// Widget-level pause/resume on hide/show. Browser state is untouched — the
// webview keeps its session; we only stop timers and rendering work.
document.addEventListener('visibilitychange', () => {
  for (const ctrl of slotControllers) {
    if (!ctrl) continue;
    try {
      if (document.hidden) { if (ctrl.pause) ctrl.pause(); }
      else { if (ctrl.resume) ctrl.resume(); }
    } catch (e) {}
  }
});
