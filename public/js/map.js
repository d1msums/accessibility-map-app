/* Map tab: real Google map (OSM fallback) + trust-decay pins, places around you, report/verify flows,
   accessibility router and the "take me there" navigation entry point.
   Exposes window.KBMap = { init, show, hide, openReport, setNeed, demoTrip, pickLocation, refresh, navigateTo, showPlaces, engine } */
window.KBMap = (() => {
  let C = null;            // context from app.js: { S, api, t, esc, toast, openModal, closeModal, showReward, refreshMe, fmtAgo, fmtDur, haversine }
  let map = null, reportLayer, routeLayer, placeLayer, navLayer, meMarker = null, wpFrom = null, wpTo = null;
  let ready = null;        // promise resolved when the engine exists
  const M = { reports: [], now: Date.now(), markers: new Map(), selected: null, me: null, need: '', route: { from: null, to: null, picking: null, result: null, active: 0 }, sort: 'trust', pickCb: null, inited: false, listOpen: false, places: [], placeKind: 'any', placesOpen: false, heading: null };
  const KL_SENTRAL = { lat: 3.13431, lng: 101.68637 };
  const MAB = { lat: 3.13214, lng: 101.69091 };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const wrap = () => $('#mapWrap');
  const scoreColor = (s) => (s >= 80 ? '#111111' : s >= 50 ? '#6b6b6b' : '#c2c2c2');
  const light = (hex) => (window.I && C && C.isLight ? C.isLight(hex) : false);
  const ico = (e, n = 16) => (window.I ? I.emoji(e, n) : e);

  function init(ctx) {
    C = ctx;
    if (M.inited) return ready;
    M.inited = true;
    const start = (window.KBGuide && KBGuide.position()) || C.S.geo || (window.KBGuide && KBGuide.home && KBGuide.home()) || KL_SENTRAL;
    ready = KBMapEngine.create($('#map'), {
      center: start, zoom: 16,
      onClick: (ll) => onMapClick(ll),
      onContextMenu: (ll) => openCreate(ll),
    }).then((eng) => {
      map = eng;
      routeLayer = KBMapEngine.group(); reportLayer = KBMapEngine.group(); placeLayer = KBMapEngine.group(); navLayer = KBMapEngine.group();
      wrap().classList.toggle('gmap', eng.kind === 'google');
      $('#mapEngine').textContent = eng.kind === 'google' ? 'Google Maps' : 'OpenStreetMap';
      bindUI();
      setMe(start);
      renderMarkers();
      if (M.pendingNav) { const n = M.pendingNav; M.pendingNav = null; navigateTo(n.to, n.label); }
      return eng;
    });
    return ready;
  }
  function show(container) {
    container.appendChild(wrap());
    ready && ready.then(() => setTimeout(() => map.invalidate(), 50));
    if (C.S.me && C.S.me.need && !M.need) setNeed(C.S.me.need);
    loadReports();
    const pos = window.KBGuide && KBGuide.position();
    if (pos) setMe(pos);
  }
  function hide() { $('#mapHost').appendChild(wrap()); closeSheet(); }
  function setNeed(need) { M.need = need || ''; $$('.need').forEach((b) => b.classList.toggle('active', b.dataset.need === M.need)); renderMarkers(); }
  async function refresh() { if (M.inited) await loadReports(); }

  // ---------- markers ----------
  const pinHtml = (r, selected) => `<div class="pin ${r.kind} ${r.trust < 20 ? 'dim' : ''} ${selected ? 'selected' : ''} ${light(r.color) ? 'light' : ''}" data-id="${r.id}" role="button" aria-label="${C.esc(r.label)} – ${C.esc(r.bandLabel)} (${r.trust})" style="background:${r.color}">${ico(r.icon, 15)}<span class="trust">${r.trust}</span></div>`;
  function renderMarkers() {
    if (!map) return;
    const visible = M.reports.filter((r) => !M.need || r.affects.includes(M.need));
    const keep = new Set();
    for (const r of visible) {
      keep.add(r.id);
      let m = M.markers.get(r.id);
      if (!m) { m = map.marker(r, { html: pinHtml(r, M.selected === r.id), size: [30, 30], z: r.kind === 'obstacle' ? 200 : 100, onClick: () => openReport(r.id) }); M.markers.set(r.id, m); }
      else { m.setHtml(pinHtml(r, M.selected === r.id)); m.setLatLng(r); }
    }
    for (const [id, m] of M.markers) if (!keep.has(id)) { m.remove(); M.markers.delete(id); }
  }
  async function loadReports() {
    const data = await C.api('/api/reports');
    M.reports = data.reports; M.now = data.now;
    renderMarkers();
    if (M.selected && $('#sheet').classList.contains('open')) { const r = byId(M.selected); if (r) renderReportSheet(r); }
    if (M.listOpen) renderList();
    if (M.placesOpen) renderPlaces();
  }
  const byId = (id) => M.reports.find((r) => r.id === id);
  const meHtml = () => `<div class="me-marker ${M.heading != null ? 'has-heading' : ''}" style="--h:${M.heading || 0}deg"><i></i></div>`;
  function setMe(ll, { fly = false, heading = null } = {}) {
    M.me = { lat: ll.lat, lng: ll.lng };
    if (heading != null) M.heading = heading;
    if (!map) return;
    if (!meMarker) meMarker = map.marker(M.me, { html: meHtml(), size: [22, 22], z: 500, interactive: false });
    else { meMarker.setLatLng(M.me); if (heading != null) meMarker.setHtml(meHtml()); }
    if (fly) map.flyTo(M.me, Math.max(map.getZoom(), 16));
  }
  let lastHeadingAt = 0;
  /** compass heading from the device (throttled to 4 Hz) */
  function setHeading(h) { const now = Date.now(); if (now - lastHeadingAt < 250) return; lastHeadingAt = now; M.heading = Math.round(h); if (meMarker) meMarker.setHtml(meHtml()); }

  // ---------- sheet ----------
  function openSheet(html) { const b = $('#sheetBody'); b.innerHTML = `<button class="close-x" id="sheetClose" aria-label="Close">${window.I ? I('x', 16) : '✕'}</button>${html}`; $('#sheet').classList.add('open'); b.scrollTop = 0; $('#sheetClose').onclick = closeSheet; }
  function closeSheet() {
    $('#sheet').classList.remove('open'); M.listOpen = false;
    if (M.selected) { const prev = M.selected; M.selected = null; const r = byId(prev); if (r) M.markers.get(prev)?.setHtml(pinHtml(r, false)); }
    M.placesOpen = false;
  }

  // ---------- report detail ----------
  function openReport(id) {
    const r = byId(id); if (!r) { C.toast(C.t('none'), 'warn'); return; }
    if (M.selected && M.selected !== id) { const p = byId(M.selected); if (p) M.markers.get(M.selected)?.setHtml(pinHtml(p, false)); }
    M.selected = id; M.listOpen = false;
    M.markers.get(id)?.setHtml(pinHtml(r, true));
    renderReportSheet(r);
    map.panTo(r);
  }
  function renderReportSheet(r) {
    const { t, esc, fmtAgo, fmtDur, S } = C;
    const mine = r.by && S.me && r.by.id === S.me.id;
    const volKey = { high: 'vol_high', medium: 'vol_medium', low: 'vol_low' }[r.volatility];
    const evid = [];
    evid.push(r.photo ? `<span class="ev on">${ico('📷', 13)} ${t('photo')} +15</span>` : `<span class="ev">${ico('📷', 13)} ${t('no_photo')}</span>`);
    if (r.photoCheck && r.photoCheck.ok) {
      if (r.photoCheck.flagged) evid.push(`<span class="ev bad">${ico('🤖', 13)} ${t('ai_flag')} −15</span>`);
      else if (r.photoCheck.ai && !r.photoCheck.ai.error) evid.push(`<span class="ev on">${ico('🤖', 13)} ${t('ai_ok')}${r.photoCheck.ai.sees ? ' · ' + esc(r.photoCheck.ai.sees) : ''}</span>`);
      else evid.push(`<span class="ev">${ico('🖼️', 13)} ${t('ai_off')}</span>`);
    }
    evid.push(`<span class="ev ${r.confirmations ? 'on' : ''}">${ico('✅', 13)} ${r.confirmations} ${t('confirms')}${r.confirmations ? ' +' + Math.min(15, r.confirmations * 7.5) : ''}</span>`);
    if (r.disputes) evid.push(`<span class="ev bad">${ico('❌', 13)} ${r.disputes} ${t('disputes')} −${r.disputes * 35}</span>`);
    const hist = r.history.slice().reverse().map((h) => {
      const label = h.kind === 'created' ? t('created') : h.kind === 'confirmed' ? t('confirmed') : h.kind === 'disputed' ? t('disputed') : t('removed');
      return `<li><b>${esc(h.byName || (r.by && h.by === r.by.id ? r.by.name : '') || '—')}</b> ${label}${h.onsite ? ` <span class="muted">(${t('onsite')})</span>` : ''}${h.note ? ` — <i>${esc(h.note)}</i>` : ''}<span class="muted" style="margin-left:auto">${fmtAgo(M.now - h.at)}</span></li>`;
    }).join('');
    const actions = `${mine ? `<div class="muted" style="margin-top:10px">${t('you_reported')}</div>` : `<div class="actions"><button class="btn btn-good" id="btnConfirm">${t('confirm')}</button><button class="btn btn-bad" id="btnDispute">${t('dispute')}</button></div>`}<button class="btn btn-outline btn-block" id="btnGoThere" style="margin-top:8px">${ico('🧭', 16)} ${t('take_me_there')}</button>`;
    openSheet(`
      <h2><span class="ic-wrap">${ico(r.icon, 22)}</span> ${esc(r.label)} <span class="chip ${r.kind === 'obstacle' ? 'bad' : 'good'}">${r.kind === 'obstacle' ? t('obstacles') : t('features')}</span></h2>
      <div class="muted">${esc(r.place)}</div>
      <div class="trustcard ${light(r.color) ? 'light' : ''}" style="background:${r.color}"><div class="big">${r.trust}<small>/100</small></div><div><div class="lbl">${esc(r.bandLabel)}</div><div class="sub">${t('verified_ago')}: ${fmtAgo(M.now - r.lastVerifiedAt)}${r.hoursToNextBand != null ? ` · ${t('next_band')}: ${fmtDur(r.hoursToNextBand)}` : ''}</div></div></div>
      ${r.photo ? `<img class="photo" src="${esc(r.photo)}" alt="" loading="lazy" />` : ''}
      ${r.note ? `<p style="margin:6px 0 2px;font-size:14px">“${esc(r.note)}”</p>` : ''}
      <div class="muted">${t('reported_by')} ${r.by ? `${C.AV ? C.AV(r.by, 22) : ''} ${esc(r.by.name)} · Lv ${r.by.level}` : '—'} · ${fmtAgo(M.now - r.createdAt)}</div>
      <h3>${t('evidence')}</h3><div class="evidence">${evid.join('')}</div>
      <div class="trustbar"><i style="width:${r.trust}%;background:${r.color}"></i></div>
      <div class="muted">${t('decay_note')} <b>${t(volKey)}</b> · ${t('affects')}: ${r.affects.map((n) => esc(S.meta.needs[n][S.lang].split(' /')[0])).join(', ')}</div>
      ${actions}
      <h3>${t('history')}</h3><ul class="timeline">${hist}</ul>`);
    const c = $('#btnConfirm'), d = $('#btnDispute');
    if (c) c.onclick = () => verifyFlow(r, 'confirm');
    if (d) d.onclick = () => verifyFlow(r, 'dispute');
    $('#btnGoThere').onclick = () => navigateTo(r, r.place);
  }
  async function verifyFlow(r, action) {
    const { t, esc } = C;
    const dist = M.me ? Math.round(C.haversine(M.me, r)) : null;
    if (action === 'confirm') return submitVerify(r, action, '', dist);
    C.openModal(`<h2>${t('verify_title')}</h2><div class="muted">${ico(r.icon, 14)} ${esc(r.label)} — ${esc(r.place)}</div>
      <div class="field"><label>${t('why_dispute')}</label><textarea id="vNote" placeholder="e.g. Lift has been repaired / motorcycles are gone"></textarea></div>
      ${dist != null && dist > 75 ? `<div class="muted">${ico('⚠️', 13)} ${t('too_far', { d: dist })}</div>` : ''}
      <div class="actions"><button class="btn btn-ghost" id="mCancel">${t('cancel')}</button><button class="btn btn-bad" id="mSend">${t('send')}</button></div>`);
    $('#mCancel').onclick = C.closeModal;
    $('#mSend').onclick = () => { const note = $('#vNote').value; C.closeModal(); submitVerify(r, action, note, dist); };
  }
  async function submitVerify(r, action, note, dist) {
    try {
      const out = await C.api(`/api/reports/${r.id}/verify`, { method: 'POST', body: { action, at: M.me, note } });
      await C.refreshMe();
      C.showReward(out.reward, action === 'confirm' ? C.t('confirmed') : C.t('disputed'), { onsite: out.reward.onsite, dist });
    } catch (err) { C.toast(err.data?.error === 'already_verified' ? C.t('already') : err.data?.error === 'own_report' ? C.t('you_reported') : err.message, 'warn'); }
  }

  // ---------- create report ----------
  function openCreate(latlng) {
    const { t, esc, S } = C;
    const ll = latlng || M.me || map.getCenter();
    const draft = { lat: ll.lat, lng: ll.lng, kind: 'obstacle', type: 'kerb_blocked', photo: null };
    const types = Object.entries(S.meta.types);
    const grid = (kind) => types.filter(([, v]) => v.kind === kind).map(([k, v]) => `<button data-type="${k}" class="${draft.type === k ? 'active' : ''}"><i>${ico(v.icon, 22)}</i>${esc(v.label)}</button>`).join('');
    const samples = ['kerb-blocked', 'lift-broken', 'construction', 'pavement', 'steps-only', 'ramp', 'lift-working', 'tactile', 'toilet', 'parking-blocked'];
    C.openModal(`<h2>${ico('📍', 20)} ${t('new_report')}</h2>
      <div class="field"><label>${t('where')}</label><input type="text" id="cPlace" placeholder="…" /><div class="muted">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div></div>
      <div class="field"><label>${t('what')}</label><div class="kindtabs"><button class="active obstacle" data-kind="obstacle">${ico('🚧', 16)} ${t('obstacles')}</button><button class="feature" data-kind="feature">${ico('♿', 16)} ${t('features')}</button></div><div class="typegrid" id="typeGrid">${grid('obstacle')}</div></div>
      <div class="field"><label>${t('add_photo')}</label><div class="photo-drop" id="photoDrop"><input type="file" accept="image/*" capture="environment" id="photoFile" /><span id="photoHint">${ico('📷', 18)} ${t('tap_photo')}</span></div><div class="muted" style="margin-top:6px">${t('or_sample')}</div><div class="samples" id="samples">${samples.map((s) => `<img src="/seed-photos/${s}.jpg" data-s="${s}" alt="" />`).join('')}</div></div>
      <div class="field"><label>${t('note')}</label><textarea id="cNote" placeholder="…"></textarea></div>
      <div class="pointsnote" id="ptsNote"></div>
      <div class="actions"><button class="btn btn-ghost" id="mCancel">${t('cancel')}</button><button class="btn btn-black" id="mSubmit">${t('submit')}</button></div>`);
    const updatePts = () => { const v = S.meta.types[draft.type]; const p = draft.photo ? (v.kind === 'obstacle' ? 15 : 10) : 5; $('#ptsNote').textContent = `+${p} ${t('pts')} ${draft.photo ? t('pts_photo') : t('pts_nophoto')}`; };
    updatePts();
    C.api(`/api/reverse?lat=${ll.lat}&lng=${ll.lng}`).then((d) => { if ($('#cPlace') && !$('#cPlace').value) $('#cPlace').value = d.name || ''; }).catch(() => {});
    const bindTypes = () => $$('#typeGrid button').forEach((b) => b.onclick = () => { $$('#typeGrid button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); draft.type = b.dataset.type; updatePts(); });
    $$('.kindtabs button').forEach((b) => b.onclick = () => { $$('.kindtabs button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); draft.kind = b.dataset.kind; draft.type = types.find(([, v]) => v.kind === draft.kind)[0]; $('#typeGrid').innerHTML = grid(draft.kind); bindTypes(); updatePts(); });
    bindTypes();
    const setPhoto = (dataUrl, srcEl) => { draft.photo = dataUrl; $('#photoDrop').classList.add('has'); $('#photoHint').innerHTML = `<img src="${dataUrl}" alt="" />`; $$('#samples img').forEach((i) => i.classList.toggle('sel', i === srcEl)); updatePts(); };
    $('#photoFile').onchange = async (e) => { const f = e.target.files[0]; if (f) setPhoto(await C.fileToDataUrl(f, 1280), null); };
    $$('#samples img').forEach((img) => img.onclick = async () => setPhoto(await C.urlToDataUrl(img.src), img));
    $('#mCancel').onclick = C.closeModal;
    $('#mSubmit').onclick = async () => {
      const btn = $('#mSubmit'); btn.disabled = true; btn.textContent = draft.photo ? t('submitting') : '…';
      try {
        const out = await C.api('/api/reports', { method: 'POST', body: { type: draft.type, lat: draft.lat, lng: draft.lng, place: $('#cPlace').value, note: $('#cNote').value, photo: draft.photo } });
        await C.refreshMe(); C.closeModal();
        await loadReports();
        setTimeout(() => { openReport(out.report.id); const el = M.markers.get(out.report.id)?.el?.firstChild; el && el.classList.add('pulse'); }, 200);
        setTimeout(() => C.showReward(out.reward, t('created')), 600);
      } catch (err) { btn.disabled = false; btn.textContent = t('submit'); C.toast(err.data?.summary || err.data?.reason || err.message, 'warn'); }
    };
  }

  // ---------- routing ----------
  function setFrom(ll, label) { M.route.from = ll; $('#fromInput').value = label || `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`; drawWaypoints(); }
  function setTo(ll, label) { M.route.to = ll; $('#toInput').value = label || `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`; drawWaypoints(); }
  const wpHtml = (cls, txt) => `<div class="wp-marker ${cls}"><span>${txt}</span></div>`;
  function drawWaypoints() {
    if (!map) return;
    if (M.route.from) { if (!wpFrom) wpFrom = map.marker(M.route.from, { html: wpHtml('from', 'A'), size: [28, 28], anchor: [4, 28], z: 600, interactive: false }); else wpFrom.setLatLng(M.route.from); }
    if (M.route.to) { if (!wpTo) wpTo = map.marker(M.route.to, { html: wpHtml('to', 'B'), size: [28, 28], anchor: [4, 28], z: 600, interactive: false }); else wpTo.setLatLng(M.route.to); }
  }
  async function planRoute() {
    const { t, esc } = C;
    if (!M.route.from || !M.route.to) { C.toast(M.route.from ? t('pick_to') : t('pick_from'), 'warn'); return; }
    openSheet(`<h2>${ico('🧭', 20)} ${t('route_title')}</h2><div class="muted">${t('routing')}</div>`);
    try {
      const res = await C.api(`/api/route?from=${M.route.from.lat},${M.route.from.lng}&to=${M.route.to.lat},${M.route.to.lng}${M.need ? `&need=${M.need}` : ''}`);
      M.route.result = res; M.route.active = 0;
      drawRoutes(); renderRouteSheet();
      map.fitBounds(res.routes.flatMap((r) => r.segments.flatMap((s) => s.coords.map(([lat, lng]) => ({ lat, lng })))), { padding: 40, paddingRight: window.innerWidth >= 900 ? 420 : 0, paddingBottom: window.innerWidth >= 900 ? 0 : 260 });
    } catch (err) { openSheet(`<h2>${ico('🧭', 20)} ${t('route_title')}</h2><div class="muted">${t('route_fail')}: ${esc(err.message)}</div>`); }
  }
  function drawRoutes() {
    routeLayer.clear();
    (M.route.result?.routes || []).forEach((r, idx) => {
      const active = idx === M.route.active;
      for (const seg of r.segments) {
        const pts = seg.coords.map(([lat, lng]) => ({ lat, lng }));
        const color = seg.status === 'obstacle' ? '#6b6b6b' : active ? '#111111' : '#a3a3a3';
        routeLayer.add(map.polyline(pts, { color: '#fff', weight: active ? 10 : 7, opacity: active ? .9 : .5, z: active ? 3 : 1 }));
        routeLayer.add(map.polyline(pts, { color, weight: active ? 6 : 4, opacity: active ? 1 : .8, dashed: seg.status === 'obstacle', z: active ? 4 : 2, onClick: () => { M.route.active = idx; drawRoutes(); renderRouteSheet(); } }));
      }
    });
  }
  function renderRouteSheet() {
    const { t, esc, fmtAgo, S } = C;
    const res = M.route.result; if (!res) return;
    const r = res.routes[M.route.active];
    const vKey = { accessible: 'v_accessible', likely_clear_unverified: 'v_unverified', stale_obstacles: 'v_stale', caution: 'v_caution', blocked: 'v_blocked' }[r.verdict];
    const vSubKey = { accessible: 'v_sub_accessible', likely_clear_unverified: 'v_sub_unverified', stale_obstacles: 'v_sub_stale', caution: 'v_sub_caution', blocked: 'v_sub_blocked' }[r.verdict];
    const vLight = r.verdict !== 'accessible';
    const engine = res.engine === 'kitabantu' ? `<span class="ev on">${ico('🧠', 13)} ${t('engine_local')}</span>` : res.engine === 'osrm' ? `<span class="ev warn">${ico('🌐', 13)} ${t('engine_osrm')}</span>` : `<span class="ev bad">${ico('📏', 13)} ${t('engine_line')}</span>`;
    const opts = res.routes.map((o, i) => `<div class="route-opt ${i === M.route.active ? 'sel' : ''}" data-i="${i}"><div class="score ${o.score < 50 ? 'light' : ''}" style="background:${scoreColor(o.score)}">${o.score}</div><div class="grow"><b>${t(o.role)}</b>${o.detour ? ` <span class="chip">${t('detour')}</span>` : ''}<div class="meta">${o.distanceM} m · ${o.durationMin} ${t('m')} · ${o.hits.length} ${t('obstacles').toLowerCase()}${o.flags && o.flags.steps && !o.flags.stepsUnlocked && M.need === 'wheelchair' ? ` · ${ico('🪜', 12)} ${o.flags.steps}` : ''}</div></div><div>${ico(o.hits.length ? '⚠️' : '✅', 20)}</div></div>`).join('');
    const hits = r.hits.length ? r.hits.map((h) => `<li><span class="trustchip ${light(h.color) ? 'light' : ''}" style="background:${h.color}">${h.trust}</span> ${ico(h.icon, 14)} <span class="grow">${esc(h.label)} <span class="muted">· ${h.alongM} m in</span></span><button class="btn-mini" data-open="${h.reportId}">↗</button></li>`).join('') : `<li class="muted">${t('none')}</li>`;
    const feats = r.features.length ? r.features.map((f) => `<li>${ico(f.icon, 14)} <span class="grow">${esc(f.label)} <span class="muted">· ${f.alongM} m in</span></span><button class="btn-mini" data-open="${f.reportId}">↗</button></li>`).join('') : `<li class="muted">${t('none')}</li>`;
    const unlocked = r.flags?.unlockedByReports?.length ? `<div class="card tight" style="border:1.5px solid #111;box-shadow:none;margin-top:8px"><b>${ico('🛗', 14)} ${t('unlocked_title')}</b><div class="muted">${t('unlocked_body')}</div>${r.flags.unlockedByReports.map((u) => `<div class="row" style="margin-top:6px"><span class="trustchip" style="background:${u.color}">${u.trust}</span><span class="grow" style="font-size:13px">${esc(u.place)}</span><button class="btn-mini" data-open="${u.reportId}">↗</button></div>`).join('')}</div>` : '';
    const hint = res.unlockHint?.reports?.length ? `<div class="card tight" style="border:1.5px dashed #111;box-shadow:none;margin-top:8px"><b>${ico('⏳', 14)} ${t('hint_title', { d: res.unlockHint.distanceM })}</b><div class="muted">${t('hint_body', { min: res.unlockHint.minTrust })}</div>${res.unlockHint.reports.map((u) => `<div class="row" style="margin-top:6px"><span class="trustchip" style="background:${u.color}">${u.trust}</span><span class="grow" style="font-size:13px">${esc(u.place)} · ${fmtAgo(u.hoursSinceVerified * 36e5)}</span><button class="btn-mini" data-open="${u.reportId}">${t('recheck')} ↗</button></div>`).join('')}</div>` : '';
    const notes = [];
    if (r.flags) { if (r.flags.noSidewalk > 60) notes.push(`${ico('🚗', 13)} ${r.flags.noSidewalk} m ${t('no_sidewalk')}`); if (r.flags.steps && !r.flags.stepsUnlocked) notes.push(`${ico('🪜', 13)} ${r.flags.steps} ${t('stairs_on_route')}`); }
    if (r.streets?.length) notes.push(`${ico('🛣️', 13)} ${r.streets.map(esc).join(' → ')}`);
    openSheet(`<h2>${ico('🧭', 20)} ${t('route_title')} ${M.need ? `<span class="chip dark">${esc(S.meta.needs[M.need][S.lang])}</span>` : ''}</h2>
      <div class="verdict ${vLight ? 'light' : ''}"><div class="v-title">${t(vKey)} · ${r.score}/100</div><div class="v-sub">${t(vSubKey)}</div></div>
      <div class="row"><span class="muted">${t('coverage')}</span><div class="covbar"><i style="width:${r.coverage}%"></i></div><b style="font-size:13px">${r.coverage}%</b></div>
      <div class="evidence" style="margin-top:6px">${engine}</div>
      ${res.note ? `<div class="muted">${ico('⚠️', 13)} ${esc(res.note)}</div>` : ''}${opts}${unlocked}${hint}
      ${notes.length ? `<div class="muted" style="margin:8px 0">${notes.join('<br>')}</div>` : ''}
      <button class="btn btn-black btn-block btn-lg" id="btnStartNav" style="margin-top:10px">${ico('🧭', 18)} ${t('start_nav')}</button>
      <h3>${t('obstacles_on')}</h3><ul class="hitlist">${hits}</ul><h3>${t('features_on')}</h3><ul class="hitlist">${feats}</ul>`);
    $$('.route-opt').forEach((el) => el.onclick = () => { M.route.active = Number(el.dataset.i); drawRoutes(); renderRouteSheet(); });
    $('#btnStartNav').onclick = () => navigateTo(M.route.to, $('#toInput').value || null);
    $$('[data-open]', $('#sheetBody')).forEach((b) => b.onclick = (e) => { e.stopPropagation(); openReport(b.dataset.open); });
  }
  /** Agent: draw a route comparison between two points (no guidance). */
  async function showRoute(from, to, { fromLabel = '', toLabel = '', need = null } = {}) {
    if (!map) await ready;
    if (need) setNeed(need);
    $('#routeRow').classList.remove('hidden');
    setFrom(from, fromLabel); setTo(to, toLabel);
    await planRoute();
  }
  function demoTrip() {
    setNeed('wheelchair'); setMe(KL_SENTRAL);
    $('#routeRow').classList.remove('hidden');
    setFrom(KL_SENTRAL, 'KL Sentral'); setTo(MAB, 'Malaysian Association for the Blind');
    planRoute();
  }

  // ---------- list ----------
  function renderList() {
    const { t, esc, fmtAgo } = C;
    M.listOpen = true;
    let list = M.reports.filter((r) => !M.need || r.affects.includes(M.need));
    list = M.sort === 'trust' ? list.sort((a, b) => a.trust - b.trust) : list.sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt);
    openSheet(`<h2>${ico('📋', 20)} ${t('reports_list')} <span class="muted">(${list.length})</span></h2>
      <div class="tabs"><button class="${M.sort === 'trust' ? 'active' : ''}" data-s="trust">${t('sort_trust')}</button><button class="${M.sort === 'recent' ? 'active' : ''}" data-s="recent">${t('sort_recent')}</button></div>
      ${list.map((r) => `<div class="list-item" data-id="${r.id}"><div class="ic ${r.kind} ${light(r.color) ? 'light' : ''}" style="background:${r.color}">${ico(r.icon, 18)}</div><div class="t"><b>${esc(r.label)}</b><span>${esc(r.place)} · ${fmtAgo(M.now - r.lastVerifiedAt)}</span></div><div class="n">${r.trust}</div></div>`).join('')}`);
    $$('.tabs button', $('#sheetBody')).forEach((b) => b.onclick = () => { M.sort = b.dataset.s; renderList(); });
    $$('.list-item', $('#sheetBody')).forEach((el) => el.onclick = () => openReport(el.dataset.id));
  }

  // ---------- pick a location (used by the OKU "Ask" form) ----------
  function pickLocation(cb) {
    M.pickCb = cb;
    const h = document.createElement('div'); h.className = 'map-hint'; h.id = 'mapHint'; h.textContent = C.t('pick_report'); wrap().appendChild(h);
  }

  // ---------- search ----------
  function bindSearch(input, target) {
    const suggest = $('#suggest'); let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim(); if (q.length < 2) { suggest.classList.add('hidden'); return; }
      timer = setTimeout(async () => {
        try {
          const me = M.me || C.S.geo; const d = await C.api(`/api/geocode?q=${encodeURIComponent(q)}${me ? `&lat=${me.lat}&lng=${me.lng}` : ''}`);
          suggest.innerHTML = d.results.map((r, i) => `<li data-i="${i}"><span>${C.esc(r.name)}</span><small>${C.esc(r.display.split(',').slice(1, 4).join(','))}</small></li>`).join('') || `<li class="muted">—</li>`;
          suggest.classList.remove('hidden');
          $$('li', suggest).forEach((li) => li.onclick = () => { const r = d.results[Number(li.dataset.i)]; if (!r) return; suggest.classList.add('hidden'); if (target === 'from') setFrom(r, r.name); else if (target === 'to') setTo(r, r.name); else { map.flyTo(r, 17); input.value = r.name; openPlace({ ...(r.place || { name: r.name, address: r.display, lat: r.lat, lng: r.lng, accessibility: {}, community: null }), lat: r.lat, lng: r.lng }); } });
        } catch { suggest.classList.add('hidden'); }
      }, 350);
    });
  }

  async function onMapClick(ll) {
    const { t } = C;
    if (M.pickCb) { const cb = M.pickCb; M.pickCb = null; $('#mapHint')?.remove(); let name = ''; try { name = (await C.api(`/api/reverse?lat=${ll.lat}&lng=${ll.lng}`)).name; } catch {} cb({ lat: ll.lat, lng: ll.lng, name }); return; }
    if (M.route.picking === 'report') { M.route.picking = null; $('#fabReport').classList.remove('picking'); $('#fabReport .fab-label').textContent = t('report'); openCreate(ll); return; }
    if (M.route.picking === 'from') { setFrom(ll); M.route.picking = null; }
    else if (M.route.picking === 'to') { setTo(ll); M.route.picking = null; }
    else if (!$('#routeRow').classList.contains('hidden') && !M.route.to && M.route.from) setTo(ll);
    else if (!$('#routeRow').classList.contains('hidden') && !M.route.from) setFrom(ll);
  }
  function bindUI() {
    const { t } = C;
    $('#routeToggle').onclick = () => { $('#routeRow').classList.toggle('hidden'); if (!$('#routeRow').classList.contains('hidden') && !M.route.from && M.me) setFrom(M.me, t('my_location')); };
    $('#fromInput').onfocus = () => { M.route.picking = 'from'; C.toast(t('pick_from')); };
    $('#toInput').onfocus = () => { M.route.picking = 'to'; C.toast(t('pick_to')); };
    $('#routeGo').onclick = planRoute;
    $$('.need').forEach((b) => b.onclick = () => { setNeed(b.dataset.need); if (M.listOpen) renderList(); if (M.route.result) planRoute(); });
    $('#fabReport').onclick = () => {
      if (M.route.picking === 'report') { M.route.picking = null; $('#fabReport').classList.remove('picking'); $('#fabReport .fab-label').textContent = t('report'); return; }
      M.route.picking = 'report'; $('#fabReport').classList.add('picking'); $('#fabReport .fab-label').textContent = t('cancel'); C.toast(`${ico('📍', 14)} ${t('pick_report')}`, 'good');
    };
    $('#fabList').onclick = () => (M.listOpen ? closeSheet() : renderList());
    $('#fabPlaces').onclick = () => (M.placesOpen ? closeSheet() : showPlaces());
    $('#fabLocate').onclick = async () => {
      const pos = window.KBGuide ? await KBGuide.locate({ prompt: true }) : null;
      if (pos) { setMe(pos, { fly: true }); C.toast(`${ico('📍', 14)} ${t('located')}`, 'good'); }
      else { const why = window.KBGuide && KBGuide.geoError && KBGuide.geoError(); setMe(M.me || (window.KBGuide && KBGuide.home ? KBGuide.home() : KL_SENTRAL), { fly: true }); C.toast(t(why === 'blocked' ? 'geo_blocked' : why === 'denied' ? 'geo_denied' : 'locate_fail', { area: (C.S.me && C.S.me.area) || 'KL' }), 'warn', 7000); }
    };
    $('#sheetHandle').onclick = closeSheet;
    bindSearch($('#searchInput'), 'search'); bindSearch($('#fromInput'), 'from'); bindSearch($('#toInput'), 'to');
    document.addEventListener('click', (e) => { if (!e.target.closest('.searchbar')) $('#suggest').classList.add('hidden'); });
    if (window.KBGuide) KBGuide.onPosition((p) => { const first = !M.me; setMe(p, { heading: p.heading, fly: first && !M.nav }); });
  }

  // ---------- places around you (Google Places / OSM) ----------
  const KIND_ICON = { any: '📍', mall: '🛍️', transit: '🚉', hospital: '🏥', toilet: '🚻', parking: '🅿️', restaurant: '🍽️', pharmacy: '💊', mosque: '🕌', bank: '🏦' };
  const placeIcon = (p) => { const ty = String(p.type || ''); if (/mall|supermarket|store|shop/.test(ty)) return '🛍️'; if (/transit|station|bus|train|subway|rail/.test(ty)) return '🚉'; if (/hospital|clinic|doctor|medical/.test(ty)) return '🏥'; if (/toilet|bathroom/.test(ty)) return '🚻'; if (/parking/.test(ty)) return '🅿️'; if (/restaurant|cafe|food/.test(ty)) return '🍽️'; if (/pharmacy|drug/.test(ty)) return '💊'; if (/mosque|worship|church|temple/.test(ty)) return '🕌'; if (/bank|atm/.test(ty)) return '🏦'; if (/university|college|school/.test(ty)) return '🎓'; if (/hotel|lodging/.test(ty)) return '🏨'; return '📍'; };
  const accLabel = (v, yesK, noK) => (v === true ? `<span class="chip good">${ico('✅', 11)} ${C.t(yesK)}</span>` : v === false ? `<span class="chip bad">${ico('⛔', 11)} ${C.t(noK)}</span>` : v === 'limited' ? `<span class="chip warn">${ico('⚠️', 11)} ${C.t('acc_limited')}</span>` : '');
  function accChips(p) {
    const a = p.accessibility || {};
    const chips = [accLabel(a.entrance, 'acc_entrance_yes', 'acc_entrance_no'), accLabel(a.restroom, 'acc_toilet_yes', 'acc_toilet_no'), accLabel(a.parking, 'acc_parking_yes', 'acc_parking_no'), accLabel(a.seating, 'acc_seating_yes', 'acc_seating_no')].filter(Boolean);
    if (!chips.length) chips.push(`<span class="chip ghost">${ico('❓', 11)} ${C.t('acc_unknown')}</span>`);
    return chips.join('');
  }
  async function showPlaces(kind, query = '') {
    const { t, esc } = C;
    if (!map) { await ready; }
    if (kind) M.placeKind = kind;
    M.placeQuery = query || '';
    M.placesOpen = true; M.listOpen = false;
    const me = M.me || map.getCenter();
    openSheet(`<h2>${ico('🧭', 20)} ${t('around_you')}</h2><div class="muted">${t('loading')}</div>`);
    try {
      const d = await C.api(`/api/places?lat=${me.lat}&lng=${me.lng}&kind=${M.placeKind}&radius=${M.placeQuery ? 6000 : 1500}${M.placeQuery ? `&q=${encodeURIComponent(M.placeQuery)}` : ''}`);
      M.places = d.places; M.placesSource = d.source;
      drawPlaces();
      renderPlaces();
      if (M.places.length) map.fitBounds([me, ...M.places.slice(0, 12)], { padding: 60, paddingBottom: window.innerWidth >= 900 ? 0 : 260 });
    } catch (err) { openSheet(`<h2>${ico('🧭', 20)} ${t('around_you')}</h2><div class="muted">${esc(err.message)}</div>`); }
  }
  function drawPlaces() {
    placeLayer.clear();
    M.places.slice(0, 30).forEach((p) => placeLayer.add(map.marker(p, { html: `<div class="place-pin" title="${C.esc(p.name)}">${ico(placeIcon(p), 14)}</div>`, size: [26, 26], z: 50, onClick: () => openPlace(p) })));
  }
  function renderPlaces() {
    const { t, esc } = C;
    const kinds = Object.keys(KIND_ICON);
    openSheet(`<h2>${ico('🧭', 20)} ${t('around_you')} <span class="muted">(${M.places.length})</span></h2>
      <div class="muted" style="font-size:12px">${M.placesSource === 'google' ? t('src_google') : t('src_osm')}</div>
      <div class="kindscroll">${kinds.map((k) => `<button class="${k === M.placeKind ? 'active' : ''}" data-k="${k}">${ico(KIND_ICON[k], 14)} ${t('kind_' + k)}</button>`).join('')}</div>
      ${M.places.length ? M.places.slice(0, 30).map((p, i) => `<div class="list-item place" data-i="${i}"><div class="ic feature light" style="background:#fff">${ico(placeIcon(p), 18)}</div><div class="t"><b>${esc(p.name)}</b><span>${p.distM != null ? `${p.distM} m · ` : ''}${esc(p.typeLabel || p.type.replace(/_/g, ' '))}${p.openNow === true ? ` · ${t('open_now')}` : p.openNow === false ? ` · ${t('closed_now')}` : ''}</span><div class="wrap" style="margin-top:4px">${accChips(p)}${p.community && p.community.reports ? `<span class="chip dark">${ico('👥', 11)} ${p.community.reports} ${t('reports_word')}</span>` : ''}</div></div>${ico('›', 16)}</div>`).join('') : `<div class="empty">${t('none')}</div>`}`);
    $$('.kindscroll button', $('#sheetBody')).forEach((b) => b.onclick = () => showPlaces(b.dataset.k));
    $$('.list-item.place', $('#sheetBody')).forEach((el) => el.onclick = () => openPlace(M.places[Number(el.dataset.i)]));
  }
  function openPlace(p) {
    const { t, esc } = C;
    map.panTo(p);
    const com = p.community;
    openSheet(`<h2>${ico(placeIcon(p), 22)} ${esc(p.name)}</h2><div class="muted">${esc(p.address || '')}${p.distM != null ? ` · ${p.distM} m` : ''}</div>
      <div class="card tight outline" style="margin-top:10px"><b style="font-size:13px">${t('acc_facts')} <span class="muted">· ${p.source === 'google' ? 'Google' : 'OpenStreetMap'}</span></b><div class="wrap" style="margin-top:6px">${accChips(p)}</div>${p.accessibility?.description ? `<div class="muted" style="margin-top:6px">${esc(p.accessibility.description)}</div>` : ''}${p.rating ? `<div class="muted" style="margin-top:6px">${ico('⭐', 12)} ${p.rating} (${p.ratings})</div>` : ''}</div>
      <div class="card tight outline" style="margin-top:8px"><b style="font-size:13px">${t('community_says')}</b>${com && com.top && com.top.length ? `<ul class="hitlist">${com.top.map((r) => `<li><span class="trustchip ${r.trust < 50 ? 'light' : ''}" style="background:${r.trust >= 80 ? '#111' : r.trust >= 50 ? '#6b6b6b' : '#e5e5e5'}">${r.trust}</span> ${ico(r.icon, 14)} <span class="grow">${esc(r.label)}</span><button class="btn-mini" data-open="${r.id}">↗</button></li>`).join('')}</ul>` : `<div class="muted" style="margin-top:4px">${t('no_reports_here')}</div>`}</div>
      <div class="actions" style="margin-top:10px"><button class="btn btn-black btn-block btn-lg" id="plGo">${ico('🧭', 18)} ${t('take_me_there')}</button></div>
      <div class="actions"><button class="btn btn-outline" id="plAsk">${ico('💬', 14)} ${t('ask_about')}</button><button class="btn btn-outline" id="plReport">${ico('📍', 14)} ${t('report_here')}</button></div>`);
    $('#plGo').onclick = () => navigateTo(p, p.name);
    $('#plAsk').onclick = () => { location.hash = '#/ask'; setTimeout(() => window.KBApp && KBApp.prefillAsk({ name: p.name, lat: p.lat, lng: p.lng }), 250); };
    $('#plReport').onclick = () => openCreate(p);
    $$('[data-open]', $('#sheetBody')).forEach((b) => b.onclick = (e) => { e.stopPropagation(); openReport(b.dataset.open); });
  }

  // ---------- navigation entry point (the guide does the actual turn-by-turn) ----------
  function navigateTo(to, label) {
    if (!map) { M.pendingNav = { to, label }; return; }
    closeSheet();
    if (window.KBGuide) KBGuide.start({ to: { lat: to.lat, lng: to.lng }, label: label || to.place || to.name || '', need: M.need || C.S.me?.need || null });
  }
  function drawNav(coords, warnings) {
    navLayer.clear();
    if (!coords || !coords.length) return;
    navLayer.add(map.polyline(coords, { color: '#fff', weight: 11, opacity: .95, z: 5 }));
    navLayer.add(map.polyline(coords, { color: '#111', weight: 6, opacity: 1, z: 6 }));
    navLayer.add(map.marker(coords[coords.length - 1], { html: wpHtml('to', 'B'), size: [28, 28], anchor: [4, 28], z: 600, interactive: false }));
    (warnings || []).forEach((w) => navLayer.add(map.marker(w, { html: `<div class="pin obstacle light" style="background:#fff">${ico(w.icon || '⚠️', 15)}<span class="trust">${w.trust}</span></div>`, size: [30, 30], z: 300, onClick: () => openReport(w.reportId) })));
    map.fitBounds(coords, { padding: 50, paddingBottom: window.innerWidth >= 900 ? 0 : 200 });
  }
  function clearNav() { navLayer && navLayer.clear(); }
  let hlMarker = null;
  /** Agent: drop a labelled highlight pin and fly there (no navigation). */
  function highlight(ll, label = '', zoom = 17) {
    if (!map) return;
    if (hlMarker) { hlMarker.remove(); hlMarker = null; }
    hlMarker = map.marker(ll, { html: `<div class="hl-pin"><span class="dot"></span>${label ? `<span class="lbl">${C.esc(label)}</span>` : ''}</div>`, size: [24, 24], anchor: [12, 12], z: 700, onClick: () => { if (window.KBGuide) KBGuide.start({ to: ll, label }); } });
    map.flyTo(ll, zoom);
    setTimeout(() => { if (hlMarker) { hlMarker.remove(); hlMarker = null; } }, 60000);
  }
  function zoom(delta) { if (map) map.setView(map.getCenter(), Math.max(10, Math.min(20, map.getZoom() + delta))); }
  function followMe(ll, heading) { if (!map) return; setMe(ll, { heading }); map.panTo(ll); }

  return { init, show, hide, openReport, setNeed, demoTrip, pickLocation, refresh, navigateTo, showPlaces, openPlace, drawNav, clearNav, followMe, setMe, highlight, zoom, setHeading, showRoute, get _places() { return M.places; }, get me() { return M.me; }, get engine() { return map ? map.kind : null; }, replan: () => { if (M.route.result) planRoute(); }, flyTo: (ll, z = 17) => { if (map) map.flyTo({ lat: ll.lat, lng: ll.lng }, z); } };
})();
