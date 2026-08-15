// store.js — ONE shared polling/subscription layer for the whole renderer.
//
// Any number of widgets showing the same data (System | System | System)
// produce exactly ONE fetch cycle per topic. Timers run only while at least
// one widget subscribes AND the document is visible; on hide everything
// pauses, on show everything refreshes immediately.
//
// Plain JavaScript, no frameworks. Classic-script top-level const is shared
// with the other renderer scripts loaded after this one.
const DockStore = (() => {
  const topics = {
    stats:   { intervalMs: 2000,   fetch: () => window.dock.getStats() },
    media:   { intervalMs: 5000,   fetch: () => window.dock.getMedia() },
    weather: { intervalMs: 600000, fetch: () => window.dock.getWeather() },   // main caches too
    health:  { intervalMs: 3000,   fetch: () => window.dock.getHealth() }
  };

  const state = {};   // name -> { subs:Set, timer, last, lastTs, inflight }
  for (const name of Object.keys(topics)) {
    state[name] = { subs: new Set(), timer: null, last: null, lastTs: 0, inflight: false };
  }

  async function poll(name) {
    const s = state[name];
    if (s.inflight || document.hidden || s.subs.size === 0) return;
    s.inflight = true;
    try {
      const v = await topics[name].fetch();
      s.last = v;
      s.lastTs = Date.now();
      for (const fn of s.subs) { try { fn(v); } catch (e) {} }
    } catch (e) { /* keep last value; next tick retries */ }
    s.inflight = false;
  }

  function ensureTimer(name) {
    const s = state[name];
    if (s.timer || s.subs.size === 0 || document.hidden) return;
    s.timer = setInterval(() => poll(name), topics[name].intervalMs);
  }
  function stopTimer(name) {
    const s = state[name];
    if (s.timer) { clearInterval(s.timer); s.timer = null; }
  }

  // subscribe(topic, fn) -> unsubscribe. Immediately delivers a cached value
  // if fresh, otherwise triggers a fetch.
  function subscribe(name, fn) {
    const s = state[name];
    if (!s) throw new Error('unknown topic: ' + name);
    s.subs.add(fn);
    if (s.last != null && Date.now() - s.lastTs < topics[name].intervalMs) {
      try { fn(s.last); } catch (e) {}
    } else {
      poll(name);
    }
    ensureTimer(name);
    return () => {
      s.subs.delete(fn);
      if (s.subs.size === 0) stopTimer(name);
    };
  }

  // Force a refresh (e.g. right after settings change).
  function refresh(name) { return poll(name); }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const name of Object.keys(topics)) stopTimer(name);
    } else {
      for (const name of Object.keys(topics)) { ensureTimer(name); poll(name); }
    }
  });

  return { subscribe, refresh };
})();
