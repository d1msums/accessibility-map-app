/* KitaBantu front-end — calm monochrome UI. auth + avatar builder + role dashboards (helper / oku) + requests + community + profile + map tab. Vanilla JS, hash router. */
(() => {
  'use strict';
  // Storage that never throws: browsers with strict privacy settings (or an embedded preview) block localStorage → fall back to memory
  const MEM = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch { /* blocked */ } return k in MEM ? MEM[k] : null; },
    set(k, v) { MEM[k] = v; try { localStorage.setItem(k, v); } catch { /* blocked: memory only */ } },
    del(k) { delete MEM[k]; try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  window.KBStore = store;
  const S = { lang: store.get('kb.lang') || 'en', token: store.get('kb.token') || null, me: null, meta: null, route: 'home', big: store.get('kb.big') === '1', lbPeriod: 'week', lbArea: '', reqFilter: 'open', reqSort: 'newest', geo: null, es: null };
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const t = (k, vars) => { let s = (window.I18N[S.lang] || {})[k] ?? window.I18N.en[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b); return s; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (path, opts = {}) => {
    const sep = path.includes('?') ? '&' : '?';
    const live = store.get('kb.token'); if (live && live !== S.token) S.token = live;   // another tab may have (re)logged in
    const headers = { 'Content-Type': 'application/json' }; if (S.token) headers.Authorization = `Bearer ${S.token}`;
    const res = await fetch(`${path}${sep}lang=${S.lang}`, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.token && !path.startsWith('/api/auth')) {
      const live = store.get('kb.token');
      if (live && live !== S.token) { S.token = live; return api(path, opts); }               // token changed under us → retry once with the new one
      sessionLost();
    }
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
    return data;
  };
  const errMsg = (err) => { const k = `err_${err?.data?.error || ''}`; return window.I18N.en[k] ? t(k) : (err?.data?.reason || err?.message || t('err_generic')); };
  function fmtAgo(ms) { const m = Math.max(0, Math.round(ms / 60000)); if (m < 1) return t('now'); if (m < 60) return `${m} ${t('m')} ${t('ago')}`; const h = Math.round(m / 60); if (h < 48) return `${h} ${t('h')} ${t('ago')}`; return `${Math.round(h / 24)} ${t('d')} ${t('ago')}`; }
  function fmtDur(h) { if (h < 1) return `${Math.max(1, Math.round(h * 60))} ${t('m')}`; if (h < 48) return `${Math.round(h)} ${t('h')}`; return `${Math.round(h / 24)} ${t('d')}`; }
  function haversine(a, b) { const R = 6371000, toR = (d) => d * Math.PI / 180; const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
  const first = (n) => String(n || '').split(' ')[0];
  const greet = () => { const h = new Date().getHours(); return t(h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'); };
  const NEED_ICON = { wheelchair: 'wheelchair', visual: 'cane', elderly: 'elderly' };
  const needIcon = (n, size = 16) => (NEED_ICON[n] ? I(NEED_ICON[n], size) : '');
  const needLabel = (n) => (S.meta?.needs?.[n]?.[S.lang] || n);
  const urgClass = (q) => (q.urgency === 'today' && q.status === 'open' ? 'urgent' : '');
  const dist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m');
  const KL_SENTRAL = { lat: 3.13431, lng: 101.68637 };
  const QUICK_ALL = [['DPulze', 2.92207, 101.65112], ['Shaftsbury Square', 2.92327, 101.66191], ['Hospital Cyberjaya', 2.92045, 101.63159], ['Gem In Mall', 2.92226, 101.63482], ['MMU', 2.92787, 101.64224], ['City University', 2.92300, 101.65426], ['Hospital Putrajaya', 2.92945, 101.67447], ['Taman Tasik Cyberjaya', 2.93798, 101.64417],
    ['KL Sentral', 3.13431, 101.68637], ['Nu Sentral', 3.13328, 101.68699], ['LRT Pasar Seni', 3.14246, 101.69531], ['Central Market', 3.14408, 101.69545], ['MRT Muzium Negara', 3.13710, 101.68738], ['Mid Valley', 3.11766, 101.67737], ['LRT Bangsar', 3.12761, 101.67910], ['MRT Bukit Bintang', 3.14779, 101.71087]];
  // quick picks follow the user: nearest 8 to the current position (Cyberjaya set when near Cyberjaya, KL set otherwise)
  const quickPlaces = () => { const g = S.geo || (window.KBGuide && KBGuide.position && KBGuide.position()) || (window.KBGuide && KBGuide.home ? KBGuide.home() : KL_SENTRAL); return QUICK_ALL.map((q) => [q, haversine(g, { lat: q[1], lng: q[2] })]).sort((a, b) => a[1] - b[1]).slice(0, 8).map((x) => x[0]); };
  /** avatar chip: size in px, user-like object {avatar, color} */
  const AV = (u, size = 40, extra = '') => {
    const pp = window.KBPeeps && KBPeeps.ready() ? KBPeeps.forUser(u, S.me) : null;
    if (pp) return `<span class="av peep-av ${extra}" style="width:${size}px;height:${size}px;background:${pp.bg || (u && u.color) || '#eee'}">${KBPeeps.render(pp, size, { crop: size <= 56 ? 'head' : pp.mode === 'full' ? 'full' : 'bust', bg: 'none' })}</span>`;
    if (window.KBCharacter && KBCharacter.canDraw(u)) return `<span class="av ${extra}" style="width:${size}px;height:${size}px;background:${(u && u.color) || '#eee'}">${KBCharacter.render(u, size, { crop: size <= 48 ? 'head' : 'bust', bg: 'none' })}</span>`;
    return `<span class="av ${extra}" style="width:${size}px;height:${size}px;background:${(u && u.color) || '#eee'}">${KBAvatar.render({ ...((u && u.avatar) || {}), accent: (u && u.color) || '#eee' }, size, { bg: 'none', crop: size <= 48 ? 'head' : 'bust' })}</span>`;
  };
  const charArt = (u) => { const pp = window.KBPeeps && KBPeeps.ready() ? KBPeeps.forUser(u, S.me) : null; return pp ? KBPeeps.render(pp, 300, { crop: pp.mode === 'full' ? 'full' : 'bust', bg: 'none' }) : KBCharacter.render(u, 300, { crop: 'full', bg: 'none' }); };
  // recoloured peeps need a hydrate pass after every DOM write
  const hydratePeeps = (rootEl) => { if (window.KBPeeps && KBPeeps.ready()) requestAnimationFrame(() => KBPeeps.hydrate(rootEl || document)); };
  const isLight = (hex) => { const h = String(hex || '').replace('#', ''); if (h.length !== 6) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (r * 299 + g * 587 + b * 114) / 1000 > 150; };
  const trustChip = (r) => `<span class="trustchip ${isLight(r.color) ? 'light' : ''}" style="background:${r.color}">${r.trust}</span>`;

  // ---------------- modal / toast ----------------
  const modal = $('#modal'), modalCard = $('#modalCard');
  function openModal(html, { closable = true, wide = false } = {}) { if (window.KBGuide && KBGuide.closeAssistant) KBGuide.closeAssistant(); modalCard.classList.toggle('wide', !!wide); modalCard.innerHTML = (closable ? `<button class="close-x" id="modalClose" aria-label="Close">${I('x', 16)}</button>` : '') + html; modal.classList.remove('hidden'); document.body.classList.add('modal-open'); if (closable) $('#modalClose').onclick = closeModal; }
  function closeModal() { modal.classList.add('hidden'); document.body.classList.remove('modal-open'); modalCard.innerHTML = ''; if (window.KBGuide && KBGuide.onModalClosed) KBGuide.onModalClosed(); }
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  function toast(msg, kind = '', ms = 3800) { const el = document.createElement('div'); el.className = `toast ${kind}`; el.innerHTML = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms); }
  function fileToDataUrl(file, max) { return new Promise((resolve) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82)); }; img.src = url; }); }
  async function urlToDataUrl(url) { const b = await (await fetch(url)).blob(); return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }

  // ---------------- reward celebration ----------------
  function showReward(reward, what, extra = {}) {
    if (!reward) return;
    const parts = [];
    if (reward.parts) for (const p of reward.parts) parts.push(`<span class="chip ${p.label === 'answer' ? 'a' : ''}">${p.label === 'answer' ? t('base_answer') : p.label === 'photo' ? I('camera', 14) + ' ' + t('photo_bonus') : I('bolt', 14) + ' ' + t('fast_bonus_short')} +${p.pts}</span>`);
    else parts.push(`<span class="chip a">${esc(what)} +${reward.points}</span>`);
    if (extra.onsite) parts.push(`<span class="chip">${I('pin', 14)} ${t('onsite_bonus')} +3</span>`);
    if (reward.streak?.bonus) parts.push(`<span class="chip">${I('flame', 14)} ${t('streak_bonus')} +${reward.streak.bonus}</span>`);
    for (const m of reward.missionsDone || []) parts.push(`<span class="chip">${I('target', 14)} ${t('mission_bonus')} +${m.reward}</span>`);
    if (reward.coins) parts.push(`<span class="chip dark">${I('coin', 14)} +${reward.coins} ${t('coins')}</span>`);
    const total = (reward.points || 0) + (reward.streak?.bonus || 0) + (reward.missionsDone || []).reduce((s, m) => s + m.reward, 0);
    const badges = (reward.earned || []).map((b) => `<div class="nb"><i>${I.emoji(b.icon, 20)}</i><div><div class="muted" style="font-size:11px">${t('new_badge')}</div><b>${esc(S.lang === 'ms' ? b.nameMs : b.name)}</b></div></div>`).join('');
    const lvl = reward.levelUp ? `<div class="lvl-up"><div>${t('level_up')}</div><b>${t('now_level')} ${esc(S.lang === 'ms' ? reward.levelUp.titleMs : reward.levelUp.title)}</b></div>` : '';
    openModal(`<div class="reward"><div class="big">${I(reward.levelUp ? 'rocket' : reward.earned?.length ? 'medal' : 'party', 34)}</div><h2 style="justify-content:center">${t('nice')}</h2><div class="pts">+${total}</div><div class="muted">${t('earned')}</div><div class="parts">${parts.join('')}</div>${badges}${lvl}<div class="total">${t('pts')}: <b>${reward.total}</b></div><button class="btn btn-black btn-block btn-lg" id="mOk" style="margin-top:14px">${t('keep_going')} ${I('arrowR', 18)}</button></div>`);
    $('#mOk').onclick = closeModal;
    FX.confetti({ count: reward.levelUp ? 220 : 120, spread: reward.levelUp ? 1.3 : 1 });
    FX.popPoints(total, $('#ptsPill'));
    if (reward.coins) setTimeout(() => { FX.popPoints(reward.coins, $('#coinPill')); FX.bump($('#coinPill')); }, 500);
    setTimeout(() => { if ($('#mOk')) closeModal(); }, 6500);
  }

  // ---------------- auth screens ----------------
  const authEl = $('#auth'), appEl = $('#app');
  let demoAccounts = null;
  const TRACE = [];
  function trace(msg) { const line = `${new Date().toISOString().slice(11, 19)} ${msg}`; TRACE.push(line); if (TRACE.length > 40) TRACE.shift(); console.info('[kb]', line); store.set('kb.trace', JSON.stringify(TRACE)); }
  async function showAuth(view = 'landing', opts = {}) {
    trace(`showAuth(${view}) from ${(new Error().stack || '').split('\n')[2]?.trim() || '?'} hash=${location.hash} token=${S.token ? 'yes' : 'no'}`);
    document.body.dataset.theme = opts.role || '';
    appEl.classList.add('hidden'); authEl.classList.remove('hidden');
    if (!demoAccounts) demoAccounts = await api('/api/demo/accounts').catch(() => ({ accounts: [], password: '' }));
    if (view === 'landing') renderLanding(); else if (view === 'login') renderLogin(opts); else renderSignup(opts);
    window.scrollTo(0, 0);
  }
  const langToggleHtml = () => `<button class="icon-btn" id="authLang" title="Language">${S.lang === 'en' ? 'BM' : 'EN'}</button>`;
  const logoHtml = (id = '') => `<a class="logo" href="#" ${id ? `id="${id}"` : ''}><span class="mark">${I('wheelchair', 16)}</span>KitaBantu</a>`;
  function bindAuthLang() { $('#authLang').onclick = () => { S.lang = S.lang === 'en' ? 'ms' : 'en'; store.set('kb.lang', S.lang); demoAccounts = null; showAuth(S.authView || 'landing', S.authOpts || {}); }; }
  const acctBtn = (a) => `<button type="button" class="acct" data-email="${esc(a.email)}">${AV(a, 30)}${esc(first(a.name))} <small>· ${a.role === 'helper' ? t('helper_word') : 'OKU'}</small></button>`;
  // ---- manifest-driven doodle illustrations (public/assets/assetsManifest.json → ui_elements) ----
  const UI = (idOrRole, { cls = '', size = null, float = true, pick = 0 } = {}) => {
    if (!window.KBPeeps || !KBPeeps.ready()) return '';
    const all = KBPeeps.uiByRole(idOrRole);
    const item = all.length ? all[pick % all.length] : ['hero', 'landing', 'auth', 'reserve'].flatMap((sec) => KBPeeps.ui(sec)).find((x) => x.id === idOrRole);
    if (!item) return '';
    return `<img class="ui-svg ${float ? 'float' : ''} ${cls}" src="${item.url}" alt="${esc(item.alt || item.name)}" loading="lazy" draggable="false"${size ? ` style="--w:${size}px"` : ''}>`;
  };
  function renderLanding() {
    S.authView = 'landing'; S.authOpts = {};
    const st = S.meta?.stats || {};
    authEl.innerHTML = `<div class="land">
      <div class="land-top">${logoHtml()}<span class="spacer"></span>${langToggleHtml()}<button class="btn btn-ghost btn-sm" id="goLogin">${t('login')}</button></div>
      <div class="land-hero">
        <div><span class="kicker">${I('pin', 14)} ${t('land_kicker')}</span><h1>${t('land_title')}</h1><p class="land-sub">${t('land_sub')}</p>
          <div class="stat-row"><div class="stat-mini"><b>${st.active ?? '—'}</b><span>${t('live_reports')}</span></div><div class="stat-mini"><b>${st.openRequests ?? '—'}</b><span>${t('open_requests_word')}</span></div><div class="stat-mini"><b>${st.helpers ?? '—'}</b><span>${t('helpers_word')}</span></div></div>
          <div class="role-cards">
            <button class="choice" id="pickHelper"><span class="radio"></span><span class="ico">${I('hands', 22)}</span><b>${t('role_helper')}</b><small>${t('role_helper_sub')}</small></button>
            <button class="choice" id="pickOku"><span class="radio"></span><span class="ico">${I('wheelchair', 22)}</span><b>${t('role_oku')}</b><small>${t('role_oku_sub')}</small></button>
          </div>
          <button class="btn btn-black btn-lg btn-block" id="landGo">${t('get_started')} ${I('arrowR', 18)}</button></div>
        <div class="land-art">${UI('hero-primary', { cls: 'hero-main', float: true }) || ART.hero()}${UI('hero-alt', { cls: 'hero-side a', pick: 0 })}${UI('hero-alt', { cls: 'hero-side b', pick: 1 })}<span class="hero-badge">${I('pin', 12)} ${t('hero_badge')}</span></div>
      </div>
      <section class="features"><div class="row-head"><div><h2>${t('feat_title')}</h2><p class="muted">${t('feat_sub')}</p></div></div>
        <div class="feat-grid">
          ${[['feature-check', 'f1', 0, 'wide'], ['feature-helper', 'f2', 0, ''], ['feature-community', 'f3', 4, ''], ['feature-check', 'f4', 1, ''], ['feature-helper', 'f5', 3, ''], ['feature-community', 'f6', 1, 'dark wide']].map(([role, k, pick, cls], i) => `<article class="feat ${cls}" style="--d:${i * 0.35}s"><div class="feat-art">${UI(role, { pick })}</div><div class="feat-txt"><b>${t(k)}</b><p>${t(k + '_sub')}</p></div></article>`).join('')}
        </div>
        <div class="stat-band"><div class="sb-art">${UI('stats', { pick: 0 })}</div><div class="sb"><b data-count="${st.verified ?? st.active ?? 0}">${st.verified ?? st.active ?? '—'}</b><span>${t('stat_verified')}</span></div><div class="sb"><b>${st.helpers ?? '—'}</b><span>${t('stat_helpers')}</span></div><div class="sb"><b>${st.avgAnswerMin ? st.avgAnswerMin + ' min' : '12 min'}</b><span>${t('stat_avg')}</span></div><div class="sb-art r">${UI('stats', { pick: 1 })}</div></div>
      </section>
      <div class="demo-box"><div class="head"><b>${t('demo_accounts')}</b><span class="muted">${t('demo_pw')}: <code>${esc(demoAccounts.password)}</code> · ${t('demo_hint')}</span></div><div class="accts">${(demoAccounts.accounts || []).map(acctBtn).join('')}</div></div>
      <div class="how"><div class="row-head"><h2>${t('how_title')}</h2></div><div class="grid3">
        <div class="tile"><div class="n">1</div><b>${t('how_1')}</b><p>${t('how_1_sub')}</p></div>
        <div class="tile dark"><div class="n">2</div><b>${t('how_2')}</b><p>${t('how_2_sub')}</p></div>
        <div class="tile"><div class="n">3</div><b>${t('how_3')}</b><p>${t('how_3_sub')}</p></div>
      </div></div>
      <section class="cta-band"><div class="cta-art">${UI('cta', { pick: 0 })}</div><div><h2>${t('cta_title')}</h2><p class="muted">${t('cta_sub')}</p><button class="btn btn-black btn-lg" id="landGo2">${t('get_started')} ${I('arrowR', 18)}</button></div><div class="cta-art r">${UI('cta', { pick: 1 })}</div></section></div>`;
    bindAuthLang();
    let role = null;
    const pick = (r) => { role = r; $('#pickHelper').classList.toggle('on', r === 'helper'); $('#pickOku').classList.toggle('on', r === 'oku'); document.body.dataset.theme = r; };
    $('#goLogin').onclick = () => showAuth('login');
    $('#pickHelper').onclick = () => pick('helper');
    $('#pickOku').onclick = () => pick('oku');
    $('#landGo').onclick = () => showAuth('signup', role ? { role } : {});
    const go2 = $('#landGo2'); if (go2) go2.onclick = () => showAuth('signup', role ? { role } : {});
    $$('.acct').forEach((b) => b.onclick = () => doLogin(b.dataset.email, demoAccounts.password, b));
    attachTilt(authEl);
  }
  function attachTilt(rootEl) {
    if (!rootEl || matchMedia('(pointer: coarse)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    rootEl.onmousemove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; const w = innerWidth, hgt = innerHeight; const dx = (e.clientX / w - 0.5), dy = (e.clientY / hgt - 0.5);
        rootEl.querySelectorAll('.ui-svg.float').forEach((el, i) => { const k = 6 + (i % 3) * 4; el.style.setProperty('--px', (dx * k).toFixed(1) + 'px'); el.style.setProperty('--py', (dy * k).toFixed(1) + 'px'); });
      });
    };
  }
  function onbShell(role, body, { art = null, light = false } = {}) {
    return `<div class="onb"><div class="onb-hero ${light ? 'light' : ''}"><div class="land-top">${logoHtml('homeLink')}<span class="spacer"></span>${langToggleHtml()}</div><div class="onb-art">${art || ''}</div></div><div class="onb-sheet">${body}</div></div>`;
  }
  function renderLogin(opts) {
    S.authView = 'login'; S.authOpts = opts;
    authEl.innerHTML = onbShell(null, `<h1>${t('welcome_back')}</h1><p class="intro">${t('demo_accounts')} · <code>${esc(demoAccounts.password)}</code></p>
        <form id="loginForm"><div class="field"><label>${t('email')}</label><input type="email" id="lEmail" autocomplete="username" required value="${esc(opts.email || '')}" /></div>
        <div class="field"><label>${t('password')}</label><input type="password" id="lPass" autocomplete="current-password" required /></div>
        <div class="err" id="lErr">${opts.notice ? esc(opts.notice) : ''}</div>${opts.notice ? `<details class="muted" style="font-size:11px;margin:-6px 0 10px"><summary>debug</summary><pre style="white-space:pre-wrap;font-size:10px">${esc(TRACE.slice(-6).join('\n'))}</pre></details>` : ''}<button class="btn btn-black btn-block btn-lg" type="submit">${t('login')} ${I('arrowR', 18)}</button></form>
        <div class="auth-foot">${t('no_account')} <button id="toSignup">${t('signup')}</button></div>
        <div class="demo-box"><div class="head"><b>${t('demo_accounts')}</b></div><div class="accts">${(demoAccounts.accounts || []).map(acctBtn).join('')}</div></div>`, { art: UI('login', { cls: 'onb-doodle' }) || ART.helper() });
    bindAuthLang(); attachTilt(authEl);
    $('#homeLink').onclick = (e) => { e.preventDefault(); showAuth('landing'); };
    $('#toSignup').onclick = () => showAuth('signup', {});
    $$('.acct').forEach((b) => b.onclick = () => doLogin(b.dataset.email, demoAccounts.password, b));
    $('#loginForm').onsubmit = async (e) => { e.preventDefault(); $('#lErr').textContent = ''; try { await doLogin($('#lEmail').value, $('#lPass').value); } catch (err) { $('#lErr').textContent = errMsg(err); } };
  }
  async function doLogin(email, password, btn) {
    if (btn) { btn.disabled = true; btn.style.opacity = .6; }
    try { const out = await api('/api/auth/login', { method: 'POST', body: { email, password } }); await enter(out.token, out.user); }
    catch (err) { if (btn) { btn.disabled = false; btn.style.opacity = 1; } if (!btn) throw err; toast(errMsg(err), 'warn'); }
  }
  function renderSignup(opts) {
    S.authView = 'signup'; S.authOpts = opts;
    const d = S.draft && S.draft.role === (opts.role || S.draft.role) ? S.draft : { role: opts.role || null, need: null, name: '', email: '', password: '', area: '', avatar: null, color: null, step: opts.role ? 2 : 1 };
    S.draft = d; d.role = opts.role || d.role;
    if (!d.avatar) d.avatar = KBAvatar.randomParts(d.role, d.need);
    if (!d.color) d.color = d.role === 'oku' ? '#f0e8dc' : '#e4e9f0';
    document.body.dataset.theme = d.role || '';
    const steps = `<div class="steps">${[1, 2, 3].map((i) => `<i class="${i <= d.step ? 'on' : ''}"></i>`).join('')}</div>`;
    let body = '';
    if (d.step === 1) body = `${steps}<h1>${t('su_step_role')}</h1><p class="intro">${t('land_sub')}</p><div class="role-pick">
        <button class="choice ${d.role === 'helper' ? 'on' : ''}" data-role="helper"><span class="radio"></span><span class="ico">${I('hands', 22)}</span><b>${t('role_helper')}</b><small>${t('role_helper_sub')}</small></button>
        <button class="choice ${d.role === 'oku' ? 'on' : ''}" data-role="oku"><span class="radio"></span><span class="ico">${I('wheelchair', 22)}</span><b>${t('role_oku')}</b><small>${t('role_oku_sub')}</small></button></div>
        <div class="err" id="sErr"></div><button class="btn btn-black btn-block btn-lg" id="next">${t('continue')}</button>`;
    else if (d.step === 2) body = `${steps}<h1>${t(d.role === 'oku' ? 'su_title_oku' : 'su_title_helper')}</h1><p class="intro">${t('su_step_you')}</p>
        <form id="suForm"><div class="field"><label>${t('name')}</label><input type="text" id="sName" value="${esc(d.name)}" required minlength="2" autocomplete="name" /></div>
        <div class="field"><label>${t('email')}</label><input type="email" id="sEmail" value="${esc(d.email)}" required autocomplete="email" /></div>
        <div class="field"><label>${t('password')}</label><input type="password" id="sPass" value="${esc(d.password)}" required minlength="6" autocomplete="new-password" /></div>
        <div class="field"><label>${t('area')}</label><input type="text" id="sArea" value="${esc(d.area)}" placeholder="${t('area_ph')}" /></div>
        ${d.role === 'oku' ? `<div class="field"><label>${t('need_q')}</label><div class="need-pick">${Object.entries(S.meta.needs).map(([k, v]) => `<button type="button" data-need="${k}" class="choice compact ${d.need === k ? 'on' : ''}"><span class="radio"></span><span class="ico">${needIcon(k, 20)}</span><b>${esc(v[S.lang])}</b></button>`).join('')}</div></div>` : ''}
        <div class="err" id="sErr"></div><div class="actions"><button type="button" class="btn btn-ghost" id="back">${I('arrowL', 16)} ${t('back')}</button><button class="btn btn-black" type="submit">${t('continue')}</button></div></form>`;
    else body = `${steps}<h1>${t('su_step_avatar')}</h1><p class="intro">${t('su_avatar_sub')}</p><div id="builderHost"></div>
        <div class="err" id="sErr"></div><div class="actions"><button type="button" class="btn btn-ghost" id="back">${I('arrowL', 16)} ${t('back')}</button><button class="btn btn-black btn-lg" id="create">${t('create_account')} ${I('arrowR', 18)}</button></div>`;
    const art = (d.step === 1 ? UI('signup', { cls: 'onb-doodle' }) : d.role === 'oku' ? UI('signup-oku', { cls: 'onb-doodle' }) : UI('signup-helper', { cls: 'onb-doodle' })) || (d.role === 'oku' ? ART.oku() : ART.helper());
    authEl.innerHTML = onbShell(d.role, body + `<div class="auth-foot">${t('have_account')} <button id="toLogin">${t('login')}</button></div>`, { art: d.step === 3 ? '' : art, light: d.role === 'oku' });
    if (d.step === 3) $('.onb-hero').style.display = 'none';
    bindAuthLang(); attachTilt(authEl);
    if ($('#homeLink')) $('#homeLink').onclick = (e) => { e.preventDefault(); S.draft = null; showAuth('landing'); };
    $('#toLogin').onclick = () => showAuth('login', {});
    if (d.step === 1) {
      $$('.role-pick button').forEach((b) => b.onclick = () => { d.role = b.dataset.role; d.color = null; d.avatar = null; d.peep = null; renderSignup({ role: d.role }); });
      $('#next').onclick = () => { if (!d.role) { $('#sErr').textContent = t('err_bad_role'); return; } d.step = 2; renderSignup({ role: d.role }); };
    } else if (d.step === 2) {
      $$('.need-pick button').forEach((b) => b.onclick = () => { d.need = b.dataset.need; d.avatar = KBAvatar.randomParts(d.role, d.need); d.peep = null; $$('.need-pick button').forEach((x) => x.classList.toggle('on', x === b)); });
      $('#back').onclick = () => { d.step = 1; renderSignup({}); };
      $('#suForm').onsubmit = (e) => { e.preventDefault(); d.name = $('#sName').value.trim(); d.email = $('#sEmail').value.trim(); d.password = $('#sPass').value; d.area = $('#sArea').value.trim(); if (d.role === 'oku' && !d.need) { $('#sErr').textContent = t('err_need_required'); return; } d.step = 3; renderSignup({ role: d.role }); };
    } else {
      mountBuilder($('#builderHost'), d, { title: d.name || t('your_avatar'), onBack: () => { d.step = 2; renderSignup({ role: d.role }); } });
      $('#back').onclick = () => { d.step = 2; renderSignup({ role: d.role }); };
      $('#create').onclick = async () => {
        const btn = $('#create'); btn.disabled = true;
        try { const out = await api('/api/auth/register', { method: 'POST', body: { name: d.name, email: d.email, password: d.password, role: d.role, need: d.need, avatar: d.avatar, color: d.color, area: d.area, peep: d.peep || null } }); if (d.peep) KBPeeps.saveLocal(d.peep); S.draft = null; await enter(out.token, out.user, true); }
        catch (err) { btn.disabled = false; $('#sErr').textContent = errMsg(err); if (['email_taken', 'bad_email', 'password_too_short', 'name_too_short'].includes(err.data?.error)) { d.step = 2; renderSignup({ role: d.role }); $('#sErr').textContent = errMsg(err); } }
      };
    }
  }

  // ---------------- AVATAR BUILDER (Humation-style) ----------------
  const TABS = [['hair', 'tab_head'], ['body', 'tab_body'], ['item', 'tab_item'], ['glasses', 'tab_glasses'], ['aid', 'tab_aid']];
  /** d = { avatar: parts, color }, mutated live. */
  function mountBuilder(host, d, { title = '', onBack = null, compact = false, user = null } = {}) {
    // New: manifest-driven <AvatarBuilder /> (Open Peeps layers). d.peep is the live value; falls back to the line-art builder if the manifest failed.
    if (window.AvatarBuilderMount && window.KBPeeps && KBPeeps.ready()) {
      const who = user || S.me || { role: d.role, need: d.need, level: 1, points: 0 };
      if (!d.peep) d.peep = KBPeeps.sanitize(KBPeeps.current() && !S.me ? KBPeeps.current() : KBPeeps.random(d.role || who.role, d.need || who.need, d.gender || 'any', who), who);
      const inst = AvatarBuilderMount(host, {
        value: d.peep, user: { role: who.role, need: who.need, level: who.level || 1, points: who.points || 0 }, compact, title,
        onChange: (peep) => { d.peep = peep; d.color = peep.bg || d.color; KBPeeps.saveLocal(peep); inst.update({ value: peep }); },
      });
      if (onBack) { /* back button lives in the surrounding sheet */ }
      return inst;
    }
    let tab = 'hair', palette = false;
    const cfg = () => ({ ...d.avatar, accent: d.color });
    host.innerHTML = `<div class="builder ${compact ? 'compact' : ''}">
      <div class="canvas"><div class="canvas-top">${onBack ? `<button class="icon-btn" id="bBack" aria-label="Back">${I('arrowL', 18)}</button>` : ''}<div class="ttl"><b>${esc(title)}</b><small>${t('by_you')}</small></div><button class="icon-btn" id="bShuffle" title="${t('shuffle')}">${I('refresh', 18)}</button><button class="icon-btn dark" id="bDownload" title="${t('download')}">${I('download', 18)}</button></div>
        <div class="stage" id="bStage"></div>
        <div class="swatches hidden" id="bSwatches">${KBAvatar.ACCENTS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
        <button class="fab-palette" id="bPalette" aria-label="Colour">${I('palette', 22)}</button></div>
      <div class="tabs" id="bTabs">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'active' : ''}">${t(l)}</button>`).join('')}</div>
      <div class="opt-grid" id="bGrid"></div></div>`;
    const stage = $('#bStage', host);
    const draw = (pop = true) => { stage.innerHTML = KBAvatar.render(cfg(), 330, { bg: 'none' }); $('.canvas', host).style.background = d.color; if (pop) { stage.classList.remove('pop'); void stage.offsetWidth; stage.classList.add('pop'); } $$('#bSwatches button', host).forEach((b) => b.classList.toggle('on', b.dataset.c === d.color)); };
    const grid = () => {
      const parts = KBAvatar.PARTS[tab];
      $('#bGrid', host).innerHTML = Object.keys(parts).map((id) => `<button type="button" data-id="${id}" class="${d.avatar[tab] === id ? 'on' : ''} ${id === 'none' ? 'none' : ''}" title="${esc(parts[id].name)}">${id === 'none' ? t('none_opt') : KBAvatar.renderPart(tab, id, 110, { base: tab === 'hair' ? null : d.avatar, crop: tab === 'hair' || tab === 'glasses' ? 'head' : tab === 'body' ? 'bust' : 'torso' })}</button>`).join('');
      $$('#bGrid button', host).forEach((b) => b.onclick = () => { d.avatar = { ...d.avatar, [tab]: b.dataset.id }; $$('#bGrid button', host).forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    };
    $$('#bTabs button', host).forEach((b) => b.onclick = () => { tab = b.dataset.tab; $$('#bTabs button', host).forEach((x) => x.classList.toggle('active', x === b)); grid(); });
    $('#bPalette', host).onclick = () => { palette = !palette; $('#bSwatches', host).classList.toggle('hidden', !palette); $('#bPalette', host).classList.toggle('on', palette); };
    $$('#bSwatches button', host).forEach((b) => b.onclick = () => { d.color = b.dataset.c; draw(false); });
    $('#bShuffle', host).onclick = () => { d.avatar = KBAvatar.randomParts(d.role || S.me?.role, d.need || S.me?.need); draw(); grid(); };
    $('#bDownload', host).onclick = () => { const blob = new Blob([KBAvatar.render(cfg(), 600)], { type: 'image/svg+xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kitabantu-avatar.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    if (onBack) $('#bBack', host).onclick = onBack;
    draw(false); grid();
  }

  // ---------------- session ----------------
  async function enter(token, user, fresh = false) {
    S.token = token; store.set('kb.token', token); S.me = user; if (user && user.email) store.set('kb.lastEmail', user.email);
    authEl.classList.add('hidden'); authEl.innerHTML = ''; appEl.classList.remove('hidden');
    document.body.dataset.theme = user.role;
    renderNav(); renderTopbar();
    connectEvents();
    KBGuide.init(ctx); KBGuide.showDock(true); KBGuide.relabel();
    location.hash = '#/home'; await render();
    if (!fresh) setTimeout(() => KBGuide.requestPermissions(), 900);
    if (fresh) { setTimeout(() => { openModal(`<div class="reward"><div class="big">${I('party', 34)}</div><h2 style="justify-content:center">${t('welcome_title')}</h2><p class="muted">${t('welcome_sub')}</p><div class="nb"><i>${I('leaf', 20)}</i><b>${esc(user.badges[0]?.name || 'Early Adopter')}</b></div><button class="btn btn-black btn-block" id="mOk" style="margin-top:14px">${t('lets_go')} ${I('arrowR', 18)}</button></div>`); $('#mOk').onclick = () => { closeModal(); setTimeout(() => KBGuide.requestPermissions(), 500); }; FX.confetti({ count: 160 }); }, 400); }
  }
  /** Server no longer knows our token (restart / reset). Explain and offer to sign in again rather than bouncing to the landing page silently. */
  let lostShown = false;
  function sessionLost() {
    if (lostShown) return; lostShown = true;
    trace(`sessionLost route=${S.route} me=${S.me && S.me.email} token=${S.token ? 'yes' : 'NO'}`);
    const email = S.me && S.me.email;
    S.token = null; store.del('kb.token'); if (S.es) { S.es.close(); S.es = null; }
    if (window.KBGuide) { KBGuide.stop({ silent: true }); KBGuide.showDock(false); }
    if (window.KBMap && S.route === 'map') KBMap.hide();
    S.me = null; location.hash = '';
    appEl.classList.add('hidden'); view.innerHTML = '';
    showAuth('login', { email: email || store.get('kb.lastEmail') || '', notice: t('session_expired') });
    setTimeout(() => { lostShown = false; }, 1500);
  }
  async function logout(callApi = true) {
    trace(`logout(callApi=${callApi}) from ${(new Error().stack || '').split('\n')[2]?.trim() || '?'}`);
    if (callApi) await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    if (window.KBGuide) { KBGuide.stop({ silent: true }); KBGuide.showDock(false); }
    S.token = null; S.me = null; store.del('kb.token'); if (S.es) { S.es.close(); S.es = null; }
    if (window.KBMap && S.route === 'map') KBMap.hide();
    location.hash = ''; showAuth('landing');
  }
  async function refreshMe() {
    if (!S.token) return;
    const prev = S.me ? S.me.points : 0;
    S.me = await api('/api/me');
    renderTopbar(prev);
    if (S.route === 'home' || S.route === 'profile') renderCounts();
  }
  function renderTopbar(prevPts) {
    const u = S.me; if (!u) return;
    $('#roleTag').textContent = u.role === 'oku' ? 'OKU' : t('helper_word');
    $('#meAvatar').innerHTML = AV(u, 42); $('#meAvatar').style.background = (u.peep && u.peep.bg) || u.color; hydratePeeps($('#meAvatar'));
    $('#langLabel').textContent = S.lang === 'en' ? 'BM' : 'EN';
    if (prevPts != null && prevPts !== u.points) { FX.countUp($('#ptsValue'), u.points, { from: prevPts }); FX.bump($('#ptsPill')); } else $('#ptsValue').textContent = u.points;
    const cp = $('#coinPill'); if (cp) { cp.classList.remove('hidden'); const cv = $('#coinValue'); if (cv.textContent !== String(u.coins ?? 0)) { const from = Number(cv.textContent) || 0; if (from !== (u.coins ?? 0) && prevPts != null) { FX.countUp(cv, u.coins ?? 0, { from }); FX.bump(cp); } else cv.textContent = u.coins ?? 0; } }
    $('#notifDot').classList.toggle('hidden', !u.unread); $('#notifDot').textContent = u.unread || '';
    document.body.classList.toggle('big', S.big);
  }
  function navItems() {
    return S.me.role === 'helper'
      ? [['home', 'home', 'nav_home'], ['requests', 'hand', 'nav_requests', () => S.meta?.stats?.openRequests], ['map', 'map', 'nav_map'], ['community', 'trophy', 'nav_board'], ['shop', 'sparkle', 'nav_shop'], ['profile', 'user', 'nav_profile']]
      : [['home', 'home', 'nav_home'], ['ask', 'chat', 'nav_ask'], ['map', 'map', 'nav_map'], ['community', 'users', 'nav_board'], ['shop', 'sparkle', 'nav_shop'], ['profile', 'user', 'nav_profile']];
  }
  function renderNav() {
    const items = navItems();
    const html = items.map(([id, icon, key, cnt]) => `<button class="nav ${S.route === id ? 'active' : ''}" data-route="${id}" aria-label="${t(key)}">${I(icon, 20)}<span>${t(key)}</span>${cnt && cnt() ? `<span class="cnt">${cnt()}</span>` : ''}</button>`).join('');
    $('#sidenav').innerHTML = html + `<div class="side-card card tight"><div class="muted" style="font-size:12px">${S.me.role === 'helper' ? t('missions') : t('ask_cta')}</div><div id="sideMini"></div></div>`;
    $('#bottomnav').innerHTML = html;
    $$('.nav').forEach((b) => b.onclick = () => { location.hash = `#/${b.dataset.route}`; });
    renderSideMini();
  }
  function renderSideMini() {
    const el = $('#sideMini'); if (!el) return;
    if (S.me.role === 'helper') el.innerHTML = S.me.missions.map((m) => `<div class="row" style="margin-top:8px;font-size:13px">${I(m.done ? 'check' : 'target', 14)}<span class="grow" style="font-weight:600">${esc(m.title)}</span><b style="color:${m.done ? 'var(--ink)' : 'var(--muted)'}">${m.progress}/${m.goal}</b></div>`).join('');
    else el.innerHTML = `<button class="btn btn-black btn-block btn-sm" style="margin-top:8px" onclick="location.hash='#/ask'">${I('chat', 14)} ${t('ask_cta')}</button>`;
  }
  function renderCounts() { $$('.nav .cnt').forEach((c) => c.remove()); const n = S.meta?.stats?.openRequests; if (S.me.role === 'helper' && n) $$('.nav[data-route="requests"]').forEach((b) => b.insertAdjacentHTML('beforeend', `<span class="cnt">${n}</span>`)); renderSideMini(); }

  // ---------------- router ----------------
  const view = $('#view');
  async function render() {
    if (!S.me) return;
    const hash = location.hash.replace(/^#\/?/, '') || 'home';
    const [route, param] = hash.split('/');
    const prev = S.route; S.route = route;
    $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
    if (prev === 'map' && route !== 'map') KBMap.hide();
    view.innerHTML = '';
    try {
      setTimeout(() => hydratePeeps(view), 0);
      if (route === 'home') await (S.me.role === 'helper' ? renderHelperHome() : renderOkuHome());
      else if (route === 'requests') await renderRequests(param);
      else if (route === 'request' && param) await openRequest(param, true);
      else if (route === 'ask') { const p = askPrefill; askPrefill = null; renderAsk(p || {}); }
      else if (route === 'map') renderMap(param);
      else if (route === 'community') await renderCommunity();
      else if (route === 'shop') await renderShop(param);
      else if (route === 'profile') await renderProfile();
      else { location.hash = '#/home'; }
    } catch (err) {
      if (err && err.status === 401) return;                       // session lost → sessionLost() already switched to the login screen
      console.error(err); view.innerHTML = `<div class="card"><b>${t('err_generic')}</b><div class="muted">${esc(err.message)}</div><button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="location.reload()">${t('retry') || 'Retry'}</button></div>`;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('storage', async (e) => {
    if (e.key !== 'kb.token') return;
    trace(`storage kb.token changed in another tab: ${e.oldValue ? 'had' : 'none'} → ${e.newValue ? 'has' : 'none'}`);
    if (!e.newValue) { if (S.me) { S.token = null; S.me = null; if (S.es) { S.es.close(); S.es = null; } appEl.classList.add('hidden'); view.innerHTML = ''; location.hash = ''; showAuth('login', { email: store.get('kb.lastEmail') || '', notice: t('signed_out_elsewhere') }); } return; }
    if (e.newValue !== S.token) { S.token = e.newValue; const me = await api('/api/me').catch(() => null); if (me) { if (!S.me || me.id !== S.me.id) { lostShown = false; await enter(S.token, me); } else { S.me = me; } } }
  });

  // ---------------- shared pieces ----------------
  function pageHead({ greetLine, title, sub }) {
    const u = S.me;
    return `<section class="page-head hero"><div><div class="greet">${greetLine || ''}</div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <a href="#/profile" class="ring-wrap" title="${t('see_profile')}">${FX.ring(u.progress)}${AV(u, 64)}</a></section>`;
  }
  const tile = ({ cls = '', icon, label, num, unit = '', href = null, chev = false, extra = '' }) => `<${href ? `a href="${href}"` : 'div'} class="tile ${cls}">${icon ? `<span class="ti">${I(icon, 18)}</span>` : ''}<small class="lbl">${label}</small><span class="num">${num}${unit ? `<small>${unit}</small>` : ''}</span>${extra}${chev ? `<span class="chev">${I('chevR', 18)}</span>` : ''}</${href ? 'a' : 'div'}>`;
  const MISSION_ICON = { '💌': 'letter', '✅': 'check', '📍': 'pin' };
  const missionHtml = (m) => `<div class="mission ${m.done ? 'done' : ''}"><div class="ic">${I(m.done ? 'check' : (MISSION_ICON[m.icon] || 'target'), 16)}</div><div class="grow"><b>${esc(m.title)}</b><div class="bar"><i data-w="${Math.round(m.progress / m.goal * 100)}"></i></div></div><div class="rw">${m.done ? '✓ +' + m.reward : m.progress + '/' + m.goal + ' · +' + m.reward}</div></div>`;
  const geoQ = () => { const g = S.geo || (window.KBGuide && KBGuide.home ? KBGuide.home() : KL_SENTRAL); return `&lat=${g.lat}&lng=${g.lng}`; };
  function requestCard(q) {
    const mine = q.mine, done = q.answeredByMe;
    const bounty = done ? `<div class="bounty done">${I('check', 18)}<span>${t('answered')}</span></div>` : mine ? `<div class="bounty wait"><b>${q.answers.length}</b><span>${t('answers')}</span></div>` : q.status === 'open' ? `<div class="bounty"><b>+${q.bounty.withPhoto}</b><span>${t('pts')}</span></div>` : `<div class="bounty wait"><b>${q.answers.length}</b><span>${t('answers')}</span></div>`;
    const urg = q.urgency === 'today' ? `<span class="chip a">${I('clock', 12)} ${t('urg_today')}</span>` : q.urgency === 'this_week' ? `<span class="chip">${t('urg_this_week')}</span>` : `<span class="chip ghost">${t('urg_whenever')}</span>`;
    const fast = q.status === 'open' && q.bounty.fastWindowMin > 0 ? `<span class="chip warn">${I('bolt', 12)} ${q.bounty.fastWindowMin} ${t('m')}</span>` : '';
    return `<div class="req ${urgClass(q)}" data-req="${q.id}"><div class="who">${AV(q.by, 44)}<small>${esc(first(q.by.name))}<br>${needIcon(q.need, 13)}</small></div>
      <div class="grow"><div class="q">${esc(q.question)}</div><div class="place">${I('pin', 13)} ${esc(q.place)}${q.distM != null ? ` · ${dist(q.distM)} ${t('away')}` : ''} · ${fmtAgo(q.ageMin * 60000)}</div>
      <div class="meta">${q.status === 'open' ? `<span class="status-dot"></span>` : ''}${urg}${fast}${q.answers.length ? `<span class="chip good">${I('chat', 12)} ${q.answers.length} ${q.answers.length === 1 ? t('answer_1') : t('answers')}</span>` : ''}${q.status === 'closed' ? `<span class="chip ghost">${t('closed')}</span>` : ''}</div></div>${bounty}</div>`;
  }
  const feedItem = (f, isNew = false) => `<li class="${isNew ? 'new' : ''}"><div class="ic">${AV(f.by || {}, 36)}<span class="k">${I.emoji(f.icon, 10)}</span></div><div class="t"><b>${esc(f.by?.name || '—')}</b> ${esc(f.text)}</div><span class="ago">${fmtAgo(Date.now() - f.at)}</span></li>`;
  const alertItem = (r, now) => `<div class="alert-item" data-report="${r.id}"><div class="ic ${r.kind} ${isLight(r.color) ? 'light' : ''}" style="background:${r.color}">${I.emoji(r.icon, 16)}</div><div class="grow"><b>${esc(r.label)}</b><span>${esc(r.place.split('–')[0])} · ${fmtAgo(now - r.lastVerifiedAt)} · ${esc(r.bandLabel.split(' –')[0])}</span></div>${trustChip(r)}</div>`;
  function bindCards(root = view) {
    $$('[data-req]', root).forEach((el) => el.onclick = () => openRequest(el.dataset.req));
    $$('[data-report]', root).forEach((el) => el.onclick = () => { location.hash = `#/map/${el.dataset.report}`; });
  }

  // ---------------- HELPER HOME (bento) ----------------
  async function renderHelperHome() {
    const [reqs, feed, reports] = await Promise.all([api('/api/requests?status=open' + geoQ()), api('/api/feed?limit=6'), api(`/api/reports?lat=${KL_SENTRAL.lat}&lng=${KL_SENTRAL.lng}`)]);
    const u = S.me; const open = reqs.requests;
    S.meta.stats.openRequests = open.length;
    const stale = reports.reports.filter((r) => (r.band === 'aging' || r.band === 'old') && r.by?.id !== u.id && !r.confirmedBy?.includes(u.name)).sort((a, b) => a.trust - b.trust).slice(0, 4);
    const next = open[0];
    view.innerHTML = `<div class="page">
      ${pageHead({ greetLine: `${greet()}, ${esc(first(u.name))}`, title: t('nav_home'), sub: u.rank ? `${t('you_are_rank', { rank: u.rank })} · ${open.length} ${t('people_waiting')}` : `${open.length} ${t('people_waiting')}` })}
      <div class="row-head" style="margin-top:0"><span class="lbl">${t('dashboard')}</span><a class="link see" href="#/profile">${t('see_profile')}</a></div>
      <div class="bento">
        ${tile({ cls: 'dark', icon: 'hand', label: t('open_requests'), num: open.length, href: '#/requests', chev: true })}
        ${tile({ icon: 'star', label: t('points'), num: u.points, unit: u.nextLevelAt ? `${u.nextLevelAt - u.points} ${t('to_next_short')}` : '' })}
        ${tile({ icon: 'flame', label: t('day_streak'), num: u.streak })}
        ${tile({ icon: 'trophy', label: t('rank_week'), num: u.rank ? `#${u.rank}` : '–', href: '#/community' })}
        ${next ? `<div class="tile wide clickable" data-req="${next.id}"><div class="row" style="justify-content:space-between"><small class="lbl" style="margin:0">${t('board_title')} · ${fmtAgo(next.ageMin * 60000)}</small><span class="chip a">+${next.bounty.withPhoto} ${t('pts')}</span></div><div style="font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.2;margin-top:12px">${esc(next.question)}</div><div class="row" style="margin-top:12px;gap:8px">${AV(next.by, 28)}<span class="muted" style="font-weight:600">${esc(first(next.by.name))} · ${esc(next.place)}${next.distM != null ? ` · ${dist(next.distM)}` : ''}</span></div><span class="chev">${I('arrowR', 18)}</span></div>` : `<div class="tile wide"><small class="lbl">${t('board_title')}</small><div style="font-size:18px;font-weight:800;margin-top:10px">${t('no_open')}</div></div>`}
        <div class="tile wide tint"><div class="row" style="justify-content:space-between"><small class="lbl" style="margin:0">${t('missions')}</small><small class="lbl" style="margin:0">${t('missions_sub')}</small></div><div class="missions" style="margin-top:8px">${u.missions.map(missionHtml).join('')}</div></div>
      </div>
      <div class="row-head"><h2>${t('board_title')}</h2><a class="link see" href="#/requests">${t('see_all')} ${I('arrowR', 12)}</a></div>
      <div class="req-list">${open.length ? open.slice(0, 4).map(requestCard).join('') : `<div class="empty card"><span class="big">${I('smile', 28)}</span>${t('no_open')}</div>`}</div>
      <div class="grid2" style="margin-top:22px">
        <div class="card"><div class="card-head"><div class="grow"><h2>${t('stale_title')}</h2><div class="sub">${t('stale_sub')}</div></div></div>
          <div style="display:grid;gap:8px">${stale.length ? stale.map((r) => alertItem(r, reports.now)).join('') : `<div class="muted">${t('none')}</div>`}</div></div>
        <div class="card"><div class="card-head"><div class="grow"><h2>${t('feed_title')}</h2></div><a class="link see" href="#/community">${t('see_all')} ${I('arrowR', 12)}</a></div><ul class="feed" id="feed">${feed.items.map((f) => feedItem(f)).join('')}</ul></div>
      </div></div>`;
    FX.animateRings(view); FX.animateBars(view);
    bindCards();
    renderCounts();
  }

  // ---------------- REQUESTS (helper board) ----------------
  async function renderRequests() {
    const f = S.reqFilter;
    const d = await api(`/api/requests?${f === 'open' ? 'status=open' : ''}${geoQ()}`);
    let list = d.requests;
    if (f === 'mine') list = list.filter((q) => q.answeredByMe);
    if (S.reqSort === 'nearest') list = list.slice().sort((a, b) => (a.distM ?? 1e9) - (b.distM ?? 1e9));
    view.innerHTML = `<div class="page"><section class="page-head"><div><div class="greet">${t('nav_requests')}</div><h1>${t('board_title')}</h1><div class="sub">${t('board_sub')}</div></div></section>
      <div class="filters">${[['open', t('open')], ['mine', t('answered_by_me')], ['all', t('all')]].map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}<span class="sp"></span>${[['newest', t('newest')], ['nearest', t('nearest')]].map(([k, l]) => `<button class="${S.reqSort === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <div class="req-list">${list.length ? list.map(requestCard).join('') : `<div class="empty card"><span class="big">${I('smile', 28)}</span>${t('no_open')}</div>`}</div></div>`;
    $$('.filters [data-f]').forEach((b) => b.onclick = () => { S.reqFilter = b.dataset.f; renderRequests(); });
    $$('.filters [data-s]').forEach((b) => b.onclick = () => { S.reqSort = b.dataset.s; renderRequests(); });
    bindCards();
  }
  async function openRequest(id, asPage = false) {
    const q = await api(`/api/requests/${id}?${geoQ().slice(1)}`).catch(() => null);
    if (!q) { toast(t('err_generic'), 'warn'); return; }
    const isHelper = S.me.role === 'helper';
    const answers = q.answers.length ? q.answers.map((a) => `<div class="answer ${a.verdict}">${AV(a.by, 40)}<div class="grow"><div class="row" style="gap:6px;flex-wrap:wrap"><b>${esc(a.by.name)}</b><span class="muted">Lv ${a.by.level}</span><span class="v ${a.verdict}">${t('v_' + a.verdict)}</span>${a.distM != null && a.distM <= 150 ? `<span class="chip">${I('pin', 12)} ${t('on_site')}</span>` : ''}</div><p>${esc(a.note)}</p>${a.photo ? `<img src="${esc(a.photo)}" alt="" loading="lazy" />` : ''}${a.ai ? `<div class="ai-badge"><b>${a.ai.score}</b><span>${t('ai_score')} · ${esc(String(a.ai.model || 'Gemini').replace(/^gemini-/, 'Gemini '))}</span></div>` : ''}<div class="foot"><span>${fmtAgo(Date.now() - a.at)}</span><span>· +${a.points} ${t('pts')}</span>${a.thanked ? `<span class="chip a">${I('heart', 12)} ${t('thanked')}</span>` : q.mine ? `<button class="btn btn-black btn-sm" data-thank="${a.id}">${I('heart', 14)} ${t('thank')}</button>` : ''}</div></div></div>`).join('') : `<div class="empty"><span class="big">${I('eye', 26)}</span>${t('no_answers_yet')}</div>`;
    const canAnswer = isHelper && !q.mine && !q.answeredByMe && q.status !== 'closed';
    openModal(`<h2>${I(q.status === 'open' ? 'hand' : q.status === 'closed' ? 'check' : 'chat', 20)} ${esc(q.place)}</h2>
      <div class="qcard"><div class="q">“${esc(q.question)}”</div><div class="by">${AV(q.by, 28)}<b>${esc(q.by.name)}</b> · ${needIcon(q.need, 14)} ${esc(q.needLabel)} · ${fmtAgo(q.ageMin * 60000)}</div>
        <div class="wrap" style="margin-top:10px">${q.urgency === 'today' ? `<span class="chip a">${I('clock', 12)} ${t('urg_today')}</span>` : `<span class="chip">${t('urg_' + q.urgency)}</span>`}${q.distM != null ? `<span class="chip ghost">${I('pin', 12)} ${dist(q.distM)} ${t('away')}</span>` : ''}<button class="chip ghost" style="cursor:pointer" id="qOnMap">${I('map', 12)} ${t('on_map')}</button></div></div>
      ${canAnswer ? `<div class="earn-preview"><span class="coin">${I('coin', 20)}</span><div><div>${t('bounty')} <b>+${q.bounty.base}</b> · <b>+${q.bounty.withPhoto}</b> ${t('with_photo')}</div><div class="parts">${q.bounty.fastWindowMin > 0 ? t('fast_bonus', { m: q.bounty.fastWindowMin }).replace('⚡', '') : t('fast_gone')}</div></div></div>
      <div class="go-row"><button class="btn btn-black btn-lg grow" id="btnGo">${I('navigate', 18)} ${t('take_me_there')}</button><button class="btn btn-outline btn-lg" id="btnCam" title="${t('open_camera')}">${I('camera', 18)}</button></div>
      <button class="btn btn-outline btn-block" id="btnAnswer">${I('edit', 16)} ${t('answer')}</button>` : `<button class="btn btn-outline btn-block" id="btnGo" style="margin-top:6px">${I('navigate', 16)} ${t('take_me_there')}</button>`}
      <h3 style="margin-top:16px">${q.answers.length} ${q.answers.length === 1 ? t('answer_1') : t('answers')}</h3>${answers}`);
    $('#qOnMap').onclick = () => { closeModal(); location.hash = '#/map'; setTimeout(() => KBMap.flyTo && KBMap.flyTo(q), 300); };
    $('#btnGo').onclick = () => { closeModal(); KBGuide.start({ to: q, label: q.place, need: q.need, requestId: q.id, request: q }); };
    if (canAnswer) { $('#btnAnswer').onclick = () => renderAnswerForm(q); $('#btnCam').onclick = () => { closeModal(); KBGuide.openCamera({ request: q }); }; }
    $$('[data-thank]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await api(`/api/requests/${q.id}/thank`, { method: 'POST', body: { answerId: b.dataset.thank } }); FX.confetti({ count: 70 }); toast(`${I('heart', 14)} ${t('thanked')}`, 'accent'); openRequest(q.id); if (S.route === 'home') renderOkuHome(); } catch (err) { toast(errMsg(err), 'warn'); b.disabled = false; } });
    if (asPage) { location.hash = isHelper ? '#/requests' : '#/home'; }
  }
  function renderAnswerForm(q, pre = null) {
    const draft = { verdict: pre?.verdict || null, note: pre?.note || '', photo: pre?.photo || null, ai: pre?.ai || null };
    const samples = ['lift-working', 'lift-broken', 'ramp', 'steps-only', 'toilet', 'tactile', 'parking-blocked', 'kerb-blocked', 'construction', 'pavement'];
    const calc = () => q.bounty.base + (draft.photo ? 10 : 0);
    openModal(`<h2>${I('edit', 20)} ${t('answer_title')}</h2><div class="qcard"><div class="q" style="font-size:16px">“${esc(q.question)}”</div><div class="by">${I('pin', 13)} ${esc(q.place)} · ${AV(q.by, 22)} ${esc(first(q.by.name))}</div></div>
      <div class="field"><label>${t('verdict')}</label><div class="verdicts">${[['yes', 'check'], ['partly', 'alert'], ['no', 'ban']].map(([v, ic]) => `<button type="button" class="choice compact ${v}" data-v="${v}"><span class="radio"></span><span class="ico">${I(ic, 18)}</span><span><b>${t('v_' + v)}</b><br><small>${t('v_' + v + '_sub')}</small></span></button>`).join('')}</div></div>
      ${draft.ai ? `<div class="ai-badge lg"><b>${draft.ai.score}</b><span>${t('ai_assessed')} · ${esc(t('ai_verdict_' + (draft.ai.verdict || 'unclear')))}</span></div>` : ''}
      <div class="field"><label>${t('your_note')}</label><textarea id="aNote" placeholder="${esc(t('note_ph'))}">${esc(draft.note)}</textarea></div>
      <div class="field"><label>${t('add_photo')}</label><div class="photo-drop ${draft.photo ? 'has' : ''}" id="photoDrop"><input type="file" accept="image/*" capture="environment" id="photoFile" /><span id="photoHint">${draft.photo ? `<img src="${draft.photo}" alt="" />` : `${I('camera', 18)} ${t('tap_photo')}`}</span></div><button type="button" class="btn btn-outline btn-sm" id="aCam" style="margin-top:8px">${I('camera', 14)} ${t('open_camera')}</button><div class="muted" style="margin-top:6px">${t('or_sample')}</div><div class="samples" id="samples">${samples.map((s) => `<img src="/seed-photos/${s}.jpg" data-s="${s}" alt="" />`).join('')}</div></div>
      <div class="earn-preview"><span class="coin">${I('coin', 20)}</span><div>${t('you_earn')} <b id="earnNum">+${calc()}</b> ${t('pts')}<div class="parts" id="earnParts"></div></div></div>
      <div class="err" id="aErr"></div><div class="actions"><button class="btn btn-ghost" id="mCancel">${t('cancel')}</button><button class="btn btn-black" id="mSend">${t('send_answer')} ${I('arrowR', 16)}</button></div>`);
    const upd = () => { $('#earnNum').textContent = `+${calc()}`; $('#earnParts').textContent = [`${t('base_answer')} +25`, q.bounty.fastWindowMin > 0 ? `${t('fast_bonus_short')} +10` : null, draft.photo ? `${t('photo_bonus')} +10` : null].filter(Boolean).join(' · '); }; upd();
    $$('.verdicts button').forEach((b) => { if (b.dataset.v === draft.verdict) b.classList.add('on'); b.onclick = () => { draft.verdict = b.dataset.v; $$('.verdicts button').forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('#aCam').onclick = () => KBGuide.openCamera({ request: q, onResult: (d) => renderAnswerForm(q, d) });
    const setPhoto = (dataUrl, srcEl) => { draft.photo = dataUrl; $('#photoDrop').classList.add('has'); $('#photoHint').innerHTML = `<img src="${dataUrl}" alt="" />`; $$('#samples img').forEach((i) => i.classList.toggle('sel', i === srcEl)); upd(); };
    $('#photoFile').onchange = async (e) => { const f = e.target.files[0]; if (f) setPhoto(await fileToDataUrl(f, 1280), null); };
    $$('#samples img').forEach((img) => img.onclick = async () => setPhoto(await urlToDataUrl(img.src), img));
    $('#mCancel').onclick = () => openRequest(q.id);
    $('#mSend').onclick = async () => {
      draft.note = $('#aNote').value.trim();
      if (!draft.verdict) { $('#aErr').textContent = t('verdict'); return; }
      if (draft.note.length < 4) { $('#aErr').textContent = t('note_short'); return; }
      const btn = $('#mSend'); btn.disabled = true; btn.textContent = t('sending');
      try {
        const out = await api(`/api/requests/${q.id}/answer`, { method: 'POST', body: { verdict: draft.verdict, note: draft.note, photo: draft.photo, at: S.geo || KBMap.me || null, ai: draft.ai ? { score: draft.ai.score, verdict: draft.ai.verdict, summary: draft.ai.summary, model: draft.ai.model } : null } });
        await refreshMe(); closeModal();
        setTimeout(() => showReward(out.reward, t('base_answer')), 150);
        if (S.route === 'requests') renderRequests(); else if (S.route === 'home') renderHelperHome();
      } catch (err) { btn.disabled = false; btn.textContent = t('send_answer'); $('#aErr').textContent = err.data?.error === 'already_answered' ? t('already_answered') : err.data?.error === 'own_request' ? t('own_request') : errMsg(err); }
    };
  }

  // ---------------- OKU HOME (bento) ----------------
  async function renderOkuHome() {
    const u = S.me;
    const [mine, reports] = await Promise.all([api('/api/requests?mine=1'), api(`/api/reports?need=${u.need}`)]);
    const alerts = reports.reports.filter((r) => r.kind === 'obstacle').sort((a, b) => b.trust - a.trust).slice(0, 5);
    const waiting = mine.requests.filter((q) => q.status === 'open').length, answered = mine.requests.filter((q) => q.status === 'answered').length;
    view.innerHTML = `<div class="page">
      ${pageHead({ greetLine: `${greet()}, ${esc(first(u.name))}`, title: t('nav_home'), sub: `${S.meta.stats.helpers} ${t('helpers_around')} · ${esc(needLabel(u.need))} · ${esc(u.area)}` })}
      <div class="row-head" style="margin-top:0"><span class="lbl">${t('dashboard')}</span><a class="link see" href="#/profile">${t('see_profile')}</a></div>
      <div class="bento">
        <a href="#/ask" class="tile dark wide"><span class="ti">${I('chat', 18)}</span><small class="lbl">${t('ask_cta')}</small><span style="display:block;font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin-top:8px;max-width:88%">${t('ask_cta_sub')}</span><span class="chev">${I('arrowR', 18)}</span></a>
        ${tile({ icon: 'chat', label: t('answered'), num: answered })}
        ${tile({ icon: 'clock', label: t('answers_waiting'), num: waiting })}
        ${tile({ icon: 'alert', label: t('alerts_title'), num: alerts.length, href: '#/map', chev: true })}
        ${tile({ icon: 'star', label: t('points'), num: u.points })}
        <a href="#/map" class="tile wide tint"><span class="ti">${I('compass', 18)}</span><small class="lbl">${t('route_card')}</small><span style="display:block;font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.3;margin-top:8px;max-width:86%">${t('route_card_sub')}</span><span class="chev">${I('arrowR', 18)}</span></a>
      </div>
      <div class="row-head"><h2>${t('my_requests')}</h2><span class="muted">${t('my_requests_sub')}</span></div>
      <div class="req-list" id="myReqs">${mine.requests.length ? mine.requests.map(requestCard).join('') : `<div class="empty card"><span class="big">${I('chat', 26)}</span>${t('no_requests_oku')}<br><a class="btn btn-black" style="margin-top:12px" href="#/ask">${t('ask_cta')}</a></div>`}</div>
      <div class="grid2" style="margin-top:22px">
        <div class="card"><div class="card-head"><div class="grow"><h2>${t('alerts_title')}</h2><div class="sub">${t('alerts_sub', { need: esc(needLabel(u.need)).toLowerCase() })}</div></div></div>
          <div style="display:grid;gap:8px">${alerts.length ? alerts.map((r) => alertItem(r, reports.now)).join('') : `<div class="muted">${t('no_alerts')}</div>`}</div></div>
        <div class="card"><h2>${t('route_card')}</h2><p class="muted" style="margin:6px 0 12px">${t('route_card_sub')}</p><div class="wrap"><a class="btn btn-black" href="#/map">${t('open_map')}</a><button class="btn btn-ghost" id="demoTrip">${t('demo_trip')}</button></div>
          <div style="margin-top:14px"><div class="muted" style="font-size:12px;margin-bottom:6px">${t('legend_title')}</div><div class="wrap"><span class="chip a">${t('b_verified')}</span><span class="chip">${t('b_aging').split(' –')[0]}</span><span class="chip ghost">${t('b_old').split(' –')[0]}</span></div></div></div>
      </div></div>`;
    FX.animateRings(view); bindCards();
    $('#demoTrip').onclick = () => { location.hash = '#/map'; setTimeout(() => KBMap.demoTrip(), 400); };
  }

  // ---------------- ASK ----------------
  function renderAsk(prefill = {}) {
    const d = S.askDraft || { place: null, lat: null, lng: null, question: '', urgency: 'today' };
    S.askDraft = d;
    if (prefill && prefill.name) { d.place = prefill.name; if (prefill.lat != null) { d.lat = prefill.lat; d.lng = prefill.lng; } if (prefill.question) d.question = prefill.question; if (prefill.urgency) d.urgency = prefill.urgency; }
    else Object.assign(d, prefill || {});
    view.innerHTML = `<div class="page"><div class="card" style="max-width:640px;margin:0 auto;padding:24px">
      <h2 style="font-size:26px;letter-spacing:-.03em">${t('ask_title')}</h2><p class="muted" style="margin:4px 0 14px">${t('ask_cta_sub')}</p>
      <div class="field"><label>${t('ask_where')}</label><div style="position:relative"><input type="text" id="askPlace" value="${esc(d.place || '')}" placeholder="${t('ask_where_ph')}" autocomplete="off" /><ul id="askSuggest" class="suggest hidden"></ul></div>
        <div class="wrap" style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="askLoc">${I('locate', 14)} ${t('use_loc')}</button><button class="btn btn-ghost btn-sm" id="askMap">${I('map', 14)} ${t('pick_on_map')}</button></div>
        <div class="muted" style="margin:10px 0 4px">${t('quick_places')}</div><div class="quick" id="quick">${quickPlaces().map(([n, la, ln]) => `<button data-n="${esc(n)}" data-la="${la}" data-ln="${ln}" class="${d.place === n ? 'on' : ''}">${esc(n)}</button>`).join('')}</div><div class="help-line" id="askCoords">${d.lat ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : ''}</div></div>
      <div class="field"><label>${t('ask_q')}</label><textarea id="askQ" placeholder="${esc(t('ask_q_ph'))}">${esc(d.question)}</textarea>
        <div class="muted" style="margin:8px 0 4px">${t('templates')}</div><div class="quick">${['tpl_lift', 'tpl_entrance', 'tpl_toilet', 'tpl_tactile', 'tpl_parking'].map((k) => `<button data-tpl="${k}">${t(k)}</button>`).join('')}</div></div>
      <div class="field"><label>${t('ask_urgency')}</label><div class="urg">${[['today', 'clock'], ['this_week', 'calendar'], ['whenever', 'leaf']].map(([k, ic]) => `<button data-u="${k}" class="choice compact ${d.urgency === k ? 'on' : ''}"><span class="radio"></span><span class="ico">${I(ic, 18)}</span><b>${t('urg_' + k)}</b></button>`).join('')}</div></div>
      <div class="err" id="askErr"></div><button class="btn btn-black btn-block btn-lg" id="askSend">${I('send', 18)} ${t('send_ask')}</button></div></div>`;
    const setPlace = (name, lat, lng) => { d.place = name; d.lat = lat; d.lng = lng; $('#askPlace').value = name; $('#askCoords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; $$('#quick button').forEach((b) => b.classList.toggle('on', b.dataset.n === name)); };
    $$('#quick button').forEach((b) => b.onclick = () => setPlace(b.dataset.n, Number(b.dataset.la), Number(b.dataset.ln)));
    $$('[data-tpl]').forEach((b) => b.onclick = () => { $('#askQ').value = t(b.dataset.tpl) + ' '; $('#askQ').focus(); });
    $$('.urg button').forEach((b) => b.onclick = () => { d.urgency = b.dataset.u; $$('.urg button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#askLoc').onclick = async () => { const pos = await KBGuide.locate({ prompt: true }); if (pos) { let name = t('my_location'); try { name = (await api(`/api/reverse?lat=${pos.lat}&lng=${pos.lng}`)).name || name; } catch {} setPlace(name, pos.lat, pos.lng); return; } if (!navigator.geolocation) { setPlace('My location', KL_SENTRAL.lat, KL_SENTRAL.lng); return; } navigator.geolocation.getCurrentPosition((p) => { S.geo = { lat: p.coords.latitude, lng: p.coords.longitude }; setPlace('My location', S.geo.lat, S.geo.lng); api(`/api/reverse?lat=${S.geo.lat}&lng=${S.geo.lng}`).then((r) => r.name && setPlace(r.name, S.geo.lat, S.geo.lng)).catch(() => {}); }, () => { setPlace('KL Sentral', KL_SENTRAL.lat, KL_SENTRAL.lng); toast(t('locate_fail'), 'warn'); }, { timeout: 6000 }); };
    $('#askMap').onclick = () => { d.question = $('#askQ').value; location.hash = '#/map'; setTimeout(() => { toast(`${I('pin', 14)} ${t('pick_report')}`, 'good'); KBMap.pickLocation((p) => { d.place = p.name || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`; d.lat = p.lat; d.lng = p.lng; location.hash = '#/ask'; }); }, 350); };
    let timer = null; const sug = $('#askSuggest');
    $('#askPlace').addEventListener('input', () => { clearTimeout(timer); const q = $('#askPlace').value.trim(); d.place = q; if (q.length < 2) { sug.classList.add('hidden'); return; } timer = setTimeout(async () => { try { const g = S.geo || KBGuide.position(); const r = await api(`/api/geocode?q=${encodeURIComponent(q)}${g ? `&lat=${g.lat}&lng=${g.lng}` : ''}`); sug.innerHTML = r.results.map((x, i) => `<li data-i="${i}"><span>${esc(x.name)}</span><small>${esc(x.display.split(',').slice(1, 4).join(','))}</small></li>`).join('') || '<li class="muted">—</li>'; sug.classList.remove('hidden'); $$('li', sug).forEach((li) => li.onclick = () => { const x = r.results[Number(li.dataset.i)]; if (x) setPlace(x.name, x.lat, x.lng); sug.classList.add('hidden'); }); } catch { sug.classList.add('hidden'); } }, 350); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#askPlace')) sug.classList.add('hidden'); }, { once: true });
    $('#askSend').onclick = async () => {
      d.question = $('#askQ').value.trim();
      if (!d.lat) { $('#askErr').textContent = t('pick_place_first'); return; }
      if (d.question.length < 8) { $('#askErr').textContent = t('q_short'); return; }
      const btn = $('#askSend'); btn.disabled = true;
      try {
        const out = await api('/api/requests', { method: 'POST', body: { place: d.place, question: d.question, lat: d.lat, lng: d.lng, urgency: d.urgency } });
        S.askDraft = null; await refreshMe();
        openModal(`<div class="sent-anim"><span class="plane">${I('send', 30)}</span><h2 style="justify-content:center">${t('ask_sent')}</h2><p class="muted" style="margin:8px 0 14px">${t('my_requests_sub')}</p><div class="qcard" style="text-align:left"><div class="q" style="font-size:16px">“${esc(out.request.question)}”</div><div class="by">${I('pin', 13)} ${esc(out.request.place)}</div></div><button class="btn btn-black btn-block" id="mOk">${t('ok')}</button></div>`);
        FX.confetti({ count: 80 });
        $('#mOk').onclick = () => { closeModal(); location.hash = '#/home'; };
      } catch (err) { btn.disabled = false; $('#askErr').textContent = err.data?.error === 'question_too_short' ? t('q_short') : errMsg(err); }
    };
  }

  // ---------------- MAP ----------------
  function renderMap(reportId) {
    view.innerHTML = '<div class="page" id="mapPage"></div>';
    KBMap.init(ctx); KBMap.show($('#mapPage'));
    if (reportId) setTimeout(() => KBMap.openReport(reportId), 400);
  }
  const ctx = { S, api, t, esc, toast, openModal, closeModal, showReward, refreshMe, fmtAgo, fmtDur, haversine, fileToDataUrl, urlToDataUrl, AV, isLight, I, openRequest: (id) => openRequest(id), prefillAsk: (p) => prefillAsk(p), answerWithAI: (q, draft) => answerWithAI(q, draft) };
  let askPrefill = null;
  function prefillAsk(p) { askPrefill = p; if (S.route === 'ask') renderAsk(p); else location.hash = '#/ask'; }
  async function answerWithAI(q, draft) {
    if (!q) return;
    const full = await api(`/api/requests/${q.id}?${geoQ().slice(1)}`).catch(() => q);
    renderAnswerForm(full, draft);
  }
  async function setLang(l) { if (l === S.lang) return; S.lang = l; store.set('kb.lang', S.lang); S.meta = await api('/api/meta'); applyStaticI18n(); await refreshMe(); renderNav(); if (window.KBGuide) KBGuide.relabel(); await render(); }
  function setBigText(on) { S.big = !!on; store.set('kb.big', S.big ? '1' : '0'); document.body.classList.toggle('big', S.big); const b = $('#bigToggle'); if (b) b.classList.toggle('on', S.big); }
  window.KBApp = { trace: () => TRACE.slice(), t, prefillAsk, openRequest: (id) => openRequest(id), setLang, setBigText, logout: () => logout(), get state() { return { route: S.route, lang: S.lang, me: S.me && { id: S.me.id, name: S.me.name, role: S.me.role } }; } };

  // ---------------- COMMUNITY ----------------
  async function renderCommunity() {
    const [lb, feed] = await Promise.all([api(`/api/leaderboard?period=${S.lbPeriod}${S.lbArea ? `&area=${encodeURIComponent(S.lbArea)}` : ''}`), api('/api/feed?limit=25')]);
    const areas = S.meta.areas || [];
    const top = lb.rows.slice(0, 3);
    view.innerHTML = `<div class="page"><section class="page-head"><div><div class="greet">${t('nav_board')}</div><h1>${t('lb_title')}</h1><div class="sub">${t('lb_sub')}</div></div></section>
      ${top.length ? `<div class="bento" style="margin-bottom:12px">${top.map((r, i) => `<div class="tile ${i === 0 ? 'dark' : ''} ${i === 0 ? 'wide' : ''}"><div class="row" style="gap:12px">${AV(r, i === 0 ? 56 : 44)}<div class="grow"><small class="lbl" style="margin:0">#${r.rank} · ${esc(r.title)}</small><div style="font-size:${i === 0 ? 22 : 17}px;font-weight:800;letter-spacing:-.02em;line-height:1.15">${esc(r.name)}</div></div></div><span class="num" style="margin-top:14px">${r.points}<small>${t('pts')}</small></span></div>`).join('')}</div>` : ''}
      <div class="grid2">
      <div class="card"><div class="card-head"><div class="grow"><h2>${t('helpers_top')}</h2></div></div>
        <div class="filters" style="margin-top:0">${['today', 'week', 'all'].map((p) => `<button class="${S.lbPeriod === p ? 'on' : ''}" data-p="${p}">${t(p === 'all' ? 'alltime' : p)}</button>`).join('')}<span class="sp"></span><select id="lbArea"><option value="">${t('area_all')}</option>${areas.map((a) => `<option ${S.lbArea === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
        <ol class="lb">${lb.rows.map((r) => `<li class="${r.id === S.me.id ? 'me' : ''}"><span class="rank">${r.rank}</span>${AV(r, 40)}<span class="who"><b>${esc(r.name)}</b><span>Lv ${r.level} · ${esc(r.title)}${r.streak > 1 ? ` · ${r.streak} ${t('d')} streak` : ''}</span></span><span class="p">${r.points}</span></li>`).join('') || `<div class="muted">${t('none')}</div>`}</ol></div>
      <div class="card"><div class="card-head"><div class="grow"><h2>${t('activity')}</h2></div></div><ul class="feed" id="feed">${feed.items.map((f) => feedItem(f)).join('')}</ul></div></div></div>`;
    $$('.filters [data-p]').forEach((b) => b.onclick = () => { S.lbPeriod = b.dataset.p; renderCommunity(); });
    $('#lbArea').onchange = (e) => { S.lbArea = e.target.value; renderCommunity(); };
  }

  // ---------------- PROFILE ----------------
  const HIST_ICON = { answer: 'chat', confirm: 'check', report: 'pin', streak: 'flame', mission: 'target', thanks: 'heart', dispute: 'x' };
  // ---------------- character & shop ----------------
  const LAYER_TABS = [['outfit', 'tab_body'], ['hair', 'tab_head'], ['glasses', 'tab_glasses'], ['item', 'tab_item'], ['pet', 'tab_pet'], ['background', 'tab_bg'], ['frame', 'tab_frame'], ['aid', 'tab_aid']];
  let shopTab = 'outfit';
  async function renderShop(param) {
    if (param && LAYER_TABS.some(([k]) => k === param)) shopTab = param;
    await KBCharacter.load(true);
    const u = S.me = await api('/api/me');
    const W = u.wardrobe;
    const rar = (r) => ({ common: t('r_common'), rare: t('r_rare'), epic: t('r_epic'), legendary: t('r_legendary') })[r] || r;
    view.innerHTML = `<div class="page shop">
      <section class="page-head"><div><div class="greet">${t('shop_greet')}</div><h1>${t('shop_title')}</h1><div class="sub">${t('shop_sub')}</div></div>
        <div class="coin-big">${I('coin', 18)} <b id="shopCoins">${u.coins}</b> <span class="muted">${t('coins')}</span></div></section>
      <section class="char-stage card" id="charStage">
        <div class="char-canvas" id="charCanvas" style="background:${(u.peep && u.peep.bg) || u.color}">${charArt(u)}</div>
        <div class="char-meta"><b>${esc(u.name)}</b><div class="muted">${I(u.levelEmoji || 'leaf', 14)} ${t('level')} ${u.level} · ${esc(u.title)}</div>
          <div class="wrap" style="margin-top:10px">${KBPeeps.ready() && KBPeeps.forUser(u, S.me) ? `<button class="btn btn-black btn-sm" id="charEdit">${I('palette', 14)} ${t('edit_avatar')}</button>` : `<button class="btn btn-ghost btn-sm" id="charShuffle">${I('refresh', 14)} ${t('shuffle')}</button><button class="btn btn-ghost btn-sm" id="charSkin">${I('palette', 14)} ${t('skin_tone')}</button>`}${!W.hasArt && !(KBPeeps.ready() && KBPeeps.forUser(u, S.me)) ? `<span class="chip ghost" title="${t('art_pending_tip')}">${I('sparkle', 12)} ${t('art_pending')}</span>` : ''}</div></div>
      </section>
      <div class="tabs shop-tabs" id="shopTabs">${LAYER_TABS.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === shopTab ? 'active' : ''}">${t(l)}</button>`).join('')}</div>
      <div class="shop-grid" id="shopGrid"></div>
      <section class="card tint how-coins"><b>${I('coin', 16)} ${t('how_coins')}</b><div class="muted">${t('how_coins_sub')}</div></section>
    </div>`;
    const grid = () => {
      const items = W.items.filter((i) => i.layer === shopTab).sort((a, b) => (b.owned - a.owned) || (a.price - b.price));
      $('#shopGrid').innerHTML = items.map((i) => `<button type="button" class="shop-item ${i.owned ? 'owned' : ''} ${i.equipped ? 'on' : ''} ${i.locked ? 'locked' : ''} r-${i.rarity}" data-id="${i.id}">
          <div class="pic">${KBCharacter.renderItem(i, 96, u.avatar)}</div>
          <div class="nm">${esc(i.name)}</div>
          <div class="pr">${i.equipped ? `<span class="chip dark">${I('check', 11)} ${t('equipped')}</span>` : i.owned ? `<span class="chip ghost">${t('owned')}</span>` : i.locked ? `<span class="chip ghost">${I('lock', 11)} Lv ${i.minLevel}</span>` : i.price === 0 ? `<span class="chip good">${t('free')}</span>` : `<span class="chip ${u.coins >= i.price ? 'good' : 'warn'}">${I('coin', 11)} ${i.price}</span>`}</div>
          <small class="rar">${rar(i.rarity)}</small></button>`).join('') || `<div class="empty card">${t('shop_empty')}</div>`;
      $$('#shopGrid .shop-item').forEach((b) => b.onclick = () => onItem(W.items.find((i) => i.id === b.dataset.id)));
    };
    const refresh = async () => { S.me = await api('/api/me'); Object.assign(W, S.me.wardrobe); $('#shopCoins').textContent = S.me.coins; $('#charCanvas').innerHTML = charArt(S.me); hydratePeeps($('#charCanvas')); $('#charCanvas').classList.remove('pop'); void $('#charCanvas').offsetWidth; $('#charCanvas').classList.add('pop'); renderTopbar(); grid(); };
    const onItem = async (i) => {
      if (!i) return;
      if (i.owned) { const r = await api('/api/wardrobe/equip', { method: 'POST', body: { id: i.id, on: !i.equipped } }).catch((e) => e.data || {}); if (r.error) toast(t('err_generic'), 'warn'); await refresh(); return; }
      if (i.locked) { toast(`${t('unlocks_at')} ${i.minLevel}`, 'warn'); return; }
      if (u.coins < i.price && i.price > 0) { toast(t('not_enough_coins', { n: i.price - S.me.coins }), 'warn'); FX.bump($('#coinPill')); return; }
      openModal(`<div class="buy"><div class="pic">${KBCharacter.renderItem(i, 140, u.avatar)}</div><h2 style="justify-content:center">${esc(i.name)}</h2><p class="muted" style="text-align:center">${rar(i.rarity)} · ${i.price === 0 ? t('free') : `${i.price} ${t('coins')}`}</p>
        <div class="actions"><button class="btn btn-ghost" id="buyNo">${t('cancel')}</button><button class="btn btn-black btn-lg grow" id="buyYes">${I('coin', 16)} ${i.price === 0 ? t('take_it') : t('buy_for', { n: i.price })}</button></div></div>`);
      $('#buyNo').onclick = closeModal;
      $('#buyYes').onclick = async () => {
        $('#buyYes').disabled = true;
        const r = await api('/api/wardrobe/buy', { method: 'POST', body: { id: i.id } }).catch((e) => e.data || {});
        closeModal();
        if (r.error) { toast(r.error === 'not_enough_coins' ? t('not_enough_coins', { n: r.need }) : t('err_generic'), 'warn'); return; }
        FX.confetti({ count: 90, spread: .9 }); toast(`${I('sparkle', 14)} ${t('bought')}: ${esc(i.name)}`, 'good');
        await refresh();
      };
    };
    $$('#shopTabs button').forEach((b) => b.onclick = () => { shopTab = b.dataset.tab; $$('#shopTabs button').forEach((x) => x.classList.toggle('active', x === b)); grid(); });
    const ce = $('#charEdit'); if (ce) ce.onclick = () => openPeepEditor(S.me, async () => { await refresh(); renderTopbar(); });
    if ($('#charShuffle')) $('#charShuffle').onclick = async () => {
      // random outfit from what the user OWNS
      const owned = W.items.filter((i) => i.owned && ['outfit', 'hair', 'glasses', 'item', 'pet', 'background'].includes(i.layer));
      const byLayer = {}; for (const i of owned) (byLayer[i.layer] = byLayer[i.layer] || []).push(i);
      for (const [layer, list] of Object.entries(byLayer)) { const pick = list[Math.floor(Math.random() * list.length)]; if (layer === 'glasses' || layer === 'item' || layer === 'pet') { if (Math.random() < .4) { await api('/api/wardrobe/equip', { method: 'POST', body: { id: pick.id, on: false } }).catch(() => {}); continue; } } await api('/api/wardrobe/equip', { method: 'POST', body: { id: pick.id, on: true } }).catch(() => {}); }
      await refresh();
    };
    if ($('#charSkin')) $('#charSkin').onclick = async () => { const next = ((S.me.skin || 1) % 6) + 1; await api('/api/wardrobe/skin', { method: 'POST', body: { skin: next } }).catch(() => {}); const colors = KBAvatar.ACCENTS; await api('/api/me', { method: 'PATCH', body: { color: colors[(colors.indexOf(S.me.color) + 1) % colors.length] } }).catch(() => {}); await refresh(); $('#charCanvas').style.background = S.me.color; };
    grid();
  }

  /** Opens the <AvatarBuilder /> in a modal for user u; `after()` runs once the new combination is saved (localStorage + PATCH /api/me). */
  function openPeepEditor(u, after) {
    const d = { avatar: { ...u.avatar }, color: u.color, role: u.role, need: u.need, peep: u.peep ? { ...u.peep } : (KBPeeps.ready() ? KBPeeps.sanitize(KBPeeps.current() || KBPeeps.defaults(u.role, u.need), u) : null) };
    openModal(`<h2>${t('edit_avatar')}</h2><div id="builderHost" style="margin-top:8px"></div><div class="actions"><button class="btn btn-ghost" id="mCancel">${t('cancel')}</button><button class="btn btn-black" id="mSave">${t('save')}</button></div>`, { wide: true });
    mountBuilder($('#builderHost', modalCard), d, { title: u.name, compact: true, user: u });
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => { const body = d.peep ? { peep: d.peep, color: d.peep.bg || d.color } : { avatar: d.avatar, color: d.color }; if (d.peep) KBPeeps.saveLocal(d.peep); await api('/api/me', { method: 'PATCH', body }); closeModal(); toast(t('avatar_saved'), 'good'); if (after) await after(); };
  }
  async function renderProfile() {
    const u = S.me = await api('/api/me');
    const stats = u.role === 'helper' ? [['answers', 's_answers'], ['confirms', 's_confirms'], ['reports', 's_reports'], ['photos', 's_photos']] : [['asks', 's_asks'], ['reports', 's_reports'], ['confirms', 's_confirms'], ['photos', 's_photos']];
    view.innerHTML = `<div class="page">
      <section class="page-head"><div><div class="greet">${t('profile')}</div><h1>${esc(u.name)}</h1><div class="sub">${u.role === 'oku' ? `${t('oku_member')} · ${esc(needLabel(u.need))}` : t('helper_word')} · ${esc(u.area)} · ${esc(u.email)}</div>
        <div class="wrap" style="margin-top:14px"><button class="btn btn-black btn-sm" id="editStyle">${I('palette', 14)} ${t('edit_avatar')}</button><button class="btn btn-outline btn-sm" onclick="location.hash='#/shop'">${I('sparkle', 14)} ${t('nav_shop')}</button><button class="btn btn-ghost btn-sm" id="logoutBtn">${I('logout', 14)} ${t('logout')}</button></div>
        <div class="wrap" style="margin-top:10px;align-items:center;gap:8px"><span class="chip">${I('pin', 12)} ${t('my_area')}: <b id="areaNow">${esc(u.area || '—')}</b></span><button class="btn btn-soft btn-sm" id="areaEdit">${t('change_area')}</button><button class="btn btn-soft btn-sm" id="areaLocate">${I('pin', 12)} ${t('locate_me')}</button></div></div>
        <div class="ring-wrap lg">${FX.ring(u.progress)}${AV(u, 108)}</div></section>
      ${(() => { const pp = KBPeeps.ready() ? KBPeeps.forUser(u, S.me) : null; if (!pp) return ''; const lk = ['head', 'body', 'accessories', 'pose', 'face', 'facial-hair'].reduce((n, L) => n + KBPeeps.options(L, { user: u }).filter((x) => x.locked).length, 0); const tot = ['head', 'body', 'accessories', 'pose', 'face', 'facial-hair'].reduce((n, L) => n + KBPeeps.options(L, { user: u }).length, 0); return `<section class="char-card"><div class="cc-stage" style="background:${pp.bg || '#eee'}">${KBPeeps.render(pp, 300, { crop: pp.mode === 'full' ? 'full' : 'bust', bg: 'none' })}</div><div class="cc-info"><div class="kicker">${I('star', 12)} ${t('level_word')} ${u.level} · ${esc(u.title)}</div><h2>${esc(u.name)}</h2><p class="muted">${t('f6_sub')}</p><div class="cc-bar"><i style="width:${Math.round((u.progress || 0) * 100)}%"></i></div><div class="cc-row"><span>${u.points} ${t('points_word') || 'pts'}</span><span>${tot - lk}/${tot} ${t('unlocked') || 'unlocked'}</span></div><div class="cc-parts">${['head', 'face', 'body', 'facialHair', 'accessory', 'pose'].map((k) => pp[k] && KBPeeps.item(pp[k]) ? `<span class="chip"><img src="${KBPeeps.item(pp[k]).url}" alt="">${esc(KBPeeps.item(pp[k]).name)}</span>` : '').join('')}</div><button class="btn btn-black btn-sm" id="editStyle2">${I('palette', 14)} ${t('edit_avatar')}</button></div></section>`; })()}
      <div class="bento">
        ${tile({ cls: 'dark', icon: 'star', label: `${t('level_word')} ${u.level} · ${esc(u.title)}`, num: u.points, unit: u.nextLevelAt ? `${u.nextLevelAt - u.points} ${t('to_next_short')}` : '' })}
        ${tile({ icon: 'flame', label: t('day_streak'), num: u.streak })}
        ${tile({ icon: 'heart', label: t('s_thanks'), num: u.thanks })}
        ${tile({ icon: 'users', label: t('people_helped'), num: u.impact?.peopleHelped ?? 0 })}
      </div>
      <div class="row-head"><h2>${t('impact')}</h2></div>
      <div class="stats">${stats.map(([k, l]) => `<div class="stat"><b>${u.stats[k] || 0}</b><span>${t(l)}</span></div>`).join('')}</div>
      <div class="row-head"><h2>${t('badges')}</h2><span class="muted">${u.badges.length}/${u.badges.length + u.lockedBadges.length}</span></div>
      <div class="badges">${u.badges.map((b) => `<div class="bd" title="${esc(b.desc)}"><i>${I.emoji(b.icon, 20)}</i>${esc(b.name)}</div>`).join('')}${u.lockedBadges.map((b) => `<div class="bd locked" title="${esc(b.desc)}"><i>${I('lock', 18)}</i>${esc(b.name)}</div>`).join('')}</div>
      <div class="grid2" style="margin-top:22px">
        <div class="card"><h2>${t('history')}</h2><ul class="tl" style="margin-top:8px">${u.recent.map((x) => `<li><span class="k">${I(HIST_ICON[x.type] || 'star', 15)}</span><span class="grow">${esc(x.description)}<div class="when">${fmtAgo(Date.now() - x.at)}</div></span><span class="amt ${x.amount < 0 ? 'neg' : ''}">${x.amount > 0 ? '+' : ''}${x.amount}</span></li>`).join('') || `<li class="muted">${t('none')}</li>`}</ul></div>
        <div class="card"><h2>${t('settings')}</h2>
          <div class="toggle"><span class="row">${I('textsize', 16)} ${t('large_text')}</span><button class="switch ${S.big ? 'on' : ''}" id="bigToggle" aria-pressed="${S.big}"></button></div>
          <div class="toggle"><span class="row">${I('globe', 16)} ${t('language')}</span><button class="btn btn-ghost btn-sm" id="langBtn2">${S.lang === 'en' ? 'Bahasa Melayu' : 'English'}</button></div>
          <div class="toggle"><span class="row">${I('shield', 16)} ${t('perm_settings')}</span><button class="btn btn-ghost btn-sm" id="permBtn">${['geolocation', 'camera', 'microphone'].filter((k) => (KBGuide.perms || {})[k] === 'granted').length}/3 ${t('perm_on').toLowerCase()}</button></div>
          <div class="toggle"><span class="row">${I('mute', 16)} ${t('voice_mute')}</span><button class="switch ${KBGuide.muted ? 'on' : ''}" id="muteToggle" aria-pressed="${KBGuide.muted}"></button></div>
          <h3 style="margin-top:16px" class="row">${I('flask', 16)} ${t('demo_tools')}</h3><div class="muted">${t('demo_clock')}</div>
          <div class="wrap" style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-adv="6">+6h</button><button class="btn btn-ghost btn-sm" data-adv="24">+1 ${t('d')}</button><button class="btn btn-ghost btn-sm" data-adv="72">+3 ${t('d')}</button><button class="btn btn-ghost btn-sm" id="resetBtn">${I('rewind', 14)} ${t('reset_demo')}</button></div></div>
      </div></div>`;
    FX.animateRings(view);
    $('#logoutBtn').onclick = () => logout();
    $('#areaEdit').onclick = () => {
      const AREAS = ['Cyberjaya', 'Putrajaya', 'KL Sentral', 'Brickfields', 'Bukit Bintang', 'Bangsar', 'Petaling Jaya', 'Subang Jaya', 'Shah Alam', 'Puchong', 'Seri Kembangan', 'Kajang', 'Dengkil', 'Sepang'];
      openModal(`<h2>${I('pin', 20)} ${t('my_area')}</h2><p class="muted">${t('area_help')}</p><div class="wrap" id="areaPick" style="gap:8px;margin:12px 0">${AREAS.map((a) => `<button class="btn ${a === u.area ? 'btn-black' : 'btn-outline'} btn-sm" data-area="${a}">${a}</button>`).join('')}</div>
        <div class="field"><label>${t('area')}</label><input type="text" id="areaInput" value="${esc(u.area || '')}" placeholder="${t('area_ph')}" /></div>
        <div class="actions" style="margin-top:12px"><button class="btn btn-ghost" id="mCancel">${t('cancel')}</button><button class="btn btn-black grow" id="mSave">${t('save')}</button></div>`);
      $$('#areaPick button').forEach((b) => b.onclick = () => { $('#areaInput').value = b.dataset.area; $$('#areaPick button').forEach((x) => x.className = `btn ${x === b ? 'btn-black' : 'btn-outline'} btn-sm`); });
      $('#mCancel').onclick = closeModal;
      $('#mSave').onclick = async () => { const area = $('#areaInput').value.trim().slice(0, 40); if (!area) return; await api('/api/me', { method: 'PATCH', body: { area } }); closeModal(); await refreshMe(); S.geo = null; if (window.KBMap && KBMap.setMe && !(window.KBGuide && KBGuide.position())) KBMap.setMe(KBGuide.home(), { fly: true }); toast(`${I('pin', 14)} ${t('area_saved', { area })}`, 'good'); renderProfile(); };
    };
    $('#areaLocate').onclick = async () => { const pos = await KBGuide.locate({ prompt: true, timeout: 12000 }); if (pos) { toast(`${I('pin', 14)} ${t('located')}`, 'good'); if (window.KBMap && KBMap.setMe) KBMap.setMe(pos, { fly: true }); } else { const why = KBGuide.geoError(); toast(t(why === 'blocked' ? 'geo_blocked' : why === 'timeout' ? 'geo_timeout' : 'geo_denied', { area: u.area || 'KL' }), 'warn', 8000); } };
    $('#bigToggle').onclick = () => setBigText(!S.big);
    $('#langBtn2').onclick = () => $('#langBtn').click();
    $('#permBtn').onclick = () => KBGuide.requestPermissions({ force: true });
    $('#muteToggle').onclick = () => { KBGuide.setMuted(!KBGuide.muted); $('#muteToggle').classList.toggle('on', KBGuide.muted); };
    $$('[data-adv]').forEach((b) => b.onclick = async () => { await api('/api/demo/advance', { method: 'POST', body: { hours: Number(b.dataset.adv) } }); toast(`${t('clock_moved')}: +${b.dataset.adv}h`); });
    $('#resetBtn').onclick = async () => { await api('/api/demo/reset', { method: 'POST' }); toast(t('demo_reset')); };
    const es2 = $('#editStyle2'); if (es2) es2.onclick = () => $('#editStyle').click();
    $('#editStyle').onclick = () => openPeepEditor(u, async () => { await refreshMe(); renderProfile(); renderTopbar(); });
  }

  // ---------------- notifications ----------------
  const notifPanel = $('#notifPanel');
  $('#notifBtn').onclick = async () => {
    if (!notifPanel.classList.contains('hidden')) { notifPanel.classList.add('hidden'); return; }
    const u = S.me;
    notifPanel.innerHTML = `<h3>${t('notifications')} <button class="btn-mini" id="markRead">${t('mark_read')}</button></h3>${u.notifications.length ? u.notifications.map((n) => `<div class="notif ${n.read ? '' : 'unread'}" data-link='${esc(JSON.stringify(n.link || null))}'><span class="ic">${I.emoji(n.icon, 14)}</span><div>${esc(n.text)}<small>${fmtAgo(Date.now() - n.at)}</small></div></div>`).join('') : `<div class="muted">${t('no_notifs')}</div>`}`;
    notifPanel.classList.remove('hidden');
    $('#markRead').onclick = async () => { await api('/api/me/read', { method: 'POST' }); notifPanel.classList.add('hidden'); await refreshMe(); };
    $$('.notif', notifPanel).forEach((el) => el.onclick = () => { notifPanel.classList.add('hidden'); const link = JSON.parse(el.dataset.link); if (!link) return; if (link.kind === 'request') openRequest(link.id); else if (link.kind === 'report') location.hash = `#/map/${link.id}`; });
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn')) notifPanel.classList.add('hidden'); });
  $('#meAvatar').onclick = () => { trace('click #meAvatar → #/profile'); location.hash = '#/profile'; };
  $('#ptsPill').onclick = () => { location.hash = '#/profile'; };
  $('#langBtn').onclick = () => setLang(S.lang === 'en' ? 'ms' : 'en');
  function applyStaticI18n() { $$('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); }); $$('[data-ph]').forEach((el) => { el.placeholder = t(el.dataset.ph); }); }

  // ---------------- live updates ----------------
  function connectEvents() {
    if (S.es) S.es.close();
    const es = new EventSource(`/api/events?token=${encodeURIComponent(S.token)}`);
    S.es = es;
    es.addEventListener('notify', async (e) => {
      const n = JSON.parse(e.data);
      toast(`${I.emoji(n.icon, 16)} ${esc(n.text)}`, n.icon === '💖' || n.icon === '🙋' ? 'accent' : n.icon === '💬' ? 'good' : '', 5000);
      if (window.KBGuide && KBGuide.notify) KBGuide.notify('KitaBantu', n.text);
      await refreshMe();
      if (S.route === 'home' && S.me.role === 'oku' && n.link?.kind === 'request') renderOkuHome();
    });
    es.addEventListener('change', async (e) => {
      const evt = JSON.parse(e.data);
      const meta = await api('/api/meta').catch(() => null); if (meta) S.meta = meta;
      if (evt.kind === 'reset') { toast(t('demo_reset')); await refreshMe(); await render(); return; }
      if (evt.kind === 'clock') { await refreshMe(); if (S.route === 'map') { await KBMap.refresh(); KBMap.replan(); } else if (S.route === 'home') await render(); return; }
      if (evt.kind.startsWith('report')) { if (S.route === 'map') { await KBMap.refresh(); KBMap.replan(); } if (evt.by !== S.me.id && evt.kind === 'report.created') toast(`${I('sparkle', 14)} ${t('toast_new')}: ${esc(evt.report.label)}`, 'good'); }
      if (evt.kind.startsWith('request')) { if (evt.by !== S.me.id && (S.route === 'home' || S.route === 'requests')) await render(); renderCounts(); }
      if (evt.kind === 'user.joined' && evt.user.id !== S.me.id) toast(`${I('wave', 14)} ${esc(first(evt.user.name))} joined as ${evt.user.role === 'oku' ? 'an OKU member' : 'a helper'}`);
      if (S.route === 'community') renderCommunity();
    });
    es.onerror = () => { es.close(); if (S.token) setTimeout(connectEvents, 3000); };
  }

  // ---------------- boot ----------------
  async function boot() {
    [S.meta] = await Promise.all([api('/api/meta'), window.KBCharacter ? KBCharacter.load().catch(() => null) : null, window.KBPeeps ? KBPeeps.load().catch(() => null) : null]); // art manifest first so the landing hero can be the real illustration
    applyStaticI18n();
    document.body.classList.toggle('big', S.big);
    if (S.token) {
      const me = await api('/api/me').catch(() => null);
      if (me) { await enter(S.token, me); return; }
      // token no longer valid (server restart) → straight to login with an explanation, not the landing page
      S.token = null; store.del('kb.token');
      const last = store.get('kb.lastEmail') || '';
      await showAuth('login', { email: last, notice: t('session_expired') });
      return;
    }
    showAuth('landing');
  }
  boot().catch((e) => { console.error(e); toast(`Failed to load: ${e.message}`, 'warn'); });
})();
