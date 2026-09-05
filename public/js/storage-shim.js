/* Safe storage shim: some browsers/privacy modes throw on localStorage access (SecurityError / QuotaExceeded).
   We wrap window.localStorage so the app degrades to in-memory storage instead of crashing during login. */
(function () {
  try {
    const t = '__kb_probe__'; window.localStorage.setItem(t, '1'); window.localStorage.removeItem(t);
    return; // storage works → leave it alone
  } catch (e) { /* fall through to the shim */ }
  const mem = new Map();
  const shim = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { mem.set(String(k), String(v)); },
    removeItem: (k) => { mem.delete(String(k)); },
    clear: () => mem.clear(),
    key: (i) => Array.from(mem.keys())[i] ?? null,
    get length() { return mem.size; },
  };
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: () => shim }); } catch (e) { /* cannot override: modules already guard */ }
  window.__kbStorageBlocked = true;
})();
