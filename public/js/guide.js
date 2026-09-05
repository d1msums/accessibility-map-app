/* KBGuide — permissions, live location, voice assistant, turn-by-turn navigation and the on-site camera check.
 *
 *   KBGuide.init(ctx)                      ctx = same object app.js gives KBMap (+ openRequest, prefillAsk)
 *   KBGuide.requestPermissions()           onboarding card: location / camera / microphone
 *   KBGuide.locate({ prompt }) → {lat,lng} | null      KBGuide.position() → last fix
 *   KBGuide.onPosition(fn)                 live updates while watching
 *   KBGuide.start({ to, label, need, requestId })      turn-by-turn with voice
 *   KBGuide.stop()
 *   KBGuide.ask(text) / KBGuide.listen()   assistant (text or microphone)
 *   KBGuide.speak(text, lang)
 *   KBGuide.openCamera({ request, onResult })          in-app camera → Gemini assessment
 */
window.KBGuide = (() => {
  let C = null;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ico = (e, n = 16) => (window.I ? I.emoji(e, n) : e);
  const G = {
    pos: null, watchId: null, posListeners: new Set(), perms: (() => { try { return JSON.parse(localStorage.getItem('kb.perms') || '{}'); } catch { return {}; } })(),
    nav: null,                    // { to, label, need, steps, coords, stepIdx, distanceM, durationMin, engine, warnings, spoken:Set, lastReroute }
    listening: false, rec: null, voices: [], muted: localStorage.getItem('kb.mute') === '1', busy: false, log: [],
  };
  const SIM = { timer: null };  // demo walk simulation (desktop / no GPS)
  const DEFAULT = { lat: 3.13431, lng: 101.68637 };

  function init(ctx) { C = ctx; buildDock(); permState('geolocation').then((st) => { if (st === 'granted') { G.perms.geolocation = 'granted'; locate().then(() => watch()); } }); if (window.speechSynthesis) { G.voices = speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => { G.voices = speechSynthesis.getVoices(); }; } }
  const t = (k, v) => C.t(k, v);
  const esc = (s) => C.esc(s);
  const hav = (a, b) => C.haversine(a, b);
  const lang = () => C.S.lang;

  // ---------- permissions ----------
  function savePerms() { localStorage.setItem('kb.perms', JSON.stringify(G.perms)); }
  async function permState(name) {
    try { if (navigator.permissions && navigator.permissions.query) { const p = await navigator.permissions.query({ name }); return p.state; } } catch { /* not supported (e.g. Safari for camera) */ }
    return G.perms[name] || 'prompt';
  }
  async function requestPermissions({ force = false } = {}) {
    if (!force && localStorage.getItem('kb.permsAsked') === '1') return;
    localStorage.setItem('kb.permsAsked', '1');
    const states = { geolocation: await permState('geolocation'), camera: await permState('camera'), microphone: await permState('microphone'), notifications: (window.Notification && Notification.permission === 'granted') ? 'granted' : await permState('notifications'), motion: G.perms.motion || 'prompt' };
    const row = (key, icon, title, sub) => `<div class="perm" data-p="${key}"><div class="ic">${window.I ? I(icon, 22) : ''}</div><div class="grow"><b>${title}</b><div class="muted">${sub}</div></div><span class="chip ${states[key] === 'granted' ? 'good' : 'ghost'}" id="ps_${key}">${states[key] === 'granted' ? t('perm_on') : states[key] === 'denied' ? t('perm_denied') : t('perm_ask')}</span></div>`;
    C.openModal(`<div class="perms"><div class="art">${window.ART && ART.permissions ? ART.permissions() : ''}</div><h2>${t('perm_title')}</h2><p class="muted">${t('perm_sub')}</p>
      ${row('geolocation', 'pin', t('perm_loc'), t('perm_loc_sub'))}${row('camera', 'camera', t('perm_cam'), t('perm_cam_sub'))}${row('microphone', 'mic', t('perm_mic'), t('perm_mic_sub'))}${row('notifications', 'bell', t('perm_notif'), t('perm_notif_sub'))}${row('motion', 'compass', t('perm_motion'), t('perm_motion_sub'))}
      <div class="actions" style="margin-top:14px"><button class="btn btn-ghost" id="permLater">${t('later')}</button><button class="btn btn-black btn-lg grow" id="permAllow">${t('perm_allow')}</button></div>
      <div class="err hidden" id="permWhy" style="margin-top:8px"></div>
      <div class="muted" style="font-size:11px;margin-top:8px">${t('perm_note')}</div></div>`, { closable: false });
    $('#permLater').onclick = C.closeModal;
    $('#permAllow').onclick = async () => {
      $('#permAllow').disabled = true; $('#permAllow').textContent = t('perm_asking');
      const set = (k, st) => { G.perms[k] = st; const el = $(`#ps_${k}`); if (el) { el.textContent = st === 'granted' ? t('perm_on') : st === 'denied' ? t('perm_denied') : t('perm_ask'); el.className = `chip ${st === 'granted' ? 'good' : st === 'denied' ? 'bad' : 'ghost'}`; } };
      // 1. location
      const pos = await locate({ prompt: true, timeout: 12000 });
      set('geolocation', pos ? 'granted' : 'denied');
      if (!pos) { const why = $('#permWhy'); if (why) { why.textContent = t(G.geoError === 'blocked' ? 'geo_blocked' : G.geoError === 'timeout' ? 'geo_timeout' : 'geo_denied', { area: (C.S.me && C.S.me.area) || 'KL' }); why.classList.remove('hidden');
        if (G.geoError === 'blocked' && inIframe) { const b = document.createElement('button'); b.className = 'btn btn-outline btn-sm'; b.id = 'permOpenTab'; b.style.marginTop = '8px'; b.textContent = t('open_new_tab'); b.onclick = () => window.open(location.href, '_blank', 'noopener'); why.after(b); } } }
      if (pos) { watch(); C.S.geo = pos; if (window.KBMap && KBMap.setMe) KBMap.setMe(pos, { fly: true }); }
      // 2. camera + microphone (one prompt when both are requested together)
      try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true }); s.getTracks().forEach((tr) => tr.stop()); set('camera', 'granted'); set('microphone', 'granted'); }
      catch {
        try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((tr) => tr.stop()); set('camera', 'granted'); } catch { set('camera', 'denied'); }
        try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((tr) => tr.stop()); set('microphone', 'granted'); } catch { set('microphone', 'denied'); }
      }
      // 3. notifications (task alerts, thanks, arrival)
      try { if (window.Notification && Notification.permission !== 'denied') { const r = await Promise.race([Notification.requestPermission(), new Promise((res) => setTimeout(() => res('default'), 15000))]); set('notifications', r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'prompt'); } else set('notifications', window.Notification ? 'denied' : 'unsupported'); } catch { set('notifications', 'denied'); }
      // 4. motion / compass (iOS needs an explicit request; elsewhere it is implicit)
      try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); set('motion', r === 'granted' ? 'granted' : 'denied'); } else set('motion', window.DeviceOrientationEvent ? 'granted' : 'unsupported'); } catch { set('motion', 'denied'); }
      if (G.perms.motion === 'granted') startCompass();
      // 5. keep the screen awake while guiding + persistent storage for offline map data (best effort, no prompt)
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
      try { if (navigator.wakeLock) { const wl = await navigator.wakeLock.request('screen'); G.wakeLock = wl; } } catch {}
      savePerms();
      $('#permAllow').textContent = t('done'); $('#permAllow').disabled = false; $('#permAllow').onclick = C.closeModal; $('#permLater').classList.add('hidden');
      setTimeout(() => { if ($('#permAllow')) C.closeModal(); }, 1400);
    };
  }

  function startCompass() {
    if (G.compassOn || !window.DeviceOrientationEvent) return; G.compassOn = true;
    const onOri = (e) => { const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.alpha != null ? 360 - e.alpha : null); if (h != null && window.KBMap && KBMap.setHeading) KBMap.setHeading(h); };
    window.addEventListener('deviceorientationabsolute', onOri, true); window.addEventListener('deviceorientation', onOri, true);
  }
  /** system notification (only when the tab is hidden; in-app toasts otherwise) */
  function notify(title, body) {
    try { if (window.Notification && Notification.permission === 'granted' && document.visibilityState === 'hidden') new Notification(title, { body, icon: '/icon.svg', tag: 'kitabantu' }); } catch {}
  }

  // ---------- location ----------
  function position() { return G.pos; }
  function onPosition(fn) { G.posListeners.add(fn); return () => G.posListeners.delete(fn); }
  function setPos(p) { G.pos = p; C.S.geo = { lat: p.lat, lng: p.lng }; for (const fn of G.posListeners) { try { fn(p); } catch (e) { console.warn(e); } } if (G.nav) onNavTick(p); }
  /** Why the last locate() failed: 'denied' | 'blocked' (embedding page / insecure origin forbids it) | 'timeout' | 'unavailable' | null */
  G.geoError = null;
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  function locate({ prompt = false, timeout = 8000 } = {}) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { G.geoError = 'unavailable'; return resolve(null); }
      if (!window.isSecureContext) { G.geoError = 'blocked'; return resolve(null); }
      if (!prompt && G.perms.geolocation === 'denied') return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => { const pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading }; G.perms.geolocation = 'granted'; G.geoError = null; savePerms(); setPos(pos); resolve(pos); },
        (err) => {
          // code 1 = PERMISSION_DENIED. Inside an iframe without allow="geolocation" the browser also reports code 1 → call that 'blocked'
          G.geoError = err && err.code === 1 ? (inIframe ? 'blocked' : 'denied') : err && err.code === 3 ? 'timeout' : 'unavailable';
          if (G.geoError === 'denied') { G.perms.geolocation = 'denied'; savePerms(); }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout, maximumAge: 15000 });
    });
  }
  /** Best known position: live GPS → last fix → the user's home area (profile) → KL Sentral. Never silently KL when the user lives elsewhere. */
  function home() {
    const me = C && C.S && C.S.me;
    const area = (me && me.area) || '';
    const AREAS = { cyberjaya: { lat: 2.9213, lng: 101.6559 }, putrajaya: { lat: 2.9264, lng: 101.6964 }, 'kl sentral': { lat: 3.13431, lng: 101.68637 }, brickfields: { lat: 3.1290, lng: 101.6840 }, 'bukit bintang': { lat: 3.1466, lng: 101.7110 }, 'petaling jaya': { lat: 3.1073, lng: 101.6067 }, 'kuala lumpur': { lat: 3.1390, lng: 101.6869 }, bangsar: { lat: 3.1300, lng: 101.6710 }, 'subang jaya': { lat: 3.0567, lng: 101.5851 }, 'shah alam': { lat: 3.0733, lng: 101.5185 }, puchong: { lat: 3.0333, lng: 101.6167 }, 'seri kembangan': { lat: 3.0298, lng: 101.7080 }, kajang: { lat: 2.9935, lng: 101.7874 }, 'sepang': { lat: 2.8112, lng: 101.7080 }, dengkil: { lat: 2.8623, lng: 101.6836 } };
    const key = Object.keys(AREAS).find((k) => area.toLowerCase().includes(k));
    return G.pos || (C && C.S && C.S.geo) || (key && AREAS[key]) || DEFAULT;
  }
  function watch() {
    if (G.watchId != null || !navigator.geolocation) return;
    G.watchId = navigator.geolocation.watchPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed }), () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  // ---------- speech ----------
  function pickVoice(l) {
    const want = l === 'ms' ? ['ms-MY', 'ms', 'id-ID', 'id'] : ['en-MY', 'en-SG', 'en-GB', 'en-AU', 'en-US', 'en'];
    for (const w of want) { const v = G.voices.find((x) => x.lang.replace('_', '-').toLowerCase().startsWith(w.toLowerCase())); if (v) return v; }
    return null;
  }
  function speak(text, l = lang(), { interrupt = true } = {}) {
    if (!text) return;
    logLine('bot', text);
    if (G.muted || !window.speechSynthesis) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = l === 'ms' ? 'ms-MY' : 'en-MY';
    const v = pickVoice(l); if (v) u.voice = v;
    u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
  }
  function setMuted(m) { G.muted = m; localStorage.setItem('kb.mute', m ? '1' : '0'); if (m) speechSynthesis && speechSynthesis.cancel(); $('#dockMute') && ($('#dockMute').innerHTML = window.I ? I(m ? 'mute' : 'speaker', 18) : ''); }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function listen() {
    if (!SR) { openAssistant(); C.toast(t('voice_unsupported'), 'warn'); return; }
    if (G.listening) { try { G.rec.stop(); } catch {} return; }
    const rec = new SR();
    rec.lang = lang() === 'ms' ? 'ms-MY' : 'en-MY';
    rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    G.rec = rec; G.listening = true; speechSynthesis && speechSynthesis.cancel();
    openAssistant(); setDockState('listening'); $('#asInput').value = ''; $('#asInput').placeholder = t('listening');
    let finalText = '';
    rec.onresult = (e) => { let txt = ''; for (const r of e.results) txt += r[0].transcript; $('#asInput').value = txt; if (e.results[e.results.length - 1].isFinal) finalText = txt; };
    rec.onerror = (e) => { G.listening = false; setDockState('idle'); if (e.error === 'not-allowed') { G.perms.microphone = 'denied'; savePerms(); C.toast(t('mic_denied'), 'warn'); } };
    rec.onend = () => { G.listening = false; setDockState('idle'); $('#asInput').placeholder = t('ask_ph'); const text = finalText || $('#asInput').value; if (text.trim()) ask(text.trim()); };
    try { rec.start(); } catch { G.listening = false; setDockState('idle'); }
  }

  // ---------- assistant ----------
  function navContext() {
    if (!G.nav) return null;
    const s = G.nav.steps[G.nav.stepIdx];
    return { notify, act, destination: G.nav.label, next_instruction: s ? s.text : null, distance_to_next_m: s && G.pos ? Math.round(hav(G.pos, s)) : null, remaining_m: remaining(), engine: G.nav.engine, warnings: G.nav.warnings.map((w) => w.label) };
  }
  async function ask(text) {
    if (G.busy) return;
    openAssistant();
    logLine('me', text);
    G.busy = true; setDockState('thinking'); $('#asSend').disabled = true;
    try {
      const loc = G.pos || C.S.geo || (window.KBMap && KBMap.me) || null;
      let locName = C.S.locName || null;
      if (loc && !locName) { try { locName = (await C.api(`/api/reverse?lat=${loc.lat}&lng=${loc.lng}`)).name; C.S.locName = locName; } catch {} }
      const ctx = { location: loc ? { lat: loc.lat, lng: loc.lng, name: locName } : null, navigation: navContext(), places: (window.KBMap && KBMap._places) || undefined, route: C.S.route, mapEngine: window.KBMap ? KBMap.engine : null };
      const r = await C.api('/api/agent', { method: 'POST', body: { text, lang: lang(), ctx } });
      if (r.model) { const m = $('#asModel'); if (m) m.textContent = r.model === 'local' ? 'KitaBantu · instant' : String(r.model).replace(/^gemini-/, 'Gemini '); }
      speak(r.say, r.lang);
      for (const a of r.actions || []) { try { await act(a, r); } catch (e) { console.warn('action failed', a, e); } }
      // on a phone the panel covers the map: get out of the way after map actions (the mic button stays)
      if (window.innerWidth < 900 && (r.actions || []).some((a) => ['start_navigation', 'show_places_on_map', 'focus_map', 'map_zoom', 'show_route'].includes(a.type))) setTimeout(closeAssistant, 900);
    } catch (err) {
      const detail = err.data?.detail || '';
      const msg = /quota|rate|demand|no_model/i.test(detail) ? t('ai_busy') : t('ai_fail');
      logLine('bot', msg); C.toast(msg, 'warn');
    } finally { G.busy = false; setDockState('idle'); $('#asSend').disabled = false; }
  }
  /** Execute one client-side action requested by the agent (full app control). */
  async function act(a, r) {
    if (!a || !a.type) return;
    const goMap = () => { C.closeModal(); if (C.S.route !== 'map') { location.hash = '#/map'; return new Promise((res) => setTimeout(res, 380)); } return Promise.resolve(); };
    const app = window.KBApp || {};
    if (['open_screen', 'prefill_ask', 'open_camera', 'logout'].includes(a.type)) C.closeModal();
    switch (a.type) {
      case 'start_navigation': {
        if (a.lat == null || a.lng == null) return;
        let request = null;
        if (a.request_id) { try { request = await C.api(`/api/requests/${a.request_id}`); } catch {} }
        await goMap();
        return start({ to: { lat: Number(a.lat), lng: Number(a.lng) }, label: a.label || request?.place || '', need: request?.need || C.S.me?.need || null, requestId: a.request_id || null, request });
      }
      case 'show_route': await goMap(); return KBMap.showRoute({ lat: Number(a.from_lat), lng: Number(a.from_lng) }, { lat: Number(a.to_lat), lng: Number(a.to_lng) }, { fromLabel: a.from_label || '', toLabel: a.to_label || '', need: a.need || null });
      case 'stop_navigation': return stop({ silent: true });
      case 'navigation_step': {
        if (!G.nav) return;
        if (a.which === 'next') return sayStep(Math.min(G.nav.stepIdx + 1, G.nav.steps.length - 1), { force: true });
        if (a.which === 'all') return readAll();
        return sayStep(G.nav.stepIdx, { force: true });
      }
      case 'show_places_on_map': await goMap(); return KBMap.showPlaces(a.kind && a.kind !== 'any' ? a.kind : 'any', a.query || '');
      case 'focus_map': await goMap(); return KBMap.highlight && KBMap.highlight({ lat: Number(a.lat), lng: Number(a.lng) }, a.label || '', a.zoom ? Number(a.zoom) : 17);
      case 'map_zoom': await goMap(); if (a.direction && KBMap.zoom) KBMap.zoom(a.direction === 'in' ? 1 : -1); if (a.need_filter) KBMap.setNeed(a.need_filter === 'all' ? '' : a.need_filter); return;
      case 'open_screen': {
        const sc = String(a.screen || 'home');
        closeAssistant();
        if (sc.startsWith('request:')) return app.openRequest && app.openRequest(sc.slice(8));
        if (sc.startsWith('report:')) { await goMap(); return KBMap.openReport(sc.slice(7)); }
        const ok = ['home', 'requests', 'map', 'community', 'profile', 'ask', 'shop'];
        const base = sc.split('/')[0];
        if (ok.includes(base)) { if (base === 'requests' && C.S.me?.role !== 'helper') location.hash = '#/home'; else location.hash = `#/${sc}`; }
        return;
      }
      case 'open_camera': {
        let request = G.nav?.request || null;
        if (a.request_id) { try { request = await C.api(`/api/requests/${a.request_id}`); } catch {} }
        closeAssistant(); return openCamera({ request });
      }
      case 'prefill_ask': {
        closeAssistant();
        return C.prefillAsk && C.prefillAsk({ name: a.place, lat: a.lat != null ? Number(a.lat) : undefined, lng: a.lng != null ? Number(a.lng) : undefined, question: a.question || '', urgency: a.urgency || undefined });
      }
      case 'set_language': return app.setLang && app.setLang(a.lang === 'ms' ? 'ms' : 'en');
      case 'set_setting': {
        if (typeof a.mute === 'boolean') setMuted(a.mute);
        if (typeof a.large_text === 'boolean' && app.setBigText) app.setBigText(a.large_text);
        if (a.permissions) { closeAssistant(); requestPermissions({ force: true }); }
        return;
      }
      case 'logout': closeAssistant(); return app.logout && app.logout();
      // legacy single-action shapes (assistant.js) — still honoured
      case 'navigate': if (a.query) { const me = home(); const d = await C.api(`/api/geocode?q=${encodeURIComponent(a.query)}&lat=${me.lat}&lng=${me.lng}`).catch(() => ({ results: [] })); const hit = d.results[0]; if (!hit) { speak(t('place_not_found', { q: a.query }), r.lang); return; } await goMap(); return start({ to: hit, label: hit.name, need: C.S.me?.need || null }); } return;
      case 'find_places': await goMap(); return KBMap.showPlaces(a.kind && a.kind !== 'any' ? a.kind : 'any');
      case 'open_request': closeAssistant(); return app.openRequest && app.openRequest(a.id);
      case 'next_step': return sayStep(G.nav ? Math.min(G.nav.stepIdx + 1, G.nav.steps.length - 1) : 0, { force: true });
      case 'repeat': return sayStep(G.nav ? G.nav.stepIdx : 0, { force: true });
      case 'stop': return stop();
      case 'ask_community': closeAssistant(); return C.prefillAsk && C.prefillAsk({ name: a.query });
      default: return;
    }
  }
  function readAll() {
    if (!G.nav) return;
    const rest = G.nav.steps.slice(G.nav.stepIdx).map((s) => s.text).join('. ');
    speak(rest, lang());
  }

  // ---------- dock (floating mic / assistant panel / nav banner) ----------
  function buildDock() {
    if ($('#guideDock')) return;
    const d = document.createElement('div'); d.id = 'guideDock'; d.className = 'guide-dock hidden';
    d.innerHTML = `
      <div class="nav-banner hidden" id="navBanner" role="status" aria-live="polite">
        <div class="nb-main"><div class="nb-ico" id="nbIco"></div><div class="grow"><div class="nb-dist" id="nbDist">—</div><div class="nb-text" id="nbText">…</div></div><button class="icon-btn" id="nbMute" aria-label="mute"></button><button class="icon-btn" id="nbStop" aria-label="stop">${window.I ? I('x', 16) : '✕'}</button></div>
        <div class="nb-foot"><span id="nbRemain"></span><span class="grow"></span><button class="btn btn-sm btn-outline" id="nbSteps">${t ? '' : ''}</button><button class="btn btn-sm btn-black" id="nbArrived"></button></div>
      </div>
      <div class="assist hidden" id="assistPanel">
        <div class="as-head"><b>${window.I ? I('sparkle', 16) : ''} <span id="asTitle"></span></b><span class="muted" id="asModel"></span><button class="icon-btn" id="asClose">${window.I ? I('x', 16) : '✕'}</button></div>
        <div class="as-log" id="asLog"></div>
        <div class="as-chips" id="asChips"></div>
        <form class="as-input" id="asForm"><input id="asInput" autocomplete="off" /><button type="button" class="icon-btn" id="asMic" aria-label="mic"></button><button type="submit" class="btn btn-black btn-sm" id="asSend"></button></form>
      </div>
      <button class="mic-fab" id="micFab" aria-label="assistant"><span class="pulse"></span>${window.I ? I('mic', 22) : '🎤'}</button>`;
    document.body.appendChild(d);
    $('#micFab').onclick = () => { if ($('#assistPanel').classList.contains('hidden')) { openAssistant(); if (G.perms.microphone === 'granted' && SR) listen(); } else closeAssistant(); };
    $('#asClose').onclick = closeAssistant;
    $('#asMic').onclick = listen;
    $('#asForm').onsubmit = (e) => { e.preventDefault(); const v = $('#asInput').value.trim(); if (v) { $('#asInput').value = ''; ask(v); } };
    $('#nbStop').onclick = stop;
    $('#nbMute').onclick = () => { setMuted(!G.muted); $('#nbMute').innerHTML = window.I ? I(G.muted ? 'mute' : 'speaker', 18) : ''; };
    $('#nbSteps').onclick = showSteps;
    $('#nbArrived').onclick = () => arrive(true);
    relabel();
  }
  function relabel() {
    if (!$('#guideDock')) return;
    $('#asTitle').textContent = t('assistant'); $('#asInput').placeholder = t('ask_ph'); $('#asSend').textContent = t('send'); $('#nbSteps').textContent = t('all_steps'); $('#nbArrived').textContent = t('i_arrived');
    $('#asMic').innerHTML = window.I ? I('mic', 18) : '🎤'; $('#nbMute').innerHTML = window.I ? I(G.muted ? 'mute' : 'speaker', 18) : '';
    $('#asModel').textContent = C.S.meta?.ai ? 'Gemini' : t('ai_off_short');
    const chips = C.S.me?.role === 'oku' ? ['chip_nearby', 'chip_take_me', 'chip_accessible', 'chip_toilet'] : ['chip_nearby', 'chip_tasks', 'chip_take_me', 'chip_camera'];
    $('#asChips').innerHTML = chips.map((k) => `<button type="button" data-q="${esc(t(k + '_q'))}">${esc(t(k))}</button>`).join('');
    $$('#asChips button').forEach((b) => b.onclick = () => ask(b.dataset.q));
  }
  function showDock(on) { $('#guideDock').classList.toggle('hidden', !on); }
  function openAssistant() { $('#assistPanel').classList.remove('hidden'); $('#micFab').classList.add('open'); if (!G.log.length) logLine('bot', t('as_hello', { name: C.S.me ? C.S.me.name.split(' ')[0] : '' }), { silent: true }); $('#asInput').focus({ preventScroll: true }); }
  function closeAssistant() { $('#assistPanel').classList.add('hidden'); $('#micFab').classList.remove('open'); if (G.listening) try { G.rec.stop(); } catch {} }
  function setDockState(st) { const f = $('#micFab'); f.classList.toggle('listening', st === 'listening'); f.classList.toggle('thinking', st === 'thinking'); }
  function logLine(who, text, { silent = false } = {}) {
    G.log.push({ who, text }); if (G.log.length > 40) G.log.shift();
    const el = $('#asLog'); if (!el) return;
    el.insertAdjacentHTML('beforeend', `<div class="as-msg ${who}">${who === 'bot' ? `<span class="av">${window.I ? I('sparkle', 14) : ''}</span>` : ''}<span>${esc(text)}</span></div>`);
    el.scrollTop = el.scrollHeight;
    void silent;
  }

  // ---------- navigation ----------
  const remaining = () => { if (!G.nav) return 0; const s = G.nav.steps; let m = 0; for (let i = G.nav.stepIdx + 1; i < s.length; i++) m += s[i].distanceM || 0; const cur = s[G.nav.stepIdx]; if (cur && G.pos) m += Math.min(cur.distanceM || 0, Math.round(hav(G.pos, s[G.nav.stepIdx + 1] || G.nav.to))); return Math.round(m); };
  const fmtM = (m) => (m >= 950 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m / 5) * 5)} m`);
  const MAN_ICON = { start: 'compass', straight: 'arrowUp', slight_left: 'arrowUpLeft', slight_right: 'arrowUpRight', left: 'arrowL', right: 'arrowR', sharp_left: 'arrowL', sharp_right: 'arrowR', uturn: 'refresh', arrive: 'flag' };

  async function start({ to, label = '', need = null, requestId = null, request = null }) {
    stop({ silent: true });
    const from = G.pos || (await locate({ prompt: true })) || home();
    if (!G.pos && !C.S.geo) C.toast(t(G.geoError === 'blocked' ? 'geo_blocked' : G.geoError === 'denied' ? 'geo_denied' : 'geo_fallback', { area: (C.S.me && C.S.me.area) || 'KL Sentral' }), 'warn', 7000);
    showDock(true);
    $('#navBanner').classList.remove('hidden'); $('#nbText').textContent = t('routing'); $('#nbDist').textContent = '…'; $('#nbRemain').textContent = ''; $('#nbIco').innerHTML = window.I ? I('compass', 22) : '';
    if (C.S.route !== 'map') { location.hash = '#/map'; await new Promise((r) => setTimeout(r, 300)); }
    try {
      const d = await C.api(`/api/navigate?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}${need ? `&need=${need}` : ''}`);
      G.nav = { to, label: label || '', need, request, requestId, steps: d.steps, coords: d.coords, stepIdx: 0, distanceM: d.distanceM, durationMin: d.durationMin, engine: d.engine, warnings: d.warnings || [], spoken: new Set(), startedAt: Date.now(), simulated: false };
      KBMap.drawNav(d.coords, d.warnings);
      const intro = t('nav_intro', { place: label || t('destination'), dist: fmtM(d.distanceM), min: d.durationMin }) + (d.warnings.length ? ' ' + t('nav_warn', { n: d.warnings.length }) : '');
      speak(intro, lang());
      renderBanner();
      setTimeout(() => sayStep(0, { force: true, interrupt: false }), 300);
      offerSimulation(); // demo walk: always available (icon button), essential on laptops / when GPS is static
    } catch (err) { $('#nbText').textContent = t('route_fail'); C.toast(err.message, 'warn'); setTimeout(stop, 2500); }
  }
  function renderBanner() {
    if (!G.nav) return;
    const s = G.nav.steps[G.nav.stepIdx]; if (!s) return;
    const dToStep = G.pos && G.nav.steps[G.nav.stepIdx + 1] ? hav(G.pos, G.nav.steps[G.nav.stepIdx + 1]) : (s.distanceM || 0);
    $('#nbIco').innerHTML = window.I ? I(MAN_ICON[(G.nav.steps[G.nav.stepIdx + 1] || s).maneuver] || 'arrowUp', 24) : '';
    $('#nbDist').textContent = s.maneuver === 'arrive' ? t('arrived_short') : fmtM(dToStep);
    $('#nbText').textContent = (G.nav.steps[G.nav.stepIdx + 1] || s).text;
    $('#nbRemain').textContent = `${fmtM(remaining())} · ${Math.max(1, Math.round(remaining() / 72))} ${t('m')} · ${G.nav.engine === 'google' ? 'Google Routes' : t('engine_short')}`;
  }
  function sayStep(i, { force = false, interrupt = true } = {}) {
    if (!G.nav) return;
    const s = G.nav.steps[i]; if (!s) return;
    if (!force && G.nav.spoken.has(i)) return;
    G.nav.spoken.add(i);
    speak(s.text, lang(), { interrupt });
  }
  function onNavTick(p) {
    if (!G.nav) return;
    KBMap.followMe(p, p.heading);
    const n = G.nav; const next = n.steps[n.stepIdx + 1];
    if (!next) return;
    const d = hav(p, next);
    // announce upcoming manoeuvre at ~60 m, then advance when we pass it (<15 m)
    if (d < 60 && !n.spoken.has(n.stepIdx + 1)) sayStep(n.stepIdx + 1);
    if (d < 15) { n.stepIdx++; if (n.steps[n.stepIdx].maneuver === 'arrive' || n.stepIdx >= n.steps.length - 1) { arrive(false); return; } }
    if (hav(p, n.to) < 25) { arrive(false); return; }
    // off-route → re-route (max once per 20 s)
    const off = minDistToLine(p, n.coords);
    if (off > 45 && Date.now() - (n.lastReroute || 0) > 20000) { n.lastReroute = Date.now(); reroute(p); }
    renderBanner();
  }
  function minDistToLine(p, line) { let best = Infinity; for (let i = 1; i < line.length; i++) best = Math.min(best, distToSeg(p, line[i - 1], line[i])); return best; }
  function distToSeg(p, a, b) { const k = Math.cos(a.lat * Math.PI / 180) * 111320; const ax = a.lng * k, ay = a.lat * 111320, bx = b.lng * k, by = b.lat * 111320, px = p.lng * k, py = p.lat * 111320; const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1; const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)); return Math.hypot(px - (ax + u * dx), py - (ay + u * dy)); }
  async function reroute(p) {
    const n = G.nav; if (!n) return;
    try {
      const d = await C.api(`/api/navigate?from=${p.lat},${p.lng}&to=${n.to.lat},${n.to.lng}${n.need ? `&need=${n.need}` : ''}`);
      Object.assign(n, { steps: d.steps, coords: d.coords, stepIdx: 0, distanceM: d.distanceM, durationMin: d.durationMin, engine: d.engine, warnings: d.warnings || [], spoken: new Set() });
      KBMap.drawNav(d.coords, d.warnings); speak(t('rerouted'), lang()); sayStep(0, { interrupt: false }); renderBanner();
    } catch { /* keep old route */ }
  }
  function showSteps() {
    const n = G.nav; if (!n) return;
    C.openModal(`<h2>${ico('🧭', 20)} ${esc(n.label || t('destination'))}</h2><div class="muted">${fmtM(n.distanceM)} · ${n.durationMin} ${t('m')} · ${n.engine === 'google' ? 'Google Routes' : t('engine_short')}</div>
      ${n.warnings.length ? `<div class="card tight outline" style="margin:10px 0"><b>${ico('⚠️', 14)} ${t('nav_warn', { n: n.warnings.length })}</b><ul class="hitlist">${n.warnings.map((w) => `<li>${ico(w.icon, 14)} <span class="grow">${esc(w.label)}</span><span class="muted">${w.alongM} m</span></li>`).join('')}</ul></div>` : ''}
      <ol class="steps-list">${n.steps.map((s, i) => `<li class="${i === n.stepIdx ? 'cur' : i < n.stepIdx ? 'done' : ''}" data-i="${i}"><span class="mi">${window.I ? I(MAN_ICON[s.maneuver] || 'arrowUp', 16) : ''}</span><span class="grow">${esc(s.text)}</span><span class="muted">${s.distanceM ? fmtM(s.distanceM) : ''}</span></li>`).join('')}</ol>
      <div class="actions"><button class="btn btn-ghost" id="mClose">${t('close')}</button><button class="btn btn-black" id="mReadAll">${ico('🔊', 14)} ${t('read_all')}</button></div>`);
    $('#mClose').onclick = C.closeModal;
    $('#mReadAll').onclick = () => { speechSynthesis && speechSynthesis.cancel(); n.steps.forEach((s, i) => { const u = new SpeechSynthesisUtterance(`${i + 1}. ${s.text}`); u.lang = lang() === 'ms' ? 'ms-MY' : 'en-MY'; const v = pickVoice(lang()); if (v) u.voice = v; speechSynthesis.speak(u); }); };
    $$('.steps-list li').forEach((li) => li.onclick = () => sayStep(Number(li.dataset.i), { force: true }));
  }
  function arrive(manual) {
    const n = G.nav; if (!n) return;
    stopSim();
    speak(t('arrived_say', { place: n.label || t('destination') }), lang());
    const req = n.request;
    C.openModal(`<div class="reward"><div class="big">${ico('🏁', 34)}</div><h2 style="justify-content:center">${t('arrived_title')}</h2><p class="muted">${esc(n.label || '')}</p>
      <p style="font-size:14px">${req ? t('arrived_req', { q: req.question }) : t('arrived_sub')}</p>
      <button class="btn btn-black btn-block btn-lg" id="arrCam">${ico('📷', 18)} ${t('open_camera')}</button>
      <div class="actions" style="justify-content:center"><button class="btn btn-ghost" id="arrClose">${t('close')}</button></div></div>`);
    $('#arrCam').onclick = () => { C.closeModal(); openCamera({ request: req }); };
    $('#arrClose').onclick = C.closeModal;
    stop({ silent: true, keepDock: true });
    void manual;
  }
  function stop({ silent = false, keepDock = false } = {}) {
    stopSim();
    if (G.nav && !silent) speak(t('nav_stopped'), lang());
    G.nav = null;
    if ($('#navBanner')) $('#navBanner').classList.add('hidden');
    if (window.KBMap && KBMap.clearNav) KBMap.clearNav();
    void keepDock;
  }

  // demo walk (when there is no GPS, e.g. laptop): moves the blue dot along the route
  function offerSimulation() {
    const foot = $('#navBanner .nb-foot'); if (!foot || $('#nbSim')) return;
    $('#nbSteps').insertAdjacentHTML('beforebegin', `<button class="icon-btn sm" id="nbSim" title="${esc(t('simulate_walk'))}" aria-label="${esc(t('simulate_walk'))}">${ico('▶️', 14)}</button>`);
    $('#nbSim').onclick = () => { if (SIM.timer) stopSim(); else startSim(); };
  }
  function startSim() {
    const n = G.nav; if (!n) return;
    n.simulated = true; $('#nbSim').innerHTML = ico('⏸️', 14);
    let i = 0; const pts = n.coords; let carry = 0;
    SIM.timer = setInterval(() => {
      if (!G.nav) return stopSim();
      // ~2.2 m/s visual pace (fast walk) so a 900 m route plays in ~1.5 min
      carry += 2.2 * 0.6;
      while (i < pts.length - 1 && carry >= hav(pts[i], pts[i + 1])) { carry -= hav(pts[i], pts[i + 1]); i++; }
      if (i >= pts.length - 1) { setPos({ ...pts[pts.length - 1], heading: null }); return stopSim(); }
      const a = pts[i], b = pts[i + 1]; const seg = hav(a, b) || 1; const f = Math.min(1, carry / seg);
      const p = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, heading: bearing(a, b) };
      setPos(p);
    }, 600);
  }
  function stopSim() { if (SIM.timer) { clearInterval(SIM.timer); SIM.timer = null; } const b = $('#nbSim'); if (b) b.innerHTML = ico('▶️', 14); }
  function bearing(a, b) { const toR = (d) => d * Math.PI / 180; const y = Math.sin(toR(b.lng - a.lng)) * Math.cos(toR(b.lat)); const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) - Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lng - a.lng)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }

  // ---------- camera + AI assessment ----------
  let stream = null;
  function stopStream() { if (stream) { stream.getTracks().forEach((tr) => tr.stop()); stream = null; } }
  function onModalClosed() { stopStream(); }
  async function openCamera({ request = null, onResult = null } = {}) {
    const need = request?.need || C.S.me?.need || 'wheelchair';
    const place = request?.place || G.nav?.label || C.S.locName || '';
    const question = request?.question || '';
    C.openModal(`<div class="cam"><h2>${ico('📷', 20)} ${t('cam_title')}</h2><div class="muted">${question ? `“${esc(question)}”` : t('cam_sub')}${place ? ` · ${esc(place)}` : ''}</div>
      <div class="cam-view" id="camView"><video id="camVideo" autoplay playsinline muted></video><canvas id="camCanvas" class="hidden"></canvas><img id="camShot" class="hidden" alt="" /><div class="cam-frame"></div><div class="cam-hint" id="camHint">${t('cam_hint')}</div></div>
      <div class="cam-bar"><label class="btn btn-outline btn-sm" for="camFile">${ico('🖼️', 14)} ${t('cam_gallery')}<input type="file" id="camFile" accept="image/*" capture="environment" hidden /></label><button class="shutter" id="camShutter" aria-label="${t('cam_take')}"><i></i></button><button class="btn btn-outline btn-sm" id="camFlip">${ico('🔄', 14)} ${t('cam_flip')}</button></div>
      <div id="camResult"></div>
      <div class="actions"><button class="btn btn-ghost" id="camClose">${t('close')}</button></div></div>`);
    const video = $('#camVideo'); let facing = 'environment';
    const startCam = async () => {
      stopStream();
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 } }, audio: false }); video.srcObject = stream; G.perms.camera = 'granted'; savePerms(); $('#camHint').textContent = t('cam_hint'); }
      catch (err) { $('#camHint').textContent = t('cam_denied'); $('#camShutter').disabled = true; G.perms.camera = err && err.name === 'NotAllowedError' ? 'denied' : G.perms.camera; savePerms(); }
    };
    await startCam();
    const cleanup = () => { stopStream(); C.closeModal(); };
    $('#camClose').onclick = cleanup;
    $('#camFlip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCam(); };
    const analyse = async (dataUrl) => {
      $('#camShot').src = dataUrl; $('#camShot').classList.remove('hidden'); video.classList.add('hidden'); $('#camShutter').disabled = true; stopStream();
      $('#camResult').innerHTML = `<div class="ai-wait"><span class="spin"></span> ${t('ai_analysing')}</div>`;
      speak(t('ai_analysing'), lang());
      try {
        const r = await C.api('/api/assess', { method: 'POST', body: { photo: dataUrl, question, need, place, lang: lang() } });
        renderAssessment(r, { dataUrl, request, onResult, retake: () => { $('#camShot').classList.add('hidden'); video.classList.remove('hidden'); $('#camShutter').disabled = false; $('#camResult').innerHTML = ''; startCam(); } });
      } catch (err) { const msg = err.data?.detail && /quota|demand|rate/i.test(err.data.detail) ? t('ai_busy') : (err.data?.detail || err.message); $('#camResult').innerHTML = `<div class="err">${esc(msg)}</div><div class="actions"><button class="btn btn-outline btn-sm" id="camRetry">${t('retry')}</button></div>`; $('#camRetry').onclick = () => analyse(dataUrl); }
    };
    $('#camShutter').onclick = () => {
      const c = $('#camCanvas'); const w = video.videoWidth || 1280, h = video.videoHeight || 720; const scale = Math.min(1, 1280 / w); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      analyse(c.toDataURL('image/jpeg', 0.85));
    };
    $('#camFile').onchange = async (e) => { const f = e.target.files[0]; if (f) analyse(await C.fileToDataUrl(f, 1280)); };
  }
  function renderAssessment(r, { dataUrl, request, onResult, retake }) {
    const vClass = r.verdict === 'yes' ? 'good' : r.verdict === 'no' ? 'bad' : 'warn';
    const vIcon = r.verdict === 'yes' ? '✅' : r.verdict === 'no' ? '⛔' : r.verdict === 'partly' ? '⚠️' : '❓';
    $('#camResult').innerHTML = `<div class="ai-card">
      <div class="ai-head"><div class="ai-score ${r.score >= 60 ? '' : 'light'}">${r.score}</div><div class="grow"><b>${ico(vIcon, 16)} ${t('ai_verdict_' + (r.verdict || 'unclear'))}</b><div class="muted" style="font-size:12px">${t('ai_by', { m: (r.model || 'Gemini').replace(/^gemini-/, 'Gemini ') })} · ${Math.round((r.confidence || 0) * 100)}%</div></div></div>
      <p class="ai-sum">${esc(r.summary)}</p>
      ${r.findings.length ? `<ul class="ai-find">${r.findings.map((f) => `<li class="${f.status}">${ico(f.status === 'ok' ? '✅' : f.status === 'issue' ? '⛔' : '❓', 13)}<span><b>${esc(f.aspect)}</b> — ${esc(f.note)}</span></li>`).join('')}</ul>` : ''}
      ${r.hazards.length ? `<div class="muted" style="font-size:12px;margin-top:6px">${ico('⚠️', 12)} ${r.hazards.map(esc).join(' · ')}</div>` : ''}
      ${!r.relevant ? `<div class="err" style="margin-top:6px">${t('ai_irrelevant')}</div>` : ''}
    </div>
    <div class="actions" style="flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" id="aiRetake">${ico('🔄', 14)} ${t('retake')}</button>
      <button class="btn btn-outline btn-sm" id="aiSpeak">${ico('🔊', 14)} ${t('read_aloud')}</button>
      ${request && C.S.me?.role === 'helper' ? `<button class="btn btn-black grow" id="aiAnswer">${ico('✍️', 14)} ${t('use_as_answer')}</button>` : (r.suggestedReport && r.suggestedReport !== 'none' ? `<button class="btn btn-black grow" id="aiReport">${ico('📍', 14)} ${t('file_report')}</button>` : '')}
    </div>`;
    speak(r.summary, lang());
    $('#aiRetake').onclick = retake;
    $('#aiSpeak').onclick = () => speak(r.summary, lang());
    const aiAnswer = $('#aiAnswer');
    if (aiAnswer) aiAnswer.onclick = () => { stopStream(); C.closeModal(); const verdict = r.verdict === 'unclear' ? 'partly' : r.verdict; onResult ? onResult({ verdict, note: r.summary, photo: dataUrl, ai: r }) : C.answerWithAI && C.answerWithAI(request, { verdict, note: r.summary, photo: dataUrl, ai: r }); };
    const aiReport = $('#aiReport');
    if (aiReport) aiReport.onclick = () => { stopStream(); C.closeModal(); const pos = G.pos || C.S.geo || KBMap.me; location.hash = '#/map'; setTimeout(() => KBMap.openCreateWith && KBMap.openCreateWith({ lat: pos.lat, lng: pos.lng, type: r.suggestedReport, note: r.summary, photo: dataUrl }), 400); };
  }

  return { init, requestPermissions, locate, home, geoError: () => G.geoError, position, onPosition, watch, start, stop, ask, act, listen, speak, setMuted, openCamera, openAssistant, closeAssistant, onModalClosed, showDock, relabel, notify, get nav() { return G.nav; }, get perms() { return G.perms; }, get muted() { return G.muted; } };
})();
